import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { z } from "zod"
import {
  CASHFREE_WALLET_MODULE,
  CashfreeWalletService,
} from "../../../../modules/cashfree_wallet"
import type {
  CashfreeProduct,
  CashfreeProductSettingsInput,
} from "../../../../modules/cashfree_wallet/service"
import { logger } from "../../../../utils/logger"

const PRODUCTS: CashfreeProduct[] = [
  "payment_gateway",
  "payouts",
  "subscriptions",
  "cross_border",
  "verification_suite",
]

function resolveProduct(p: string | undefined): CashfreeProduct | null {
  return p && (PRODUCTS as readonly string[]).includes(p)
    ? (p as CashfreeProduct)
    : null
}

/**
 * GET  /admin/cashfree-products/:product
 * POST /admin/cashfree-products/:product
 *
 * Per-product get + atomic save. The POST only touches the chosen
 * product's columns — sibling products and the opposite env are never
 * modified.
 */
export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const product = resolveProduct(req.params.product)
  if (!product) return res.status(404).json({ message: "unknown_product" })
  const walletModule = req.scope.resolve(
    CASHFREE_WALLET_MODULE
  ) as CashfreeWalletService
  try {
    const view = await walletModule.getCashfreeProductView(product)
    res.json(view)
  } catch (err) {
    logger.error("getCashfreeProductView failed", { error: err, product })
    res
      .status(500)
      .json({ message: (err as Error).message ?? "product_load_failed" })
  }
}

const SaveSchema = z.object({
  env: z.enum(["sandbox", "production"]).optional(),
  active_env: z.enum(["sandbox", "production"]).optional(),
  enabled: z.boolean().optional(),
  client_id: z.string().nullable().optional(),
  client_secret: z.string().nullable().optional(),
  webhook_secret: z.string().nullable().optional(),
  beneficiary_name: z.string().nullable().optional(),
  pg_notification_group: z.string().nullable().optional(),
  /** Verification-Suite-only per-kind toggles. Accepts a partial map —
   *  any key the admin didn't flip is left at its previous DB value. */
  verification_kinds: z
    .object({
      pan: z.boolean().optional(),
      aadhaar: z.boolean().optional(),
      bank: z.boolean().optional(),
      cmr: z.boolean().optional(),
    })
    .partial()
    .optional(),
})

export const POST = async (req: MedusaRequest, res: MedusaResponse) => {
  const product = resolveProduct(req.params.product)
  if (!product) return res.status(404).json({ message: "unknown_product" })
  const parsed = SaveSchema.safeParse(req.body)
  if (!parsed.success) {
    return res
      .status(400)
      .json({ message: "Invalid input", errors: parsed.error.flatten() })
  }
  const walletModule = req.scope.resolve(
    CASHFREE_WALLET_MODULE
  ) as CashfreeWalletService

  const adminUserId =
    (req as any).auth_context?.actor_id ??
    (req as any).auth_context?.app_metadata?.user_id ??
    null

  const input: CashfreeProductSettingsInput = {
    product,
    ...parsed.data,
    updated_by_user_id: adminUserId,
  }
  try {
    const view = await walletModule.saveCashfreeProductSettings(input)
    res.json(view)
  } catch (err) {
    logger.error("saveCashfreeProductSettings failed", { error: err, product })
    res
      .status(500)
      .json({ message: (err as Error).message ?? "product_save_failed" })
  }
}
