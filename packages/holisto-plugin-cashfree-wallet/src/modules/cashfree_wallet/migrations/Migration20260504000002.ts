import { Migration } from "@medusajs/framework/mikro-orm/migrations";

/**
 * Aadhaar registry: persist `father_name` (extracted from Cashfree's
 * verify response — UIDAI XML calls it care_of, Cashfree echoes it
 * as father_name) and `card_masked_url` (local /static URL of the
 * Cashfree-masked Aadhaar CARD image, populated by the
 * aadhaar-masking flow).
 *
 * Both nullable; older rows verified before today's deploy will fall
 * back to null and the admin UI will hide those rows from the new
 * fields.
 */
export class Migration20260504000002 extends Migration {

  override async up(): Promise<void> {
    this.addSql(
      `alter table if exists "aadhaar_record" ` +
      `add column if not exists "father_name" text null;`,
    );
    this.addSql(
      `alter table if exists "aadhaar_record" ` +
      `add column if not exists "card_masked_url" text null;`,
    );
  }

  override async down(): Promise<void> {
    this.addSql(
      `alter table if exists "aadhaar_record" ` +
      `drop column if exists "father_name", ` +
      `drop column if exists "card_masked_url";`,
    );
  }
}
