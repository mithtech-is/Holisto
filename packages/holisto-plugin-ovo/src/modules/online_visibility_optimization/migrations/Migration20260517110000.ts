import { Migration } from "@medusajs/framework/mikro-orm/migrations"

/**
 * Phase 12 — Chrome UX Report (CrUX) ingestion.
 *
 * Adds one nullable column on `ovo_setting`:
 *   - `crux_api_key_encrypted` — Google Cloud API key with the CrUX
 *     API enabled, encrypted at rest via
 *     `cashfree/crypto.ts:encryptString`. Falls back to env var
 *     `CRUX_API_KEY` when null.
 *
 * Reuses the engine-agnostic `ovo_seo_metric` table (engine="crux")
 * rather than creating a CWV-specific table — keeps line charts on
 * one read shape and avoids a duplicate retention/prune cron.
 *
 * Model-less convention same as the AI-key columns from
 * Migration20260515300000 — column accessed via
 * `(row as any).crux_api_key_encrypted` in the service layer.
 *
 * Reverse drops the column. No data-table changes.
 */
export class Migration20260517110000 extends Migration {
  override async up(): Promise<void> {
    this.addSql(`
      ALTER TABLE "ovo_setting"
        ADD COLUMN IF NOT EXISTS "crux_api_key_encrypted" text NULL;
    `)
  }

  override async down(): Promise<void> {
    this.addSql(`
      ALTER TABLE "ovo_setting"
        DROP COLUMN IF EXISTS "crux_api_key_encrypted";
    `)
  }
}
