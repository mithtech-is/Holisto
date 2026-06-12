import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { z } from "zod"
import {
  CASHFREE_WALLET_MODULE,
  CashfreeWalletService,
} from "../../../modules/cashfree_wallet"
import { logger } from "../../../utils/logger"

/**
 * GET  /admin/cashfree-settings
 * POST /admin/cashfree-settings
 *
 * Backs the "Cashfree Settings" admin UI tab. The GET response masks every
 * secret to a 3-char-prefix-and-suffix preview so a casual page screenshot
 * can't leak a key. The POST treats blank ("") secret inputs as
 * "leave as-is" and `null` as "explicitly clear".
 *
 * Requires admin auth (bound in `src/api/middlewares.ts`).
 */

export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const walletModule = req.scope.resolve(
    CASHFREE_WALLET_MODULE
  ) as CashfreeWalletService
  try {
    const view = await walletModule.getCashfreeSettingsView()
    res.json(view)
  } catch (err) {
    logger.error("getCashfreeSettingsView failed", { error: err })
    res
      .status(500)
      .json({ message: (err as Error).message ?? "settings_load_failed" })
  }
}

const SaveSchema = z.object({
  env: z.enum(["sandbox", "production"]).optional(),
  client_id: z.string().nullable().optional(),
  // For each secret: empty string = no change, null = clear, value = update.
  client_secret: z.string().nullable().optional(),
  payouts_client_id: z.string().nullable().optional(),
  payouts_client_secret: z.string().nullable().optional(),
  webhook_secret: z.string().nullable().optional(),
  verify_webhook_secret: z.string().nullable().optional(),
  beneficiary_name: z.string().nullable().optional(),
})

export const POST = async (req: MedusaRequest, res: MedusaResponse) => {
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

  try {
    const view = await walletModule.saveCashfreeSettings({
      ...parsed.data,
      updated_by_user_id: adminUserId,
    })
    res.json(view)
  } catch (err) {
    logger.error("saveCashfreeSettings failed", { error: err })
    res
      .status(500)
      .json({ message: (err as Error).message ?? "settings_save_failed" })
  }
}
