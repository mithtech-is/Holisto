import { Migration } from "@medusajs/framework/mikro-orm/migrations"

/**
 * Phase 6 — page quality score + target-keyword tracking.
 *
 * Adds:
 *   - `ovo_seo_keyword_target` table — operator-curated (URL, keyword)
 *     pairs that drive the audit's keyword-presence lint + the
 *     Keywords admin tab.
 *
 *   - Extra columns on `ovo_seo_audit`:
 *       `quality_score`             integer 0-100
 *       `h2_count`, `h3_count`      heading depth
 *       `images_missing_dim_count`  CLS-critical img count
 *       `is_https`                  served over HTTPS?
 *       `has_viewport`              mobile viewport meta present?
 *       `has_lang`                  <html lang="…"> set?
 *       `robots_noindex`            page marked noindex?
 *       `response_bytes`            HTML payload size
 *       `external_script_count`    third-party <script src> count
 *       `internal_link_count`       links to same-host paths
 *       `external_link_count`       links off-domain
 *       `target_keywords_match`     per-keyword in_title/in_h1/in_body
 *
 * Indexing strategy:
 *   - `(url)` natural-key UNIQUE INDEX on the keyword table — supports
 *     "what does this URL target?" reads without a sort.
 *   - `(keyword)` BTREE so the Keywords tab can group by query.
 *
 * `down()` removes the table + the added columns. Audit data is
 * recomputable in seconds via the next cron run.
 */
export class Migration20260515320000 extends Migration {
  override async up(): Promise<void> {
    this.addSql(`
      CREATE TABLE IF NOT EXISTS "ovo_seo_keyword_target" (
        "id" text NOT NULL,
        "url" text NOT NULL,
        "keyword" text NOT NULL,
        "priority" integer NOT NULL DEFAULT 2,
        "notes" text NULL,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        "deleted_at" timestamptz NULL,
        CONSTRAINT "ovo_seo_keyword_target_pkey" PRIMARY KEY ("id")
      );

      CREATE UNIQUE INDEX IF NOT EXISTS "uq_ovo_seo_keyword_target_url_kw"
        ON "ovo_seo_keyword_target" ("url", "keyword")
        WHERE "deleted_at" IS NULL;

      CREATE INDEX IF NOT EXISTS "idx_ovo_seo_keyword_target_url"
        ON "ovo_seo_keyword_target" ("url")
        WHERE "deleted_at" IS NULL;

      CREATE INDEX IF NOT EXISTS "idx_ovo_seo_keyword_target_keyword"
        ON "ovo_seo_keyword_target" ("keyword")
        WHERE "deleted_at" IS NULL;
    `)

    this.addSql(`
      ALTER TABLE "ovo_seo_audit"
        ADD COLUMN IF NOT EXISTS "quality_score" integer NOT NULL DEFAULT 100,
        ADD COLUMN IF NOT EXISTS "h2_count" integer NOT NULL DEFAULT 0,
        ADD COLUMN IF NOT EXISTS "h3_count" integer NOT NULL DEFAULT 0,
        ADD COLUMN IF NOT EXISTS "images_missing_dim_count" integer NOT NULL DEFAULT 0,
        ADD COLUMN IF NOT EXISTS "is_https" boolean NOT NULL DEFAULT true,
        ADD COLUMN IF NOT EXISTS "has_viewport" boolean NOT NULL DEFAULT false,
        ADD COLUMN IF NOT EXISTS "has_lang" boolean NOT NULL DEFAULT false,
        ADD COLUMN IF NOT EXISTS "robots_noindex" boolean NOT NULL DEFAULT false,
        ADD COLUMN IF NOT EXISTS "response_bytes" integer NOT NULL DEFAULT 0,
        ADD COLUMN IF NOT EXISTS "external_script_count" integer NOT NULL DEFAULT 0,
        ADD COLUMN IF NOT EXISTS "internal_link_count" integer NOT NULL DEFAULT 0,
        ADD COLUMN IF NOT EXISTS "external_link_count" integer NOT NULL DEFAULT 0,
        ADD COLUMN IF NOT EXISTS "target_keywords_match" jsonb NULL;
    `)
  }

  override async down(): Promise<void> {
    this.addSql(`DROP TABLE IF EXISTS "ovo_seo_keyword_target";`)
    this.addSql(`
      ALTER TABLE "ovo_seo_audit"
        DROP COLUMN IF EXISTS "quality_score",
        DROP COLUMN IF EXISTS "h2_count",
        DROP COLUMN IF EXISTS "h3_count",
        DROP COLUMN IF EXISTS "images_missing_dim_count",
        DROP COLUMN IF EXISTS "is_https",
        DROP COLUMN IF EXISTS "has_viewport",
        DROP COLUMN IF EXISTS "has_lang",
        DROP COLUMN IF EXISTS "robots_noindex",
        DROP COLUMN IF EXISTS "response_bytes",
        DROP COLUMN IF EXISTS "external_script_count",
        DROP COLUMN IF EXISTS "internal_link_count",
        DROP COLUMN IF EXISTS "external_link_count",
        DROP COLUMN IF EXISTS "target_keywords_match";
    `)
  }
}
