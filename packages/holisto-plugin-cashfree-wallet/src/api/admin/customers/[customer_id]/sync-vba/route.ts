import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import {
  CASHFREE_WALLET_MODULE,
  CashfreeWalletService,
} from "../../../../../modules/cashfree_wallet"
import { logger } from "../../../../../utils/logger"

/**
 * POST /admin/customers/:customer_id/sync-vba
 *
 * Push the customer's currently-verified bank list to Cashfree as the
 * VBA's `allowed_remitters` via `PUT /pg/vba/{virtual_account_id}`.
 *
 * Distinct from `/admin/customers/:customer_id/provision-vba`:
 *   - `provision-vba` → idempotent; mints a VBA if missing, returns the
 *     existing one if present. Does NOT update an existing VBA.
 *   - `sync-vba`     → updates an existing VBA's allowed_remitters list
 *                      to match the customer's current verified banks.
 *                      Returns 404 if no active VBA exists (call
 *                      provision-vba first).
 *
 * Idempotent — safe to call multiple times. Cashfree's
 * `allowed_remitters` is a REPLACE list, so each call simply pushes
 * the current snapshot.
 *
 * Use cases:
 *   - Backfilling an existing VBA after the per-customer migration so
 *     Cashfree's lock list reflects all of the customer's verified
 *     banks (not just the one that was active at create time).
 *   - Reconciliation cron — drift-checking + auto-correcting.
 *   - Ops "force-resync" button when something looks off.
 */
export const POST = async (req: MedusaRequest, res: MedusaResponse) => {
  const { customer_id } = req.params as { customer_id: string }
  if (!customer_id) {
    return res.status(400).json({ message: "Missing customer_id" })
  }

  const walletModule = req.scope.resolve(
    CASHFREE_WALLET_MODULE,
  ) as CashfreeWalletService
  const customerModule: any = req.scope.resolve("customer")

  // Fetch customer so we can pass `customer_metadata` to the sync —
  // that's where the wallet service reads pan_hash + aadhaar_hash +
  // aadhaar_full_number to build the kyc_details payload Cashfree
  // needs. A fetch failure isn't fatal — sync still runs without
  // kyc; it just won't refresh the kyc block on Cashfree's side.
  const customer = await customerModule
    .retrieveCustomer(customer_id)
    .catch(() => null)

  try {
    const updated = await walletModule.syncVbaAllowedRemitters({
      customer_id,
      customer_metadata: (customer?.metadata ?? null) as
        | Record<string, unknown>
        | null,
    })
    if (!updated) {
      return res.status(404).json({
        ok: false,
        code: "vba.not_found",
        message:
          "Customer has no active VBA to sync. Call POST /admin/customers/" +
          customer_id +
          "/provision-vba first.",
      })
    }
    return res.json({
      ok: true,
      customer_id,
      virtual_account_id: updated.virtual_account_id,
      vba_account_number: updated.vba_account_number,
      vba_ifsc: updated.vba_ifsc,
      vba_status: updated.vba_status,
      // Surface the Cashfree-side list so ops can eyeball it after the
      // sync without a separate GET round-trip.
      allowed_remitters: updated.allowed_remitters ?? [],
    })
  } catch (err) {
    logger.error("admin sync-vba failed", {
      customer_id,
      error: err,
    })
    return res.status(502).json({
      ok: false,
      message: (err as Error).message ?? "VBA sync failed",
    })
  }
}
