import { Migration } from "@medusajs/framework/mikro-orm/migrations"

/**
 * Phase 11 — Yandex Webmaster API integration.
 *
 * Adds three nullable columns on `ovo_setting`:
 *   - `yandex_oauth_token_encrypted` — operator-saved OAuth token,
 *     encrypted at rest via `cashfree/crypto.ts:encryptString`. Falls
 *     back to env var `YANDEX_WEBMASTER_OAUTH_TOKEN` when null.
 *   - `yandex_user_id` — opaque numeric user id discovered via
 *     `GET /v4/user`. Cached after first save so the ingest cron
 *     skips a discovery round-trip per run. Plaintext (not a secret).
 *   - `yandex_host_id` — opaque per-site identifier discovered via
 *     `GET /v4/user/{user_id}/hosts` and matched against the
 *     configured site URL. Plaintext.
 *
 * Same model-less convention as the AI-key columns added in
 * Migration20260515300000 — these columns are accessed via
 * `(row as any).yandex_*` in the service layer, so the OvoSetting
 * model file doesn't need to change.
 *
 * Reverse drops all three. No data loss: the operator can re-enter
 * the OAuth token via the admin Integrations card.
 */
export class Migration20260517100000 extends Migration {
  override async up(): Promise<void> {
    this.addSql(`
      ALTER TABLE "ovo_setting"
        ADD COLUMN IF NOT EXISTS "yandex_oauth_token_encrypted" text NULL,
        ADD COLUMN IF NOT EXISTS "yandex_user_id" text NULL,
        ADD COLUMN IF NOT EXISTS "yandex_host_id" text NULL;
    `)
  }

  override async down(): Promise<void> {
    this.addSql(`
      ALTER TABLE "ovo_setting"
        DROP COLUMN IF EXISTS "yandex_oauth_token_encrypted",
        DROP COLUMN IF EXISTS "yandex_user_id",
        DROP COLUMN IF EXISTS "yandex_host_id";
    `)
  }
}
