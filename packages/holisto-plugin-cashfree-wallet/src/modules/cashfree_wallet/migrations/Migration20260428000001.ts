import { Migration } from "@medusajs/framework/mikro-orm/migrations"

/**
 * Add `aadhaar_full` column to `aadhaar_record`.
 *
 * Per operator decision (2026-04-28): store the full 12-digit
 * Aadhaar in plaintext on this row, populated only after a
 * successful OTP-verify. Surfaced to admins via an explicit
 * "Reveal" toggle in the registry UI; default-masked.
 *
 * Encryption-at-rest will be layered on later (separate migration
 * + crypto helper). For now we trade off attack-surface for
 * implementation speed — explicit operator call.
 */
export class Migration20260428000001 extends Migration {
  override async up(): Promise<void> {
    this.addSql(
      `alter table "aadhaar_record" add column if not exists "aadhaar_full" text null;`,
    )
  }

  override async down(): Promise<void> {
    this.addSql(
      `alter table "aadhaar_record" drop column if exists "aadhaar_full";`,
    )
  }
}
