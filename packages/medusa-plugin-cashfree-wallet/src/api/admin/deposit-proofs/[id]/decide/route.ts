import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { z } from "zod"
import {
  CASHFREE_WALLET_MODULE,
  CashfreeWalletService,
} from "../../../../../modules/cashfree_wallet"
import { logger } from "../../../../../utils/logger"
import { sendEventEmail } from "../../../../../lib/send-event-email"

const paiseToInrStr = (paise: number): string =>
  Math.round(paise / 100).toLocaleString("en-IN")

/**
 * POST /admin/deposit-proofs/:id/decide
 *
 * Approve credits the customer's wallet with `credit_amount_inr` (default
 * = claimed amount) and marks the proof approved. Reject just closes the
 * proof row with a reason.
 *
 * Body:
 *   { decision: "approved" | "rejected",
 *     credit_amount_inr?: number,   // paise — default claimed_amount_inr
 *     notes?: string }
 */
const BodySchema = z.object({
  decision: z.enum(["approved", "rejected"]),
  credit_amount_inr: z.number().int().positive().optional(),
  notes: z.string().trim().max(1000).optional().nullable(),
})

export const POST = async (req: MedusaRequest, res: MedusaResponse) => {
  const parsed = BodySchema.safeParse(req.body)
  if (!parsed.success) {
    return res
      .status(400)
      .json({ message: "Invalid input", errors: parsed.error.flatten() })
  }
  const { id } = req.params
  if (!id) return res.status(400).json({ message: "Missing id" })

  const walletModule = req.scope.resolve(
    CASHFREE_WALLET_MODULE
  ) as CashfreeWalletService
  const proof = await walletModule
    .retrieveDepositProof(id as string)
    .catch(() => null)
  if (!proof) return res.status(404).json({ message: "Not found" })
  if (proof.status !== "pending") {
    return res
      .status(400)
      .json({ message: `Already ${proof.status}` })
  }
  const adminUserId =
    (req as any).auth_context?.actor_id ??
    (req as any).auth_context?.app_metadata?.user_id ??
    null

  if (parsed.data.decision === "rejected") {
    const updated = await walletModule.updateDepositProofs({
      selector: { id: proof.id },
      data: {
        status: "rejected",
        reviewer_user_id: adminUserId,
        reviewer_notes: parsed.data.notes ?? null,
        reviewed_at: new Date(),
      },
    })
    await sendEventEmail(req.scope, "wallet.deposit_proof_rejected", {
      customer_id: proof.customer_id,
      claimed_amount_inr: paiseToInrStr(proof.claimed_amount_inr),
      reason: parsed.data.notes ?? "No reason provided.",
    })
    return res.json({ proof: Array.isArray(updated) ? updated[0] : updated })
  }

  // Approved — credit the wallet
  const creditAmount = parsed.data.credit_amount_inr ?? proof.claimed_amount_inr
  try {
    const tx = await walletModule.credit({
      customer_id: proof.customer_id,
      amount_inr: creditAmount,
      kind: "manual_adjust",
      reference_type: "manual",
      reference_id: proof.id,
      idempotency_key: `deposit_proof_${proof.id}`,
      note: `Manual deposit approved by ${adminUserId ?? "admin"}`,
      metadata: {
        deposit_proof_id: proof.id,
        admin_user_id: adminUserId,
        utr: proof.utr ?? null,
        claimed_amount_inr: proof.claimed_amount_inr,
        approved_amount_inr: creditAmount,
        reason: parsed.data.notes ?? null,
      },
    })
    const updated = await walletModule.updateDepositProofs({
      selector: { id: proof.id },
      data: {
        status: "approved",
        credited_amount_inr: creditAmount,
        reviewer_user_id: adminUserId,
        reviewer_notes: parsed.data.notes ?? null,
        reviewed_at: new Date(),
        wallet_transaction_id: tx.id,
      },
    })
    // Drain held orders after the credit
    await walletModule
      .captureHeldPaymentAttempts(proof.customer_id)
      .catch((e) => logger.warn("drain after deposit approval failed", { error: e }))
    await sendEventEmail(req.scope, "wallet.deposit_proof_approved", {
      customer_id: proof.customer_id,
      claimed_amount_inr: paiseToInrStr(proof.claimed_amount_inr),
      credited_amount_inr: paiseToInrStr(creditAmount),
      utr: proof.utr ?? "—",
      reviewer_notes: parsed.data.notes ?? "",
    })
    res.json({
      proof: Array.isArray(updated) ? updated[0] : updated,
      wallet_transaction_id: tx.id,
    })
  } catch (err) {
    logger.error("deposit approval failed", { proof_id: proof.id, error: err })
    res.status(500).json({ message: (err as Error).message })
  }
}
