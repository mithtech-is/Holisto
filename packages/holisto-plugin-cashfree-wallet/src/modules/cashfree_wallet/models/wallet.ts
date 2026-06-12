import { model } from "@medusajs/framework/utils"

/**
 * Per-customer INR wallet. Two sub-balances both stored in paise (integer)
 * to avoid decimal drift. All mutations must go through the service
 * `credit` / `creditPromo` / `debit` helpers which also write a
 * `WalletTransaction` row. Never mutate the balance columns directly.
 *
 *   balance_inr        — "main" balance. NEFT/IMPS deposits via Cashfree
 *                        VBA land here. Withdrawable / refundable to bank.
 *   promo_balance_inr  — "promo" balance. Referral rewards + gamification
 *                        point conversions land here. NOT withdrawable;
 *                        spendable on orders subject to a per-transaction
 *                        cap (see cashfree_setting.promo_max_*). Refunds
 *                        from a promo-paid order route back to this
 *                        bucket — promo can never become bank-money.
 *
 * `version` is used for optimistic concurrency control on debits. On a
 * concurrent debit the loser retries (max 3 attempts) before falling back to
 * the "insufficient funds → held order" branch.
 */
export const Wallet = model.define("wallet", {
  id: model.id().primaryKey(),
  customer_id: model.text().unique().index(),
  balance_inr: model.number().default(0),
  /** Promo / non-withdrawable bucket. Funded by referrals + points
   *  conversion; spent on orders alongside the main balance subject to
   *  the admin-configured cap. */
  promo_balance_inr: model.number().default(0),
  version: model.number().default(0),
  status: model.enum(["active", "frozen"]).default("active"),
})
