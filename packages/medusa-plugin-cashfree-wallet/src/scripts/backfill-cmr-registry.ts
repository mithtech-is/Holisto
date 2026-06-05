import type { ExecArgs } from "@medusajs/framework/types"
import {
  CASHFREE_WALLET_MODULE,
  CashfreeWalletService,
} from "../modules/cashfree_wallet"

/**
 * One-time backfill: for every existing demat_account row that
 * predates the cmr_record registry, compute its cmr_hash, upsert a
 * cmr_record row from its data, and stamp `cmr_hash` back onto the
 * demat row. Idempotent — safe to re-run.
 *
 * Run on the VPS with:
 *   docker exec polemarch-stack-medusa-backend-1 \
 *     npx medusa exec ./src/scripts/backfill-cmr-registry.ts
 */
export default async function ({ container }: ExecArgs) {
  const wallet = container.resolve(
    CASHFREE_WALLET_MODULE,
  ) as CashfreeWalletService

  const all = (await wallet.listDematAccounts(
    {},
    { take: 5000, order: { created_at: "ASC" } as any } as any,
  )) as any[]

  console.log(`[cmr-backfill] scanning ${all.length} demat_account row(s)`)

  let upserted = 0
  let stamped = 0
  let skippedNoHash = 0
  let alreadyLinked = 0

  for (const d of all) {
    const cmrHash = wallet.computeCmrHash({
      depository: d.depository,
      boid: d.boid,
      dp_id: d.dp_id,
      client_id: d.client_id,
    })
    if (!cmrHash) {
      skippedNoHash += 1
      continue
    }

    if (d.cmr_hash === cmrHash) {
      alreadyLinked += 1
      continue
    }

    const verificationStatus =
      d.verification_status === "verified" ||
      d.verification_status === "failed" ||
      d.verification_status === "name_mismatch" ||
      d.verification_status === "pending"
        ? d.verification_status
        : "pending"

    await wallet.upsertCmrRecord({
      cmr_hash: cmrHash,
      depository: d.depository,
      cmr_masked: wallet.buildCmrMasked({
        depository: d.depository,
        boid: d.boid,
        dp_id: d.dp_id,
        client_id: d.client_id,
      }),
      dp_id: d.dp_id ?? null,
      client_id: d.client_id ?? null,
      boid: d.boid ?? null,
      dp_name: d.dp_name,
      account_holder_name: d.account_holder_name,
      cmr_file_url: d.cmr_file_url,
      name_match_score: d.name_match_score ?? null,
      verification_status: verificationStatus,
      cashfree_reference_id: d.cashfree_reference_id ?? null,
      verification_raw: {
        backfilled_from_demat_id: d.id,
        backfilled_at: new Date().toISOString(),
        original_verification_raw: d.verification_raw ?? null,
      },
    })
    upserted += 1

    await wallet.updateDematAccounts({
      selector: { id: d.id },
      data: { cmr_hash: cmrHash },
    })
    stamped += 1
  }

  console.log(
    `[cmr-backfill] DONE — registry upserts=${upserted}, demat rows stamped=${stamped}, already_linked=${alreadyLinked}, skipped (no fingerprint)=${skippedNoHash}`,
  )
}
