import { Migration } from "@medusajs/framework/mikro-orm/migrations"

/**
 * Phase 1 of OVO keyword domination — extends `ovo_setting` with:
 *
 *   - `keyword_tracking` (jsonb) — defaults driving the new admin
 *     tab and rollup cron. Shape documented on the model.
 *
 *   - `ahrefs_api_key_encrypted` / `semrush_api_key_encrypted` —
 *     optional external-provider credentials for keyword-difficulty
 *     + search-volume enrichment. Encrypted at rest using the same
 *     the OVO crypto helper helper that protects the
 *     existing GSC + Bing creds. Plaintext never leaves the service.
 *
 * All three columns are nullable — admins opt into difficulty data
 * by pasting a key from the admin UI's Credentials section. Keyword
 * tracking itself works without either provider; difficulty just
 * renders as "—" in the table.
 *
 * `down()` drops the three columns.
 */
export class Migration20260516130000 extends Migration {
  override async up(): Promise<void> {
    this.addSql(`
      ALTER TABLE "ovo_setting"
        ADD COLUMN IF NOT EXISTS "keyword_tracking" jsonb NULL,
        ADD COLUMN IF NOT EXISTS "ahrefs_api_key_encrypted" text NULL,
        ADD COLUMN IF NOT EXISTS "semrush_api_key_encrypted" text NULL;
    `)
  }

  override async down(): Promise<void> {
    this.addSql(`
      ALTER TABLE "ovo_setting"
        DROP COLUMN IF EXISTS "semrush_api_key_encrypted",
        DROP COLUMN IF EXISTS "ahrefs_api_key_encrypted",
        DROP COLUMN IF EXISTS "keyword_tracking";
    `)
  }
}
