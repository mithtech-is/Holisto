import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import {
  CASHFREE_WALLET_MODULE,
  CashfreeWalletService,
} from "../../../../../modules/cashfree_wallet"

/**
 * GET /admin/customers/:customer_id/audit-log
 *
 * Returns the append-only admin audit log for this customer, newest
 * first. Rendered in the "Audit log" tab of Customer 360.
 */
export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const { customer_id } = req.params
  const limit = Math.min(Number(req.query?.limit ?? 100), 500)

  const walletModule = req.scope.resolve(
    CASHFREE_WALLET_MODULE
  ) as CashfreeWalletService

  const entries = await walletModule
    .listAdminAuditLogs(
      { customer_id: customer_id as string },
      { take: limit, order: { created_at: "DESC" } }
    )
    .catch(() => [])

  return res.json({ entries })
}
