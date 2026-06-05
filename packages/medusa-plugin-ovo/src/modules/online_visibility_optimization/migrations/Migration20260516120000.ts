import { Migration } from "@medusajs/framework/mikro-orm/migrations"

/**
 * Phase 1 of OVO keyword domination — adds
 * `ovo_seo_keyword_perf_snapshot`, the per-target daily rollup that
 * the Keywords admin tab and Groups Performance dashboard read from.
 *
 * Rows are written by `jobs/keyword-performance-rollup.ts` (02:00
 * IST daily). The job joins `ovo_seo_query_history` (raw GSC data)
 * against `ovo_seo_keyword_target` on
 * `lower(query) = normalized_keyword` and aggregates clicks /
 * impressions / position into one row per (target, engine, day).
 *
 * Why a separate table from `ovo_seo_query_history`:
 *   - `query_history` is keyed by raw GSC query string; this table is
 *     keyed by `keyword_target_id` (operator-curated row).
 *   - The dashboard reads "give me the last 90 days for THIS target"
 *     — much cheaper to scan a denormalised target-keyed table than
 *     to re-join on every render.
 *   - One keyword can have multiple GSC query variants; this table
 *     aggregates them into the operator's canonical view.
 *
 * Indexing strategy:
 *   - `(keyword_target_id, engine, date)` UNIQUE partial — the
 *     natural key + upsert conflict target.
 *   - `(keyword_target_id, date DESC)` — the per-target trend
 *     chart's read shape.
 *
 * Retention: 730 days (mirrors `SEO_METRIC_RETENTION_DAYS`). Older
 * rows pruned by the rollup cron after each fresh upsert.
 *
 * `down()` drops the table. Snapshot data is recomputable in minutes
 * by re-running the rollup cron against existing `query_history`.
 */
export class Migration20260516120000 extends Migration {
  override async up(): Promise<void> {
    this.addSql(`
      CREATE TABLE IF NOT EXISTS "ovo_seo_keyword_perf_snapshot" (
        "id" text NOT NULL,
        "keyword_target_id" text NOT NULL,
        "engine" text NOT NULL DEFAULT 'gsc',
        "date" timestamptz NOT NULL,
        "clicks" double precision NOT NULL DEFAULT 0,
        "impressions" double precision NOT NULL DEFAULT 0,
        "ctr" double precision NOT NULL DEFAULT 0,
        "position" double precision NULL,
        "indexed" boolean NOT NULL DEFAULT true,
        "top_url" text NULL,
        "captured_at" timestamptz NOT NULL DEFAULT now(),
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        "deleted_at" timestamptz NULL,
        CONSTRAINT "ovo_seo_keyword_perf_snapshot_pkey" PRIMARY KEY ("id")
      );

      CREATE UNIQUE INDEX IF NOT EXISTS "uq_ovo_seo_keyword_perf_natural"
        ON "ovo_seo_keyword_perf_snapshot" ("keyword_target_id", "engine", "date")
        WHERE "deleted_at" IS NULL;

      CREATE INDEX IF NOT EXISTS "idx_ovo_seo_keyword_perf_target_date"
        ON "ovo_seo_keyword_perf_snapshot" ("keyword_target_id", "date" DESC)
        WHERE "deleted_at" IS NULL;

      CREATE INDEX IF NOT EXISTS "idx_ovo_seo_keyword_perf_engine_date"
        ON "ovo_seo_keyword_perf_snapshot" ("engine", "date" DESC)
        WHERE "deleted_at" IS NULL;

      CREATE INDEX IF NOT EXISTS "idx_ovo_seo_keyword_perf_deleted_at"
        ON "ovo_seo_keyword_perf_snapshot" ("deleted_at")
        WHERE "deleted_at" IS NULL;
    `)
  }

  override async down(): Promise<void> {
    this.addSql(
      `DROP TABLE IF EXISTS "ovo_seo_keyword_perf_snapshot" CASCADE;`,
    )
  }
}
