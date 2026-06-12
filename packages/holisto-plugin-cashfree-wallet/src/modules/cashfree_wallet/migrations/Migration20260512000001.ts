import { Migration } from "@medusajs/framework/mikro-orm/migrations"

/**
 * Add `promo_amount_override_inr` to wallet_payment_attempt — stores the
 * customer's per-checkout choice of how much of the order to debit from
 * the promo bucket (vs. main). NULL means "drain max" (the historic
 * behavior: min(amount, promo_balance, promo_cap)).
 *
 * The column is set at `initiatePayment` from the storefront's slider
 * value (already clamped server-side to the legal range) and read again
 * at `authorizePayment` so the actual debit matches what the customer
 * saw at checkout — even if the wallet state changed between init and
 * authorize.
 *
 * Idempotent — IF NOT EXISTS on add. Down drops the column; existing
 * rows fall back to NULL = drain-max default.
 */
export class Migration20260512000001 extends Migration {
  override async up(): Promise<void> {
    this.addSql(
      `ALTER TABLE IF EXISTS "wallet_payment_attempt"
        ADD COLUMN IF NOT EXISTS "promo_amount_override_inr" integer;`,
    )
  }

  override async down(): Promise<void> {
    this.addSql(
      `ALTER TABLE IF EXISTS "wallet_payment_attempt"
        DROP COLUMN IF EXISTS "promo_amount_override_inr";`,
    )
  }
}
