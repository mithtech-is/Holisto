import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import {
  CASHFREE_WALLET_MODULE,
  CashfreeWalletService,
} from "../../../modules/cashfree_wallet"
import { logger } from "../../../utils/logger"

/**
 * GET /admin/cashfree-products
 *
 * Hydrates the new /app/cashfree admin page. Returns one view per
 * product (payment_gateway, payouts, subscriptions, cross_border,
 * verification_suite) — both envs' configured state, masked.
 *
 * Auth is bound in `src/api/middlewares.ts`.
 */
export const GET = async (_req: MedusaRequest, res: MedusaResponse) => {
  const walletModule = _req.scope.resolve(
    CASHFREE_WALLET_MODULE
  ) as CashfreeWalletService
  try {
    const products = await walletModule.listCashfreeProductViews()
    res.json({ products })
  } catch (err) {
    logger.error("listCashfreeProductViews failed", { error: err })
    res
      .status(500)
      .json({ message: (err as Error).message ?? "products_load_failed" })
  }
}
