import { Migration } from "@medusajs/framework/mikro-orm/migrations"

/**
 * Removes the SpaceSerp rank-tracker sub-system from OVO.
 *
 * Why: spaceserp.com origin server has been returning 502 from Cloudflare
 * since ~Oct/Nov 2025; the underlying API service stopped responding even
 * earlier (~Feb 2025). The provider has been silent on support tickets
 * for a year+. Treating it as abandoned and ripping out the integration
 * rather than carrying dead code + a dead env var around.
 *
 * Tables dropped:
 *   - ovo_seo_keyword   — operator-curated keyword list
 *   - ovo_seo_ranking   — daily SERP-position snapshots
 *
 * Column dropped:
 *   - ovo_setting.spaceserp_api_key_encrypted
 *
 * Kept (used by GSC + Bing — those providers are alive):
 *   - ovo_seo_metric    — daily search-analytics rows from GSC + Bing
 *   - ovo_setting.gsc_service_account_json_encrypted
 *   - ovo_setting.bing_webmaster_api_key_encrypted
 *
 * `down()` recreates the dropped objects so the migration is reversible
 * if a future provider (DataForSEO, SerpAPI, etc.) reuses the same
 * schema. Indexes mirror the originals from Migration20260515060000 +
 * Migration20260515080000.
 */
export class Migration20260515220000 extends Migration {
  override async up(): Promise<void> {
    this.addSql(`DROP TABLE IF EXISTS "ovo_seo_ranking" CASCADE;`)
    this.addSql(`DROP TABLE IF EXISTS "ovo_seo_keyword" CASCADE;`)
    this.addSql(
      `ALTER TABLE "ovo_setting" DROP COLUMN IF EXISTS "spaceserp_api_key_encrypted";`,
    )
  }

  override async down(): Promise<void> {
    this.addSql(`
      ALTER TABLE "ovo_setting"
        ADD COLUMN IF NOT EXISTS "spaceserp_api_key_encrypted" text NULL;
    `)
    this.addSql(`
      CREATE TABLE IF NOT EXISTS "ovo_seo_keyword" (
        "id" text NOT NULL PRIMARY KEY,
        "keyword" text NOT NULL,
        "locale" text NOT NULL DEFAULT 'en-IN',
        "target_url" text NULL,
        "priority" text NOT NULL DEFAULT 'p1',
        "notes" text NULL,
        "added_by_user_id" text NULL,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        "deleted_at" timestamptz NULL
      );
      CREATE UNIQUE INDEX IF NOT EXISTS "IDX_ovo_seo_keyword_unique"
        ON "ovo_seo_keyword" (lower("keyword"), "locale")
        WHERE "deleted_at" IS NULL;
    `)
    this.addSql(`
      CREATE TABLE IF NOT EXISTS "ovo_seo_ranking" (
        "id" text NOT NULL PRIMARY KEY,
        "keyword_id" text NOT NULL,
        "engine" text NOT NULL,
        "date" date NOT NULL,
        "position" integer NULL,
        "url_found" text NULL,
        "serp_features" jsonb NULL,
        "raw_response" jsonb NULL,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        "deleted_at" timestamptz NULL
      );
      CREATE UNIQUE INDEX IF NOT EXISTS "IDX_ovo_seo_ranking_unique"
        ON "ovo_seo_ranking" ("keyword_id", "engine", "date")
        WHERE "deleted_at" IS NULL;
      CREATE INDEX IF NOT EXISTS "IDX_ovo_seo_ranking_chart"
        ON "ovo_seo_ranking" ("keyword_id", "engine", "date" DESC)
        WHERE "deleted_at" IS NULL;
    `)
  }
}
