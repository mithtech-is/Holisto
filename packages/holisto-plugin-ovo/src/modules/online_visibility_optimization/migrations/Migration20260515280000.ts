import { Migration } from "@medusajs/framework/mikro-orm/migrations"

/**
 * Adds `ovo_seo_audit_run` — aggregate stats per audit run. Each
 * `runSeoAudit()` invocation (cron or manual) inserts one row. The
 * Audit-tab UI charts these rows over time so operators can see
 * whether their fixes actually moved the needle.
 *
 * Retention: 365 days (one row per cron run, so ~365 rows/year).
 * Pruning is service-side after every insert.
 *
 * `down()` drops the table — nothing references it, no cascade risk.
 */
export class Migration20260515280000 extends Migration {
  override async up(): Promise<void> {
    this.addSql(`
      CREATE TABLE IF NOT EXISTS "ovo_seo_audit_run" (
        "id" text NOT NULL,
        "started_at" timestamptz NOT NULL DEFAULT now(),
        "duration_ms" integer NOT NULL DEFAULT 0,
        "urls_total" integer NOT NULL DEFAULT 0,
        "urls_error" integer NOT NULL DEFAULT 0,
        "urls_warn" integer NOT NULL DEFAULT 0,
        "urls_healthy" integer NOT NULL DEFAULT 0,
        "trigger" text NOT NULL DEFAULT 'cron',
        "issues_by_code" jsonb NULL,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        "deleted_at" timestamptz NULL,
        CONSTRAINT "ovo_seo_audit_run_pkey" PRIMARY KEY ("id")
      );

      CREATE INDEX IF NOT EXISTS "idx_ovo_seo_audit_run_started_at"
        ON "ovo_seo_audit_run" ("started_at")
        WHERE "deleted_at" IS NULL;
    `)
  }

  override async down(): Promise<void> {
    this.addSql(`DROP TABLE IF EXISTS "ovo_seo_audit_run";`)
  }
}
