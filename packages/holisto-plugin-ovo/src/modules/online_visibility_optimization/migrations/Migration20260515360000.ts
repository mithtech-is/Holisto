import { Migration } from "@medusajs/framework/mikro-orm/migrations"

/**
 * Phase 7.C — adds `ovo_seo_audit_history` for per-URL audit snapshots
 * over time. Drives the Audit-tab's regression panel and per-URL trend
 * chart.
 *
 * Indexing:
 *   - `(url, captured_at DESC)` — the per-URL trend read shape.
 *   - `(captured_at)` — for the daily prune.
 *
 * Retention: 30 days. Pruned by the service after every snapshot write.
 *
 * `down()` drops the table; data is recomputable in days by letting
 * the nightly cron repopulate.
 */
export class Migration20260515360000 extends Migration {
  override async up(): Promise<void> {
    this.addSql(`
      CREATE TABLE IF NOT EXISTS "ovo_seo_audit_history" (
        "id" text NOT NULL,
        "url" text NOT NULL,
        "captured_at" timestamptz NOT NULL DEFAULT now(),
        "quality_score" integer NOT NULL DEFAULT 100,
        "issue_count" integer NOT NULL DEFAULT 0,
        "error_count" integer NOT NULL DEFAULT 0,
        "warn_count" integer NOT NULL DEFAULT 0,
        "issue_codes" jsonb NULL,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        "deleted_at" timestamptz NULL,
        CONSTRAINT "ovo_seo_audit_history_pkey" PRIMARY KEY ("id")
      );

      CREATE INDEX IF NOT EXISTS "idx_ovo_seo_audit_history_url_captured"
        ON "ovo_seo_audit_history" ("url", "captured_at" DESC)
        WHERE "deleted_at" IS NULL;

      CREATE INDEX IF NOT EXISTS "idx_ovo_seo_audit_history_captured_at"
        ON "ovo_seo_audit_history" ("captured_at" DESC)
        WHERE "deleted_at" IS NULL;
    `)
  }

  override async down(): Promise<void> {
    this.addSql(`DROP TABLE IF EXISTS "ovo_seo_audit_history";`)
  }
}
