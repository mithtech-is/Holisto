import { Migration } from "@medusajs/framework/mikro-orm/migrations"

/**
 * Adds the `ovo_submission_log` table — one row per push to a
 * discovery surface (IndexNow / GSC / Bing). Pruned to 200 rows
 * by the service on every insert.
 */
export class Migration20260514150000 extends Migration {
  override async up(): Promise<void> {
    this.addSql(
      `create table if not exists "ovo_submission_log" (` +
        `"id" text not null, ` +
        `"destination" text not null, ` +
        `"action" text not null, ` +
        `"target" text not null, ` +
        `"url_count" integer not null default 0, ` +
        `"status" text not null, ` +
        `"http_status" integer null, ` +
        `"error_message" text null, ` +
        `"duration_ms" integer not null default 0, ` +
        `"triggered_by_user_id" text null, ` +
        `"created_at" timestamptz not null default now(), ` +
        `"updated_at" timestamptz not null default now(), ` +
        `"deleted_at" timestamptz null, ` +
        `constraint "ovo_submission_log_pkey" primary key ("id")` +
        `);`,
    )
    this.addSql(
      `CREATE INDEX IF NOT EXISTS "IDX_ovo_submission_log_created_at" ` +
        `ON "ovo_submission_log" ("created_at" DESC) WHERE deleted_at IS NULL;`,
    )
    this.addSql(
      `CREATE INDEX IF NOT EXISTS "IDX_ovo_submission_log_destination" ` +
        `ON "ovo_submission_log" ("destination") WHERE deleted_at IS NULL;`,
    )
  }

  override async down(): Promise<void> {
    this.addSql(`drop table if exists "ovo_submission_log" cascade;`)
  }
}
