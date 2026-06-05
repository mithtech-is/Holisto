import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import {
  CASHFREE_WALLET_MODULE,
  CashfreeWalletService,
} from "../../../modules/cashfree_wallet"

/** GET /admin/company-requests?status= */
export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const status =
    (req.query.status as string | undefined) === undefined
      ? "pending"
      : (req.query.status as string)
  const limit = Math.min(
    Math.max(Number.parseInt(String(req.query.limit ?? "100"), 10) || 100, 1),
    200
  )
  const walletModule = req.scope.resolve(
    CASHFREE_WALLET_MODULE
  ) as CashfreeWalletService
  const [rows, count] = await walletModule.listAndCountCompanyRequests(
    status === "all" ? {} : { status: status as any },
    { take: limit, order: { created_at: "DESC" } as any }
  )
  res.json({ count, requests: rows })
}
