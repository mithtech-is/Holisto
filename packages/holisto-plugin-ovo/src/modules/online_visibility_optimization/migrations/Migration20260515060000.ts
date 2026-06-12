import { Migration } from "@medusajs/framework/mikro-orm/migrations"

/**
 * Adds the three SEO-tracking tables backing Phase 2 + 3 of the OVO
 * tracking surface:
 *
 *   - `ovo_seo_metric`  — daily snapshot per (engine, metric_type).
 *                         GSC + Bing daily ingestion fills this.
 *   - `ovo_seo_keyword` — operator-curated keyword list with locale +
 *                         priority cadence.
 *   - `ovo_seo_ranking` — daily rank snapshot per (keyword, engine).
 *                         SpaceSerp cron fills this.
 *
 * Indexing strategy:
 *
 * `ovo_seo_metric` — the chart query is always "give me values for
 * (engine, metric_type) ordered by date". Composite index on those
 * three columns optimised for that exact pattern. Plus a separate
 * UNIQUE constraint on (engine, metric_type, date) so the daily
 * upsert can use `ON CONFLICT … DO UPDATE` cleanly.
 *
 * `ovo_seo_keyword` — small table (≤ 100 rows realistic). No special
 * indexes beyond the auto-PK + the partial unique on (keyword, locale)
 * to prevent dupes.
 *
 * `ovo_seo_ranking` — same pattern as metric: chart query is "give me
 * positions for (keyword_id, engine) ordered by date". Same composite
 * index + unique-on-(keyword, engine, date).
 *
 * All three tables are soft-deletable via `deleted_at` (Medusa default
 * column on `model.define`); the partial-unique indexes scope on
 * `deleted_at IS NULL` so soft-deleted rows don't block new inserts.
 */
export class Migration20260515060000 extends Migration {
  override async up(): Promise<void> {
    // ── ovo_seo_metric ─────────────────────────────────────────────
    this.addSql(`
      CREATE TABLE IF NOT EXISTS "ovo_seo_metric" (
        "id" text NOT NULL PRIMARY KEY,
        "engine" text NOT NULL,
        "metric_type" text NOT NULL,
        "date" timestamptz NOT NULL,
        "value" double precision NOT NULL,
        "raw_response" jsonb NULL,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        "deleted_at" timestamptz NULL
      );
    `)
    this.addSql(`
      CREATE UNIQUE INDEX IF NOT EXISTS "IDX_seo_metric_uq"
        ON "ovo_seo_metric" ("engine", "metric_type", "date")
        WHERE "deleted_at" IS NULL;
    `)
    this.addSql(`
      CREATE INDEX IF NOT EXISTS "IDX_seo_metric_engine_type"
        ON "ovo_seo_metric" ("engine", "metric_type") WHERE "deleted_at" IS NULL;
    `)
    this.addSql(`
      CREATE INDEX IF NOT EXISTS "IDX_seo_metric_date"
        ON "ovo_seo_metric" ("date") WHERE "deleted_at" IS NULL;
    `)

    // ── ovo_seo_keyword ────────────────────────────────────────────
    this.addSql(`
      CREATE TABLE IF NOT EXISTS "ovo_seo_keyword" (
        "id" text NOT NULL PRIMARY KEY,
        "keyword" text NOT NULL,
        "locale" text NOT NULL DEFAULT 'en-IN',
        "target_url" text NULL,
        "priority" text NOT NULL DEFAULT 'p1' CHECK ("priority" IN ('p0','p1','p2')),
        "notes" text NULL,
        "added_by_user_id" text NULL,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        "deleted_at" timestamptz NULL
      );
    `)
    this.addSql(`
      CREATE UNIQUE INDEX IF NOT EXISTS "IDX_seo_keyword_uq"
        ON "ovo_seo_keyword" (lower("keyword"), "locale")
        WHERE "deleted_at" IS NULL;
    `)

    // ── ovo_seo_ranking ────────────────────────────────────────────
    this.addSql(`
      CREATE TABLE IF NOT EXISTS "ovo_seo_ranking" (
        "id" text NOT NULL PRIMARY KEY,
        "keyword_id" text NOT NULL,
        "engine" text NOT NULL,
        "date" timestamptz NOT NULL,
        "position" integer NULL,
        "url_found" text NULL,
        "serp_features" jsonb NULL,
        "raw_response" jsonb NULL,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        "deleted_at" timestamptz NULL
      );
    `)
    this.addSql(`
      CREATE UNIQUE INDEX IF NOT EXISTS "IDX_seo_ranking_uq"
        ON "ovo_seo_ranking" ("keyword_id", "engine", "date")
        WHERE "deleted_at" IS NULL;
    `)
    this.addSql(`
      CREATE INDEX IF NOT EXISTS "IDX_seo_ranking_keyword_engine"
        ON "ovo_seo_ranking" ("keyword_id", "engine") WHERE "deleted_at" IS NULL;
    `)
    this.addSql(`
      CREATE INDEX IF NOT EXISTS "IDX_seo_ranking_date"
        ON "ovo_seo_ranking" ("date") WHERE "deleted_at" IS NULL;
    `)
  }

  override async down(): Promise<void> {
    this.addSql(`DROP TABLE IF EXISTS "ovo_seo_ranking" CASCADE;`)
    this.addSql(`DROP TABLE IF EXISTS "ovo_seo_keyword" CASCADE;`)
    this.addSql(`DROP TABLE IF EXISTS "ovo_seo_metric" CASCADE;`)
  }
}
