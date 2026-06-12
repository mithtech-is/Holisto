import { Migration } from "@medusajs/framework/mikro-orm/migrations"

/**
 * Phase 7.A — adds `ovo_seo_url_index` for the GSC URL Inspection
 * authoritative-indexing-status surface.
 *
 * One row per URL per inspection run. Daily cron (08:00 UTC, off-peak
 * for the inspection API) walks the sitemap and inspects each URL.
 * Quota is 2000/day per property; we stay well under at ~150 URLs.
 *
 * Retention: 30 days of history so the admin tab can chart "indexed
 * coverage over time" and surface newly-deindexed URLs.
 *
 * Indexing strategy:
 *   - `(url, inspected_at DESC)` — the "latest inspection per URL"
 *     read shape that the admin matrix consumes.
 *   - `(inspected_at)` — for cleanup pruning.
 *
 * `down()` drops the table. Inspection data is recomputable in
 * minutes by re-running the cron.
 */
export class Migration20260515340000 extends Migration {
  override async up(): Promise<void> {
    this.addSql(`
      CREATE TABLE IF NOT EXISTS "ovo_seo_url_index" (
        "id" text NOT NULL,
        "url" text NOT NULL,
        "inspected_at" timestamptz NOT NULL DEFAULT now(),
        "verdict" text NOT NULL DEFAULT 'VERDICT_UNSPECIFIED',
        "coverage_state" text NULL,
        "last_crawl_time" text NULL,
        "page_fetch_state" text NULL,
        "robots_txt_state" text NULL,
        "indexing_state" text NULL,
        "mobile_usability_verdict" text NULL,
        "rich_results_verdict" text NULL,
        "google_canonical" text NULL,
        "is_indexed" boolean NOT NULL DEFAULT false,
        "is_blocked_by_robots" boolean NOT NULL DEFAULT false,
        "has_mobile_issues" boolean NOT NULL DEFAULT false,
        "raw_response" jsonb NULL,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        "deleted_at" timestamptz NULL,
        CONSTRAINT "ovo_seo_url_index_pkey" PRIMARY KEY ("id")
      );

      CREATE INDEX IF NOT EXISTS "idx_ovo_seo_url_index_url_inspected"
        ON "ovo_seo_url_index" ("url", "inspected_at" DESC)
        WHERE "deleted_at" IS NULL;

      CREATE INDEX IF NOT EXISTS "idx_ovo_seo_url_index_inspected_at"
        ON "ovo_seo_url_index" ("inspected_at" DESC)
        WHERE "deleted_at" IS NULL;
    `)
  }

  override async down(): Promise<void> {
    this.addSql(`DROP TABLE IF EXISTS "ovo_seo_url_index";`)
  }
}
