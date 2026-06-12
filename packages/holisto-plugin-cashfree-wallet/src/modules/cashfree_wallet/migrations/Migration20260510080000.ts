import { Migration } from "@medusajs/framework/mikro-orm/migrations";

/**
 * Adds admin-configurable low-quantity flat fee to cashfree_setting.
 *
 *   low_qty_fee_enabled       BOOL  default true
 *   low_qty_fee_threshold_inr INT   default 10000  (₹)
 *   low_qty_fee_amount_inr    INT   default 250    (₹)
 *
 * The storefront previously hard-coded these in
 * `apps/storefront/src/lib/constants.ts`. They're now persisted
 * here so the admin can tune them at /app/fees, parallel to the
 * existing processing-fee controls.
 */
export class Migration20260510080000 extends Migration {
  override async up(): Promise<void> {
    this.addSql(
      `ALTER TABLE IF EXISTS "cashfree_setting"
        ADD COLUMN IF NOT EXISTS "low_qty_fee_enabled" boolean NOT NULL DEFAULT true,
        ADD COLUMN IF NOT EXISTS "low_qty_fee_threshold_inr" integer NOT NULL DEFAULT 10000,
        ADD COLUMN IF NOT EXISTS "low_qty_fee_amount_inr" integer NOT NULL DEFAULT 250;`,
    );
  }

  override async down(): Promise<void> {
    this.addSql(
      `ALTER TABLE IF EXISTS "cashfree_setting"
        DROP COLUMN IF EXISTS "low_qty_fee_amount_inr",
        DROP COLUMN IF EXISTS "low_qty_fee_threshold_inr",
        DROP COLUMN IF EXISTS "low_qty_fee_enabled";`,
    );
  }
}
