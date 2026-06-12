import { Migration } from "@medusajs/framework/mikro-orm/migrations"

/**
 * Decouple the two referral credits.
 *
 * Old behaviour (pre-2026-05-15):
 *   - Both referrer + referee credits fired in one atomic transaction
 *     the moment the referee placed an order whose item-subtotal
 *     cleared `referral_min_purchase_inr` (default ₹1 000).
 *
 * New behaviour:
 *   - REFEREE credit fires the moment KYC completes (overall='approved',
 *     i.e. PAN + Aadhaar + Bank + Demat all green). No purchase gate.
 *   - REFERRER credit fires when the referee's CUMULATIVE lifetime buy
 *     value (sum of item-subtotal × quantity across every non-cancelled
 *     order) crosses `referral_min_purchase_inr` (semantic shifted from
 *     "first-order minimum" to "cumulative-lifetime threshold"; default
 *     value bumped from ₹1 000 → ₹10 000 for fresh installs — existing
 *     rows keep whatever the operator had set).
 *
 * Schema impact:
 *   - Add `referee_credited_at` to track the referee-side credit
 *     separately from the existing `credited_at` (which now strictly
 *     means the referrer side was credited).
 *
 * The existing `referral_referrer_min_purchase_inr` /
 * `referral_referee_min_purchase_inr` columns (added in
 * Migration20260510170000 for per-side first-order thresholds) become
 * dead weight under the new model and are left as-is for back-compat;
 * the new code path ignores them. A future cleanup migration can drop.
 */
export class Migration20260512190000 extends Migration {
  override async up(): Promise<void> {
    this.addSql(
      `ALTER TABLE IF EXISTS "referral"
        ADD COLUMN IF NOT EXISTS "referee_credited_at" text;`,
    )
  }

  override async down(): Promise<void> {
    this.addSql(
      `ALTER TABLE IF EXISTS "referral"
        DROP COLUMN IF EXISTS "referee_credited_at";`,
    )
  }
}
