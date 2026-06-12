import { ExecArgs } from "@medusajs/framework/types"
import {
  CASHFREE_WALLET_MODULE,
  CashfreeWalletService,
} from "../modules/cashfree_wallet"

/**
 * Backfill / drift-fix: for every customer with an active Cashfree
 * VBA, push the latest verified-bank list to Cashfree as the VBA's
 * `allowed_remitters` via PUT /pg/vba/{virtual_account_id}.
 *
 * Why this script exists
 * ----------------------
 * Until the `updateVba` wiring landed, our codebase only set
 * `allowed_remitters` AT VBA CREATE TIME — every bank a customer
 * verified after their first one stayed missing from Cashfree's
 * dashboard lock list. Webhook-time TPV in
 * /webhooks/cashfree/payment-gateway compensated, but the Cashfree
 * dashboard view was wrong (e.g. Jayashankara had two verified banks
 * locally; only one showed up in Cashfree's allowed-remitter list).
 *
 * Now that PUT /pg/vba/{id} is wired into bank add/delete/admin-
 * verify/admin-provision, NEW changes flow live. This script catches
 * EXISTING VBAs up to current state.
 *
 * Behaviour
 * ---------
 *   - Lists every active VBA in `cashfree_virtual_account`.
 *   - For each, calls `syncVbaAllowedRemitters` which:
 *       * Reads all currently-verified banks for the customer.
 *       * PUTs the full list to Cashfree's
 *         `remitter_lock_details.allowed_remitters`.
 *       * Persists Cashfree's response into `cashfree_virtual_account.raw`.
 *   - Logs per-customer outcomes; failures don't stop the loop.
 *
 * Usage
 * -----
 *   # Sync all active VBAs:
 *   npx medusa exec ./src/scripts/sync-vba-allowed-remitters.ts
 *
 *   # Sync a single customer:
 *   npx medusa exec ./src/scripts/sync-vba-allowed-remitters.ts <customer_id>
 *
 *   # Dry-run (no Cashfree calls — just lists what WOULD be synced):
 *   npx medusa exec ./src/scripts/sync-vba-allowed-remitters.ts --dry-run
 */
export default async function syncVbaAllowedRemitters({
  container,
  args: rawArgs,
}: ExecArgs) {
  const logger = container.resolve("logger")
  const wallet = container.resolve(
    CASHFREE_WALLET_MODULE,
  ) as CashfreeWalletService
  // Customer module — used to fetch each VBA-customer's metadata so
  // the kyc_details payload (pan + aadhaar) gets included on the
  // PUT to Cashfree. Cross-module from the cashfree_wallet service
  // isn't reliable in v2 (cradle-style accessors throw), so the
  // script does the fetch itself and passes metadata in.
  const customerModule: any = container.resolve("customer")

  const argv = (rawArgs as string[] | undefined) ?? []
  const dryRun = argv.includes("--dry-run") || argv.includes("-n")
  const explicitCustomerId = argv.find((a) => !a.startsWith("-"))

  // List the active VBAs we're going to walk. Using listCashfreeVirtualAccounts
  // with status="active" mirrors what production code paths key on.
  const vbas = explicitCustomerId
    ? await wallet.listCashfreeVirtualAccounts({
        customer_id: explicitCustomerId,
        status: "active",
      })
    : await wallet.listCashfreeVirtualAccounts({ status: "active" })

  logger.info(
    `[sync-vba] Found ${vbas.length} active VBA(s)${
      explicitCustomerId ? ` for customer ${explicitCustomerId}` : ""
    }${dryRun ? " (dry-run)" : ""}`,
  )

  let ok = 0
  let failed = 0
  let skipped = 0

  for (const v of vbas) {
    const customerId = (v as any).customer_id as string
    const vAccountId = (v as any).virtual_account_id as string

    // Reach into the same helper the runtime paths use — keeps the
    // bank-decryption + dedup logic in one place.
    const verifiedBanks = await wallet.listBankAccounts({
      customer_id: customerId,
      verification_status: "verified",
    })

    if (dryRun) {
      logger.info(
        `[sync-vba] DRY: customer=${customerId} vba=${vAccountId} verified_banks=${verifiedBanks.length}`,
      )
      skipped++
      continue
    }

    // Fetch customer metadata for kyc_details. Failure isn't fatal
    // — sync still runs (allowed_remitters is the load-bearing part);
    // the kyc block is just left absent from the PUT, which means
    // Cashfree's existing kyc on that VBA stays unchanged.
    const customer = await customerModule
      .retrieveCustomer(customerId)
      .catch(() => null)

    try {
      const updated = await wallet.syncVbaAllowedRemitters({
        customer_id: customerId,
        customer_metadata: (customer?.metadata ?? null) as
          | Record<string, unknown>
          | null,
      })
      if (!updated) {
        // Shouldn't happen given the list query, but guard anyway —
        // an active row that vanished mid-loop (e.g. closed by another
        // process) would land here.
        logger.warn(
          `[sync-vba] SKIP: customer=${customerId} vba=${vAccountId} (helper returned null)`,
        )
        skipped++
        continue
      }
      const remitterCount = (updated.allowed_remitters ?? []).length
      logger.info(
        `[sync-vba] OK : customer=${customerId} vba=${vAccountId} pushed_remitters=${remitterCount}`,
      )
      ok++
    } catch (err) {
      logger.error(
        `[sync-vba] FAIL: customer=${customerId} vba=${vAccountId} — ${
          err instanceof Error ? err.message : String(err)
        }`,
      )
      failed++
    }
  }

  logger.info(
    `[sync-vba] done — ok=${ok} failed=${failed} skipped=${skipped} total=${vbas.length}`,
  )
}
