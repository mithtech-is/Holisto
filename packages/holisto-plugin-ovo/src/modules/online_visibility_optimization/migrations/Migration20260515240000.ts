import { Migration } from "@medusajs/framework/mikro-orm/migrations"

/**
 * Adds query/page/country/device insight tables for the OVO metrics
 * tab:
 *
 *   - `ovo_seo_dimension_rollup` — current top-N snapshot per
 *     (engine, dimension_type, window_days). Daily DELETE-then-INSERT
 *     so the table only ever holds the latest snapshot.
 *
 *   - `ovo_seo_query_history`    — per-(query, date) traffic + rank.
 *     Backing data for the "click a query, see its rank trend" chart.
 *     Daily upsert, 90-day retention via service-side prune.
 *
 * Indexing strategy:
 *
 * `ovo_seo_dimension_rollup`
 *   - Composite UNIQUE on (engine, dimension_type, dimension_value,
 *     window_days) — the natural key for the daily DELETE+INSERT
 *     batch. Falls back to the upsert pattern if a future ingest
 *     switches to per-row writes.
 *   - Btree on (engine, dimension_type) for the "give me the rollup
 *     for X dimension on Y engine" read query.
 *
 * `ovo_seo_query_history`
 *   - Composite UNIQUE on (engine, query, date) — the upsert key.
 *   - Btree on (query, engine, date) for the per-query rank-trend
 *     chart query: `SELECT date, position FROM … WHERE engine = ? AND
 *     query = ? ORDER BY date`.
 *
 * Both tables follow the same soft-delete-ready shape as the other
 * OVO module tables. `created_at` / `updated_at` / `deleted_at` are
 * Medusa convention; mikro-orm hydrates them automatically.
 *
 * `down()` drops both tables. They hold derived data (re-ingest takes
 * one GSC call per dimension to repopulate), so a rollback losing
 * them is recoverable in minutes.
 */
export class Migration20260515240000 extends Migration {
  override async up(): Promise<void> {
    this.addSql(`
      CREATE TABLE IF NOT EXISTS "ovo_seo_dimension_rollup" (
        "id" text NOT NULL,
        "engine" text NOT NULL,
        "dimension_type" text NOT NULL,
        "dimension_value" text NOT NULL,
        "window_days" integer NOT NULL,
        "clicks" double precision NOT NULL DEFAULT 0,
        "impressions" double precision NOT NULL DEFAULT 0,
        "ctr" double precision NOT NULL DEFAULT 0,
        "position" double precision NOT NULL DEFAULT 0,
        "captured_at" timestamptz NOT NULL DEFAULT now(),
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        "deleted_at" timestamptz NULL,
        CONSTRAINT "ovo_seo_dimension_rollup_pkey" PRIMARY KEY ("id")
      );

      CREATE INDEX IF NOT EXISTS "idx_ovo_seo_dim_rollup_engine_type"
        ON "ovo_seo_dimension_rollup" ("engine", "dimension_type")
        WHERE "deleted_at" IS NULL;

      CREATE UNIQUE INDEX IF NOT EXISTS "uq_ovo_seo_dim_rollup_natural"
        ON "ovo_seo_dimension_rollup"
        ("engine", "dimension_type", "dimension_value", "window_days")
        WHERE "deleted_at" IS NULL;
    `)

    this.addSql(`
      CREATE TABLE IF NOT EXISTS "ovo_seo_query_history" (
        "id" text NOT NULL,
        "engine" text NOT NULL,
        "query" text NOT NULL,
        "date" timestamptz NOT NULL,
        "clicks" double precision NOT NULL DEFAULT 0,
        "impressions" double precision NOT NULL DEFAULT 0,
        "ctr" double precision NOT NULL DEFAULT 0,
        "position" double precision NOT NULL DEFAULT 0,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        "deleted_at" timestamptz NULL,
        CONSTRAINT "ovo_seo_query_history_pkey" PRIMARY KEY ("id")
      );

      CREATE INDEX IF NOT EXISTS "idx_ovo_seo_qh_query_engine_date"
        ON "ovo_seo_query_history" ("query", "engine", "date")
        WHERE "deleted_at" IS NULL;

      CREATE INDEX IF NOT EXISTS "idx_ovo_seo_qh_engine_date"
        ON "ovo_seo_query_history" ("engine", "date")
        WHERE "deleted_at" IS NULL;

      CREATE UNIQUE INDEX IF NOT EXISTS "uq_ovo_seo_qh_natural"
        ON "ovo_seo_query_history" ("engine", "query", "date")
        WHERE "deleted_at" IS NULL;
    `)
  }

  override async down(): Promise<void> {
    this.addSql(`DROP TABLE IF EXISTS "ovo_seo_query_history";`)
    this.addSql(`DROP TABLE IF EXISTS "ovo_seo_dimension_rollup";`)
  }
}
