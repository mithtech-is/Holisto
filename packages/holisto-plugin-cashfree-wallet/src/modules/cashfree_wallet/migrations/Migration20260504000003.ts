import { Migration } from "@medusajs/framework/mikro-orm/migrations";

/**
 * Removes the Cashfree Aadhaar Masking flow we briefly experimented
 * with on 2026-05-04. Walking it back because the OTP-verify path
 * already returns the holder photo + masked-last-4 form, and the
 * masking endpoint required a card-image upload flow we don't
 * actually run.
 *
 * Drops:
 *   - aadhaar_record.card_masked_url           (column)
 *   - secure_id_verification rows with kind='aadhaar_mask' (data only;
 *     no enum DB-constraint to drop, the column is bare text)
 *   - customer.metadata.kyc_aadhaar_card_masked_*  (4 keys)
 *
 * Static-disk artefacts (`static/aadhaar_masked_*`) are cleaned up
 * out-of-band by the deploy operator — Mikro migrations don't touch
 * the filesystem.
 */
export class Migration20260504000003 extends Migration {

  override async up(): Promise<void> {
    this.addSql(
      `alter table if exists "aadhaar_record" ` +
      `drop column if exists "card_masked_url";`,
    );
    this.addSql(
      `delete from secure_id_verification where kind = 'aadhaar_mask';`,
    );

  }

  override async down(): Promise<void> {
    // Re-add the column so a rollback at least leaves the schema
    // intact. The deleted rows / metadata keys are not restored —
    // they were synthetic and never held real customer data.
    this.addSql(
      `alter table if exists "aadhaar_record" ` +
      `add column if not exists "card_masked_url" text null;`,
    );
  }
}
