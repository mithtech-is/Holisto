import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { Modules } from "@medusajs/framework/utils"
import {
  CASHFREE_WALLET_MODULE,
  CashfreeWalletService,
} from "../../../modules/cashfree_wallet"

/**
 * GET /admin/manual-kyc-queues
 *
 * Aggregates ALL the queues that need admin attention besides the
 * `manual_kyc_request` inbox (which has its own list endpoint at
 * /admin/manual-kyc-requests). Currently:
 *
 *   - banks_pending     — bank_account rows with verification_status
 *                         ∈ {name_mismatch, failed} (admin can override
 *                         via /admin/bank-accounts/:id/verify).
 *   - demats_pending    — demat_account rows with verification_status
 *                         ∈ {pending, name_mismatch, failed} (admin
 *                         reviews the uploaded CMR PDF and overrides
 *                         via /admin/demat-accounts/:id/verify).
 *
 * Each row is enriched with the customer's email + name so the admin
 * page renders without a second customer fetch per row.
 *
 * The Manual-KYC admin page surfaces these as separate sections under
 * "Bank reviews" and "Demat reviews" so an operator handling
 * partial-match items can resolve PAN/Aadhaar/Bank/Demat all in one
 * place.
 */
export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const limit = Math.min(
    Math.max(
      Number.parseInt(String(req.query.limit ?? "100"), 10) || 100,
      1,
    ),
    500,
  )

  const walletModule = req.scope.resolve(
    CASHFREE_WALLET_MODULE,
  ) as CashfreeWalletService
  const customerModule: any = req.scope.resolve(Modules.CUSTOMER)

  // Bank rows that need admin attention. We want any non-verified row;
  // PMLA / fraud-review states stay out of THIS queue and use their own
  // admin path. The list module method takes a filter object.
  const allBanks = (await walletModule
    .listBankAccounts({}, { take: 5000, order: { created_at: "DESC" } as any })
    .catch(() => [] as any[])) as any[]
  const pendingBanks = allBanks
    .filter(
      (b) =>
        b.verification_status === "name_mismatch" ||
        b.verification_status === "failed",
    )
    .slice(0, limit)

  // Demats: every newly-added demat is `pending` until ops eyeballs the
  // CMR PDF. Surface those + name-mismatch rows. `failed` is rare here
  // (no live machine-verify path) but included for symmetry.
  const allDemats = (await walletModule
    .listDematAccounts(
      {},
      { take: 5000, order: { created_at: "DESC" } as any },
    )
    .catch(() => [] as any[])) as any[]
  const pendingDemats = allDemats
    .filter(
      (d) =>
        d.verification_status === "pending" ||
        d.verification_status === "name_mismatch" ||
        d.verification_status === "failed",
    )
    .slice(0, limit)

  // Hydrate customer email + name in one batched pass.
  const customerIds = Array.from(
    new Set([
      ...pendingBanks.map((b) => b.customer_id),
      ...pendingDemats.map((d) => d.customer_id),
    ]),
  ).filter(Boolean) as string[]
  const customers = await Promise.all(
    customerIds.map((id) =>
      customerModule.retrieveCustomer(id).catch(() => null),
    ),
  )
  const customerById = new Map<string, any>()
  for (const c of customers) if (c) customerById.set(c.id, c)

  // ── Registry lookups ────────────────────────────────────────────
  // Each pending bank gets its `bank_record` row attached so the
  // admin sees the canonical Cashfree-side data (registered name,
  // name-match score, account_status, etc.) right next to the
  // submitted holder name and the bank-proof PDF — no Customer 360
  // round-trip needed.
  //
  // Each pending demat gets the customer's PAN registry holder
  // name + Aadhaar registry holder name pulled via the metadata
  // hashes. CMR rows themselves don't have a "demat registry" —
  // the canonical names to compare against the CMR PDF live on the
  // PAN / Aadhaar registries.
  const bankRecords = await Promise.all(
    pendingBanks.map((b) =>
      b.bank_hash
        ? walletModule.lookupBankRecordByHash(b.bank_hash).catch(() => null)
        : Promise.resolve(null),
    ),
  )

  // For every customer with a pending demat, fetch their PAN +
  // Aadhaar records once. The demat enrichment then indexes off this
  // single map so we don't refetch per-demat for the same customer.
  type RegistryNames = {
    pan_registered_name: string | null
    pan_name_on_card: string | null
    aadhaar_holder_name: string | null
  }
  const registryByCustomer = new Map<string, RegistryNames>()
  await Promise.all(
    Array.from(new Set(pendingDemats.map((d) => d.customer_id))).map(
      async (cid) => {
        const c = customerById.get(cid)
        const meta = (c?.metadata ?? {}) as Record<string, any>
        const panHash =
          typeof meta.pan_hash === "string" ? meta.pan_hash : null
        const aadHash =
          typeof meta.aadhaar_hash === "string" ? meta.aadhaar_hash : null
        const [pan, aad] = await Promise.all([
          panHash
            ? walletModule.lookupPanRecordByHash(panHash).catch(() => null)
            : Promise.resolve(null),
          aadHash
            ? walletModule
                .lookupAadhaarRecordByHash(aadHash)
                .catch(() => null)
            : Promise.resolve(null),
        ])
        registryByCustomer.set(cid, {
          pan_registered_name:
            (pan as any)?.registered_name ?? null,
          pan_name_on_card: (pan as any)?.name_pan_card ?? null,
          aadhaar_holder_name: (aad as any)?.name ?? null,
        })
      },
    ),
  )

  res.json({
    banks_pending: {
      count: pendingBanks.length,
      items: pendingBanks.map((b, i) => {
        const c = customerById.get(b.customer_id)
        const rec = bankRecords[i] as any
        return {
          id: b.id,
          customer_id: b.customer_id,
          email: c?.email ?? null,
          first_name: c?.first_name ?? null,
          last_name: c?.last_name ?? null,
          account_holder_name: b.account_holder_name,
          bank_name: b.bank_name,
          account_number_last4: b.account_number_last4,
          ifsc: b.ifsc,
          verification_status: b.verification_status,
          name_match_score: b.name_match_score,
          created_at: b.created_at,
          bank_proof_file_url: b.bank_proof_file_url ?? null,
          // Bank registry slice — what Cashfree's penny-drop confirmed
          // for THIS account at first verification. null when no
          // registry row exists yet (cache miss).
          registry: rec
            ? {
                name_at_bank: rec.name_at_bank ?? null,
                name_match_result: rec.name_match_result ?? null,
                name_match_score: rec.name_match_score ?? null,
                account_status: rec.account_status ?? null,
                account_status_code: rec.account_status_code ?? null,
                bank_name: rec.bank_name ?? null,
                branch: rec.branch ?? null,
                city: rec.city ?? null,
                first_verified_at: rec.first_verified_at ?? null,
                last_refreshed_at: rec.last_refreshed_at ?? null,
              }
            : null,
        }
      }),
    },
    demats_pending: {
      count: pendingDemats.length,
      items: pendingDemats.map((d) => {
        const c = customerById.get(d.customer_id)
        const reg = registryByCustomer.get(d.customer_id) ?? null
        return {
          id: d.id,
          customer_id: d.customer_id,
          email: c?.email ?? null,
          first_name: c?.first_name ?? null,
          last_name: c?.last_name ?? null,
          account_holder_name: d.account_holder_name,
          depository: d.depository,
          dp_name: d.dp_name,
          dp_id: d.dp_id ?? null,
          client_id: d.client_id ?? null,
          boid: d.boid ?? null,
          verification_status: d.verification_status,
          cmr_file_url: d.cmr_file_url ?? null,
          is_primary: d.is_primary,
          created_at: d.created_at,
          // Customer's PAN + Aadhaar canonical names — the values
          // the CMR's holder name should match. Surfacing them here
          // saves the admin from popping over to Customer 360.
          registry: reg,
        }
      }),
    },
  })
}
