import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import {
  CASHFREE_WALLET_MODULE,
  CashfreeWalletService,
} from "../../../../../modules/cashfree_wallet"

/**
 * POST /admin/held-orders/:id/cancel
 *
 * Administratively cancel a PaymentAttempt that's stuck in the held state
 * (customer abandoned checkout, wrong amount, etc.). Does not touch the
 * wallet — no debit has occurred for a held attempt.
 */
export const POST = async (req: MedusaRequest, res: MedusaResponse) => {
  const { id } = req.params
  const walletModule = req.scope.resolve(
    CASHFREE_WALLET_MODULE
  ) as CashfreeWalletService
  const attempt = await walletModule
    .retrievePaymentAttempt(id as string)
    .catch(() => null)
  if (!attempt) return res.status(404).json({ message: "Not found" })
  if (attempt.status !== "held" && attempt.status !== "initiated") {
    return res.status(400).json({
      message: `Cannot cancel attempt in status '${attempt.status}'`,
    })
  }
  await walletModule.updatePaymentAttempts({
    selector: { id: attempt.id },
    data: { status: "cancelled" },
  })
  res.json({ ok: true })
}
