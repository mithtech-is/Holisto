import { Migration } from "@medusajs/framework/mikro-orm/migrations"

/**
 * Add `pan_full` to `pan_record`.
 *
 * Forward-only. Existing rows stay null — those customers' VBAs
 * won't carry PAN on Cashfree's side (`kyc_details.pan` payload)
 * until the customer re-verifies their PAN, at which point the
 * verify route writes the plaintext to this column.
 *
 * Mirrors the retention contract on `aadhaar_record.aadhaar_full`
 * (added in an earlier migration): plaintext, nullable, only
 * exposed to admins via the registry's reveal toggle, never
 * returned to storefront APIs.
 *
 * Idempotent — guarded by `IF NOT EXISTS`.
 */
export class Migration20260506000001 extends Migration {
  override async up(): Promise<void> {
    this.addSql(
      `alter table if exists "pan_record" add column if not exists "pan_full" text null;`,
    )
  }

  override async down(): Promise<void> {
    this.addSql(
      `alter table if exists "pan_record" drop column if exists "pan_full";`,
    )
  }
}
