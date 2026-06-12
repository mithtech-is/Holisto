import { Migration } from "@medusajs/framework/mikro-orm/migrations"

/**
 * Per-side referral min-purchase thresholds.
 *
 *   cashfree_setting.referral_referrer_min_purchase_inr — ₹ threshold
 *     the referee's qualifying purchase must clear for the REFERRER
 *     side to credit. NULL falls back to legacy `referral_min_purchase_inr`.
 *   cashfree_setting.referral_referee_min_purchase_inr  — same, for the
 *     REFEREE side.
 *
 * Per-side gating means the operator can stage rewards: e.g. credit the
 * referee at ₹500 first-purchase but only credit the referrer at
 * ₹2 000. `creditFirstPurchaseReferral` checks each side independently,
 * so a partial credit on the referee's first order can complete on a
 * later (larger) order without double-crediting.
 *
 * Idempotent — IF NOT EXISTS on every column add. Down drops the new
 * columns; the legacy single field stays in place.
 */
export class Migration20260510170000 extends Migration {
  override async up(): Promise<void> {
    this.addSql(
      `ALTER TABLE IF EXISTS "cashfree_setting"
        ADD COLUMN IF NOT EXISTS "referral_referrer_min_purchase_inr" integer,
        ADD COLUMN IF NOT EXISTS "referral_referee_min_purchase_inr" integer;`,
    )
  }

  override async down(): Promise<void> {
    this.addSql(
      `ALTER TABLE IF EXISTS "cashfree_setting"
        DROP COLUMN IF EXISTS "referral_referee_min_purchase_inr",
        DROP COLUMN IF EXISTS "referral_referrer_min_purchase_inr";`,
    )
  }
}
