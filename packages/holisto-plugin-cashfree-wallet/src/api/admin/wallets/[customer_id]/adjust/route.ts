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

const REASON_CODES = [
  "promo",
  "goodwill",
  "reconciliation",
  "correction",
  "other",
] as const

const AdjustSchema = z.object({
  direction: z.enum(["credit", "debit"]),
  amount_inr: z.number().int().positive(),
  reason_code: z.enum(REASON_CODES),
  /** Which sub-balance the adjustment hits. Defaults to "main" if
   *  omitted (back-compat with the original single-bucket route).
   *  Promo bucket debits return `insufficient_funds` if the promo
   *  balance can't cover; refunds from a promo-paid order should go
   *  through the order-cancel pipeline, not this route. */
  bucket: z.enum(["main", "promo"]).optional(),
  /** Minimum 20 chars — audit-friendly context required for every
   *  manual wallet mutation. */
  note: z.string().trim().min(20).max(500),
})

/**
 * POST /admin/wallets/:customer_id/adjust
 *
 * Manual credit or debit with a required reason code + 20-char minimum
 * note. Writes an AdminAuditLog row with before/after balance.
 */
export const POST = async (req: MedusaRequest, res: MedusaResponse) => {
  const parsed = AdjustSchema.safeParse(req.body)
  if (!parsed.success) {
    return res
      .status(400)
      .json({ message: "Invalid input", errors: parsed.error.flatten() })
  }
  const { direction, amount_inr, reason_code, note } = parsed.data
  const bucket = parsed.data.bucket ?? "main"
  const { customer_id } = req.params
  const adminUserId =
    (req as any).auth_context?.actor_id ??
    (req as any).auth_context?.app_metadata?.user_id ??
    "unknown_admin"

  const walletModule = req.scope.resolve(
    CASHFREE_WALLET_MODULE
  ) as CashfreeWalletService

  try {
    // Snapshot the wallet before so the audit log has a diffable before/after.
    const before = await walletModule.ensureWallet(customer_id as string)

    const result = await walletModule.adjustWalletWithReason({
      customer_id: customer_id as string,
      amount_inr,
      direction,
      reason_code,
      note,
      admin_user_id: adminUserId,
      bucket,
    })

    // If debit returned insufficient_funds / wallet_frozen, surface
    // that and skip audit + email.
    if (direction === "debit" && (result as any).ok === false) {
      return res.status(400).json({ ok: false, debit: result })
    }

    const after = await walletModule.ensureWallet(customer_id as string)

    await walletModule.logAdminAction({
      admin_user_id: adminUserId,
      customer_id: customer_id as string,
      action: "wallet_adjust",
      before: {
        balance_inr: Number(before.balance_inr),
        promo_balance_inr: Number(before.promo_balance_inr ?? 0),
        status: before.status,
      },
      after: {
        balance_inr: Number(after.balance_inr),
        promo_balance_inr: Number(after.promo_balance_inr ?? 0),
        status: after.status,
      },
      note,
      // Stamp bucket into the reason_code so the audit log filter +
      // history view both surface "promo:promo" / "main:goodwill"
      // without needing to re-derive from the before/after balance
      // delta.
      reason_code: `${bucket}:${reason_code}`,
    })

    await sendEventEmail(
      req.scope,
      direction === "credit" ? "wallet.credited" : "wallet.debited",
      {
        customer_id: customer_id as string,
        amount_inr: paiseToInrStr(amount_inr),
        reason: reason_code,
        note,
        // Send the bucket-specific balance the customer cares about
        // — promo notification shows promo, main shows main. Falling
        // back to combined main if promo balance is zero on the row.
        wallet_balance_inr: paiseToInrStr(
          bucket === "promo"
            ? Number(after.promo_balance_inr ?? 0)
            : Number(after.balance_inr),
        ),
        bucket,
      },
    )

    return res.json({ ok: true, bucket, transaction: result })
  } catch (err) {
    const msg = (err as Error).message
    if (msg === "adjust_amount_must_be_positive" || msg === "adjust_note_min_20_chars") {
      return res.status(400).json({ message: msg })
    }
    logger.error("wallet adjust failed", { customer_id, err })
    return res.status(500).json({ message: msg })
  }
}
