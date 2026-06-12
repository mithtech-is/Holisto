import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { z } from "zod"
import {
  CASHFREE_WALLET_MODULE,
  CashfreeWalletService,
} from "../../../../../modules/cashfree_wallet"
import { sendEventEmail } from "../../../../../lib/send-event-email"

const BodySchema = z.object({
  action: z.enum(["freeze", "unfreeze"]),
  note: z.string().trim().max(500).optional(),
})

/**
 * POST /admin/wallets/:customer_id/freeze
 *
 * Toggle wallet between "active" and "frozen". Frozen wallets reject
 * all credits and debits (the service enforces this via `credit()` /
 * `debit()` helpers). Writes an AdminAuditLog row.
 */
export const POST = async (req: MedusaRequest, res: MedusaResponse) => {
  const parsed = BodySchema.safeParse(req.body)
  if (!parsed.success) {
    return res
      .status(400)
      .json({ message: "Invalid input", errors: parsed.error.flatten() })
  }
  const { action, note } = parsed.data
  const { customer_id } = req.params
  const adminUserId =
    (req as any).auth_context?.actor_id ??
    (req as any).auth_context?.app_metadata?.user_id ??
    "unknown_admin"

  const walletModule = req.scope.resolve(
    CASHFREE_WALLET_MODULE
  ) as CashfreeWalletService

  const before = await walletModule.ensureWallet(customer_id as string)
  const result =
    action === "freeze"
      ? await walletModule.freezeWallet(customer_id as string)
      : await walletModule.unfreezeWallet(customer_id as string)

  await walletModule.logAdminAction({
    admin_user_id: adminUserId,
    customer_id: customer_id as string,
    action: action === "freeze" ? "wallet_freeze" : "wallet_unfreeze",
    before: { status: before.status },
    after: { status: result.status },
    note: note ?? null,
  })

  if (action === "freeze") {
    await sendEventEmail(req.scope, "wallet.frozen", {
      customer_id: customer_id as string,
      note: note ?? "Temporary hold while we review your account.",
    })
  }

  return res.json({ ok: true, status: result.status })
}
