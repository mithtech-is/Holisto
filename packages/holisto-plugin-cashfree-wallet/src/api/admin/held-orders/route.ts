import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import {
  CASHFREE_WALLET_MODULE,
  CashfreeWalletService,
} from "../../../modules/cashfree_wallet"

/**
 * GET /admin/held-orders?status=&limit=&offset=
 *
 * List PaymentAttempts in the `held` state (checkout couldn't debit the
 * full amount yet). Admin can see which customers are waiting on funds.
 * Filterable by status for post-hoc audit of captured/cancelled ones.
 */
export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const status =
    (req.query.status as string | undefined) === undefined
      ? "held"
      : (req.query.status as string)
  const limit = Math.min(
    Math.max(Number.parseInt(String(req.query.limit ?? "50"), 10) || 50, 1),
    200
  )
  const offset = Math.max(
    Number.parseInt(String(req.query.offset ?? "0"), 10) || 0,
    0
  )

  const walletModule = req.scope.resolve(
    CASHFREE_WALLET_MODULE
  ) as CashfreeWalletService
  const [rows, count] = await walletModule.listAndCountPaymentAttempts(
    status === "all" ? {} : { status: status as any },
    { take: limit, skip: offset, order: { created_at: "DESC" } as any }
  )
  res.json({
    count,
    limit,
    offset,
    held_orders: rows.map((r) => ({
      id: r.id,
      cart_id: r.cart_id,
      customer_id: r.customer_id,
      amount_inr: r.amount_inr,
      wallet_balance_at_init: r.wallet_balance_at_init,
      shortfall_inr: r.shortfall_inr,
      status: r.status,
      created_at: r.created_at,
    })),
  })
}
