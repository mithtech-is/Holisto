import { Migration } from "@medusajs/framework/mikro-orm/migrations"

/**
 * Adds `ovo_seo_audit` — per-URL on-page audit snapshot. Populated by
 * the nightly `seo-audit-nightly` cron and the manual
 * `POST /admin/ovo/seo/audit` route.
 *
 * One row per URL (latest snapshot only). The cron replaces the prior
 * row for each URL via upsert keyed by `url`; URLs that drop out of the
 * sitemap eventually age out via the cron's "missing URL" cleanup pass.
 *
 * Indexing:
 *   - `idx_ovo_seo_audit_audited_at` — covers the "show me the last
 *     run" timestamp lookup on the admin tab.
 *   - `uq_ovo_seo_audit_url` — natural key; ensures one row per URL.
 *
 * `down()` drops the table. Audit data is derived from the live
 * storefront in seconds, so a rollback is cheap to recover from.
 */
export class Migration20260515260000 extends Migration {
  override async up(): Promise<void> {
    this.addSql(`
      CREATE TABLE IF NOT EXISTS "ovo_seo_audit" (
        "id" text NOT NULL,
        "url" text NOT NULL,
        "audited_at" timestamptz NOT NULL DEFAULT now(),
        "status_code" integer NOT NULL DEFAULT 0,
        "response_time_ms" integer NOT NULL DEFAULT 0,
        "title" text NULL,
        "title_length" integer NOT NULL DEFAULT 0,
        "meta_description" text NULL,
        "meta_description_length" integer NOT NULL DEFAULT 0,
        "canonical_url" text NULL,
        "canonical_ok" boolean NOT NULL DEFAULT false,
        "h1_count" integer NOT NULL DEFAULT 0,
        "h1_text" text NULL,
        "image_count" integer NOT NULL DEFAULT 0,
        "image_missing_alt_count" integer NOT NULL DEFAULT 0,
        "jsonld_count" integer NOT NULL DEFAULT 0,
        "jsonld_invalid_count" integer NOT NULL DEFAULT 0,
        "jsonld_types" jsonb NULL,
        "word_count" integer NOT NULL DEFAULT 0,
        "has_og_title" boolean NOT NULL DEFAULT false,
        "has_og_image" boolean NOT NULL DEFAULT false,
        "has_twitter_card" boolean NOT NULL DEFAULT false,
        "issues" jsonb NOT NULL DEFAULT '[]'::jsonb,
        "raw_html_sample" text NULL,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        "deleted_at" timestamptz NULL,
        CONSTRAINT "ovo_seo_audit_pkey" PRIMARY KEY ("id")
      );

      CREATE UNIQUE INDEX IF NOT EXISTS "uq_ovo_seo_audit_url"
        ON "ovo_seo_audit" ("url")
        WHERE "deleted_at" IS NULL;

      CREATE INDEX IF NOT EXISTS "idx_ovo_seo_audit_audited_at"
        ON "ovo_seo_audit" ("audited_at")
        WHERE "deleted_at" IS NULL;
    `)
  }

  override async down(): Promise<void> {
    this.addSql(`DROP TABLE IF EXISTS "ovo_seo_audit";`)
  }
}
