import { model } from "@medusajs/framework/utils"

/**
 * Immutable ledger row for a wallet mutation. Every credit/debit writes one
 * row; the relevant balance column on `wallet` is the reduction of this
 * ledger filtered by `bucket` and must reconcile.
 *
 * `cashfree_event_id` is unique (nullable) so duplicate VBA webhook deliveries
 * cannot double-credit.
 *
 * `idempotency_key` is unique and covers non-webhook sources (e.g. a retrying
 * workflow for an order debit). For order debits we use
 * `order_<order_id>` for the main split and `order_<order_id>:promo` for
 * the promo split; for admin manual adjustments, a generated UUID.
 *
 * `bucket` records which sub-balance the row mutated:
 *   "main"  — `wallet.balance_inr`        (default; NEFT credits, normal
 *                                          order debits, manual adjusts)
 *   "promo" — `wallet.promo_balance_inr`  (referral credits, points
 *                                          conversions, the promo split
 *                                          of order debits, refunds back
 *                                          to source)
 * Always supplied by the service helpers; not nullable in new rows.
 */
export const WalletTransaction = model.define("wallet_transaction", {
  id: model.id().primaryKey(),
  wallet_id: model.text().index(),
  customer_id: model.text().index(),
  direction: model.enum(["credit", "debit"]),
  amount_inr: model.number(),
  balance_after: model.number(),
  kind: model.enum([
    "vba_credit",
    "order_debit",
    "order_reversal",
    "refund",
    "manual_adjust",
    "referral_credit",
    "points_conversion",
  ]),
  reference_type: model.enum(["order", "cart", "vba_event", "refund", "manual"]).nullable(),
  reference_id: model.text().nullable(),
  /** Which sub-balance this row mutated. Default 'main' for back-compat
   *  with rows written before promo-balance shipped (those are all main). */
  bucket: model.enum(["main", "promo"]).default("main"),
  // uniqueness enforced by partial unique index in migration (nullable column)
  cashfree_event_id: model.text().nullable(),
  idempotency_key: model.text().unique(),
  note: model.text().nullable(),
  metadata: model.json().nullable(),
})
