import { model } from "@medusajs/framework/utils"

/**
 * One row per Medusa PaymentSession initialized under the cashfree-wallet
 * provider. Tracks whether the wallet debit happened, how much was short
 * at checkout, and the linked HeldOrder when the order is on hold.
 *
 * States:
 *   initiated → created by `initiatePayment`, no debit yet
 *   debited   → wallet debited, returning `authorized` to Medusa
 *   held      → insufficient wallet → HeldOrder row created, Medusa got
 *               `pending`; the order will auto-capture later
 *   captured  → held order was later funded and debited
 *   cancelled → cart abandoned / admin cancelled
 */
export const PaymentAttempt = model.define("wallet_payment_attempt", {
  id: model.id().primaryKey(),
  cart_id: model.text().index(),
  customer_id: model.text().index(),
  payment_session_id: model.text().index().nullable(),
  amount_inr: model.number(),
  wallet_balance_at_init: model.number(),
  shortfall_inr: model.number().default(0),
  wallet_debit_tx_id: model.text().nullable(),
  held_order_id: model.text().nullable(),
  /**
   * User-chosen promo bucket spend in paise for this attempt. When NULL,
   * `debitForOrder` falls back to "drain max" = min(amount, promo, cap).
   * When set, `debitForOrder` honors it (still clamped server-side to the
   * legal range — see service for the validation). Stored at init time so
   * the authorize step has the same value the customer saw at checkout.
   */
  promo_amount_override_inr: model.number().nullable(),
  status: model
    .enum(["initiated", "debited", "held", "captured", "cancelled"])
    .default("initiated"),
})
