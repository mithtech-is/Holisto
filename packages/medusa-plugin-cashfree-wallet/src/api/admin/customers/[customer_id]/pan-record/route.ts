import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { Modules } from "@medusajs/framework/utils"
import {
  CASHFREE_WALLET_MODULE,
  CashfreeWalletService,
} from "../../../../../modules/cashfree_wallet"
import { logger } from "../../../../../utils/logger"

/**
 * GET /admin/customers/:customer_id/pan-record
 *
 * Returns the customer's PAN data — sourced from the GLOBAL
 * `pan_record` table, NOT from `customer.metadata`. The table is
 * the source of truth: it survives customer deletion, holds one
 * row per unique PAN, and is shared across customers if they
 * happen to verify the same PAN.
 *
 * The lookup path is: customer.metadata.pan_hash → pan_record by
 * hash. If `pan_hash` isn't on the customer (PAN never verified),
 * we return 404 — the admin tab renders an empty state.
 *
 * Response includes EVERY field on the pan_record row, raw. The
 * admin UI decides which to render.
 */
export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const customerId = req.params.customer_id as string
  if (!customerId) {
    return res.status(400).json({ message: "Missing customer_id" })
  }

  const customerModule = req.scope.resolve(Modules.CUSTOMER) as any
  const walletModule = req.scope.resolve(
    CASHFREE_WALLET_MODULE,
  ) as CashfreeWalletService

  try {
    const customer = await customerModule
      .retrieveCustomer(customerId)
      .catch(() => null)
    if (!customer) {
      return res.status(404).json({ message: "Customer not found" })
    }
    const meta = (customer.metadata ?? {}) as Record<string, unknown>
    const panHash = typeof meta.pan_hash === "string" ? meta.pan_hash : null
    if (!panHash) {
      return res.status(404).json({
        message: "No PAN on record for this customer",
        verified: false,
      })
    }
    const record = await walletModule.lookupPanRecordByHash(panHash)
    if (!record) {
      // Linked-but-missing: customer.metadata.pan_hash points to a
      // row that's been hard-deleted on the global table. Surface as
      // 404 with a hint — shouldn't happen unless ops manually
      // pruned the table.
      return res.status(404).json({
        message: "PAN record missing on global table — re-run verify",
        verified: false,
      })
    }
    res.json({ verified: true, pan_record: record })
  } catch (err: any) {
    logger.error("admin pan-record GET failed", {
      customer_id: customerId,
      error: err?.message,
    })
    res.status(500).json({ message: err?.message ?? "load_failed" })
  }
}
