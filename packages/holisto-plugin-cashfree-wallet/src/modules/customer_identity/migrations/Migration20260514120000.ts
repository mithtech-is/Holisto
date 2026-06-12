import { Migration } from "@medusajs/framework/mikro-orm/migrations"

/**
 * Adds `pan_full` to `customer_identity_registry`.
 *
 * Until now the registry held only `pan_hash` (lookup key) and
 * `pan_masked` (display). The unencrypted PAN lived solely on
 * `pan_record.pan_full`, joined via `pan_hash`. We're duplicating it
 * onto the registry so the registry is self-sufficient — admin
 * "Reveal" works even if a `pan_record` row is missing or hasn't been
 * populated yet, and a `pan_record` purge does not strip identity rows
 * of their plaintext PAN. Surfaced to admins behind a Reveal toggle;
 * never returned by storefront APIs.
 *
 * Existing rows get NULL — the next PAN re-verify or a backfill run
 * will fill them in.
 */
export class Migration20260514120000 extends Migration {
  override async up(): Promise<void> {
    this.addSql(
      `ALTER TABLE "customer_identity_registry" ADD COLUMN IF NOT EXISTS "pan_full" text NULL;`,
    )
  }

  override async down(): Promise<void> {
    this.addSql(
      `ALTER TABLE "customer_identity_registry" DROP COLUMN IF EXISTS "pan_full";`,
    )
  }
}
