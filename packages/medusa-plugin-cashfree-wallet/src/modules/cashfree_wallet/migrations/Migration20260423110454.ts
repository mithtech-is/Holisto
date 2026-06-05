import { Migration } from "@mikro-orm/migrations"

/**
 * Add admin-controlled processing-fee settings to the module-wide
 * `cashfree_setting` singleton row.
 *
 *   - `processing_fee_enabled` (bool, default true)  — kill switch
 *   - `processing_fee_rate`    (numeric(6,4), default 0.0200) —
 *                                decimal form, i.e. 0.0200 = 2%.
 *                                `numeric(6,4)` caps at 99.9999%,
 *                                plenty of headroom for any plausible
 *                                platform-fee change.
 *
 * Stored on `cashfree_setting` because that table is already the
 * singleton "module config" row (referral settings, VBA prefix, etc.).
 * Creating a separate `fee_setting` table would fragment config with
 * no upside.
 */
export class Migration20260423110454 extends Migration {
  async up(): Promise<void> {
    this.addSql(`
      ALTER TABLE "cashfree_setting"
        ADD COLUMN IF NOT EXISTS "processing_fee_enabled" BOOLEAN NOT NULL DEFAULT true,
        ADD COLUMN IF NOT EXISTS "processing_fee_rate"    NUMERIC(6,4) NOT NULL DEFAULT 0.0200;
    `)
  }

  async down(): Promise<void> {
    this.addSql(`
      ALTER TABLE "cashfree_setting"
        DROP COLUMN IF EXISTS "processing_fee_enabled",
        DROP COLUMN IF EXISTS "processing_fee_rate";
    `)
  }
}
