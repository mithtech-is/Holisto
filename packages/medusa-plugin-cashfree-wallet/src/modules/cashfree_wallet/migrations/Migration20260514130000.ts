import { Migration } from "@medusajs/framework/mikro-orm/migrations"

/**
 * Adds `processing_fee_max_inr` to `cashfree_setting`.
 *
 * Optional per-scrip cap on the percentage-based processing fee. Stored
 * as whole rupees; NULL = no cap. Applied per cart line item (per scrip)
 * via `min(line_subtotal × rate, max_inr)` at cart-fee reconciliation
 * time.
 *
 * Existing rows get NULL — same behavior as before (uncapped %-fee).
 */
export class Migration20260514130000 extends Migration {
  override async up(): Promise<void> {
    this.addSql(
      `ALTER TABLE "cashfree_setting" ADD COLUMN IF NOT EXISTS "processing_fee_max_inr" integer NULL;`,
    )
  }

  override async down(): Promise<void> {
    this.addSql(
      `ALTER TABLE "cashfree_setting" DROP COLUMN IF EXISTS "processing_fee_max_inr";`,
    )
  }
}
