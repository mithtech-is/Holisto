import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import {
  CASHFREE_WALLET_MODULE,
  CashfreeWalletService,
} from "../../../../../modules/cashfree_wallet"

/**
 * GET /admin/customers/:customer_id/virtual-account
 *
 * Returns the customer's active Cashfree VBA(s) for display in
 * Customer-360 → Bank & Demat tab. Per-customer model: at most one
 * active row per customer, but we list-and-return so legacy rows
 * (where the VBA was per-bank) still surface.
 *
 * Empty array when the customer has never been provisioned a VBA
 * (no verified bank yet, or VBA call failed and was never retried).
 */
export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const { customer_id } = req.params
  const walletModule = req.scope.resolve(
    CASHFREE_WALLET_MODULE,
  ) as CashfreeWalletService

  const [vbas, settingRows] = await Promise.all([
    walletModule
      .listCashfreeVirtualAccounts({
        customer_id: customer_id as string,
      })
      .catch(() => [] as any[]),
    walletModule
      .listCashfreeSettings({ singleton_key: "default" } as any, { take: 1 })
      .catch(() => [] as any[]),
  ])

  // Platform-level beneficiary override — admin-editable in
  // /app/cashfree → Payment Gateway → "Default beneficiary name".
  // Same override the storefront applies in GET /store/bank-accounts.
  const platformBeneficiary =
    typeof (settingRows[0] as any)?.beneficiary_name === "string" &&
    (settingRows[0] as any).beneficiary_name.trim().length > 0
      ? (settingRows[0] as any).beneficiary_name.trim()
      : null

  // Enrich each ACTIVE VBA row with the Cashfree-side kyc + remitter
  // lock state via a parallel batch of `GET /pg/vba/{id}` calls.
  // Otherwise the admin UI has no way to confirm whether kyc actually
  // landed on Cashfree's side — `cashfree_virtual_account` (our DB
  // row) only mirrors what we sent at create time, not Cashfree's
  // current view. Closed VBAs are skipped (their status implies
  // they're no longer interesting to ops, and a stale lookup would
  // fail or 404).
  //
  // Best-effort: a Cashfree GET failure on any single VBA leaves
  // that row's `live_kyc` / `live_allowed_remitters` as `null`.
  // We never block the response — the local row still renders the
  // canonical fields (number, IFSC, etc.).
  const ac = await walletModule.getAutoCollect().catch(() => null)
  const liveByVbaId = new Map<
    string,
    {
      kyc: { pan?: string; aadhaar?: string } | null
      allowed_remitters: Array<{ account_number: string; ifsc: string }> | null
      vba_status: string | null
    }
  >()
  if (ac) {
    await Promise.all(
      (vbas as any[])
        .filter((v) => v.status === "active")
        .map(async (v) => {
          try {
            const live = await ac.getVba(v.virtual_account_id)
            const raw = (live as any)?.raw ?? {}
            liveByVbaId.set(v.virtual_account_id, {
              kyc: (raw.kyc_details ?? null) as
                | { pan?: string; aadhaar?: string }
                | null,
              allowed_remitters:
                (raw.remitter_lock_details?.allowed_remitters ?? null) as
                  | Array<{ account_number: string; ifsc: string }>
                  | null,
              vba_status: (live as any)?.vba_status ?? null,
            })
          } catch {
            // Swallow — leave map untouched; UI shows "—" for that row.
          }
        }),
    )
  }

  res.json({
    virtual_accounts: vbas.map((v: any) => {
      const live = liveByVbaId.get(v.virtual_account_id) ?? null
      return {
        id: v.id,
        virtual_account_id: v.virtual_account_id,
        virtual_account_number: v.virtual_account_number,
        ifsc: v.ifsc,
        upi_id: v.upi_id ?? null,
        bank_code: v.bank_code ?? null,
        // Display the platform-level beneficiary first (matches what
        // the customer sees on the storefront), with the per-VBA name
        // we sent to Cashfree as the audit-trail value.
        beneficiary_name_display:
          platformBeneficiary ?? v.beneficiary_name ?? null,
        cashfree_account_holder_name: v.beneficiary_name ?? null,
        status: v.status,
        bank_account_id: v.bank_account_id ?? null,
        created_at: v.created_at,
        updated_at: v.updated_at,
        // Live Cashfree-side state. `null` when GET fails or VBA is
        // closed — UI should render "—" / "(not loaded)".
        live_kyc: live?.kyc ?? null,
        live_allowed_remitters: live?.allowed_remitters ?? null,
        live_status: live?.vba_status ?? null,
      }
    }),
  })
}
