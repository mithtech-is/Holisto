import { model } from "@medusajs/framework/utils"

/**
 * Customer-submitted proof of an offline bank transfer to the Polemarch
 * operational account. Used when Cashfree VBAs aren't available — the
 * customer transfers funds via regular NEFT/IMPS/UPI and uploads a
 * screenshot / receipt. Admin reviews and either credits the wallet
 * (on approval) or rejects with a reason.
 *
 * Crediting happens through the same `credit()` service helper that VBA
 * webhooks use, so ledger + idempotency behaviour is identical. The
 * resulting `WalletTransaction.kind` is `manual_adjust` with
 * `reference_type="manual"` and `reference_id=<this row id>`.
 */
export const DepositProof = model.define("deposit_proof", {
  id: model.id().primaryKey(),
  customer_id: model.text().index(),
  /** Rupees → paise. This is the customer's CLAIMED amount; admin may
   *  approve a different amount if proof doesn't match. */
  claimed_amount_inr: model.number(),
  credited_amount_inr: model.number().nullable(),
  /** Optional UTR / reference number the customer pasted in. */
  utr: model.text().nullable(),
  /** Free-form note from the customer (e.g. "Sent from HDFC Savings"). */
  customer_note: model.text().nullable(),
  /** Primary file — screenshot, PDF, or image URL (usually `/static/…`). */
  proof_file_url: model.text(),
  status: model
    .enum(["pending", "approved", "rejected"])
    .default("pending"),
  reviewer_user_id: model.text().nullable(),
  reviewer_notes: model.text().nullable(),
  reviewed_at: model.dateTime().nullable(),
  wallet_transaction_id: model.text().nullable(),
})
