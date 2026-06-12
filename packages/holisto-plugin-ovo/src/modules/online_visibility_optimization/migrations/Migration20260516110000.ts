import { Migration } from "@medusajs/framework/mikro-orm/migrations"

/**
 * Phase 1 of OVO keyword domination — extends `ovo_seo_keyword_target`
 * from a flat (url, keyword, priority, notes) row into the richer
 * shape needed by the Keywords admin tab + Groups Performance
 * dashboard + daily rollup join.
 *
 * Changes:
 *
 *   - Adds 9 columns: normalized_keyword, keyword_group_id,
 *     search_volume_monthly, search_difficulty, target_position,
 *     target_country, language, tags (jsonb), is_active, status.
 *
 *   - Makes `url` nullable. Keywords can now be queued for tracking
 *     before a landing page exists.
 *
 *   - Backfills `normalized_keyword` for existing rows in the same
 *     migration (idempotent — `WHERE normalized_keyword IS NULL`).
 *     Then sets NOT NULL.
 *
 *   - Drops the old `(url, keyword)` unique index (`url` is now
 *     nullable, so the index semantics break). Replaces with the new
 *     semantic dedup key: `(normalized_keyword, target_country,
 *     language)`.
 *
 *   - Adds CHECK constraints on `priority` (1-5) and `status`
 *     (tracking | paused | won | lost).
 *
 *   - Adds btree indexes on `keyword_group_id`, `(is_active, status)`,
 *     and a GIN trigram index on `normalized_keyword` as a bridge for
 *     future Meilisearch.
 *
 *   - Existing rows are preserved verbatim. `keyword_group_id` stays
 *     NULL for legacy rows — operators reassign them in the admin UI
 *     after migration; the service renders unassigned rows under the
 *     "Uncategorized" virtual bucket.
 *
 * `down()` reverses each change. The new columns are dropped; the
 * original `(url, keyword)` UNIQUE index is recreated. No data loss
 * because the original columns are untouched.
 */
export class Migration20260516110000 extends Migration {
  override async up(): Promise<void> {
    // Ensure pg_trgm exists for the bridge index. Other modules may
    // already have created it — `IF NOT EXISTS` keeps this idempotent.
    this.addSql(`CREATE EXTENSION IF NOT EXISTS pg_trgm;`)

    // Add new columns with defaults so existing rows are valid
    // immediately. `normalized_keyword` is added nullable first so we
    // can backfill; the NOT NULL is applied after the UPDATE.
    this.addSql(`
      ALTER TABLE "ovo_seo_keyword_target"
        ADD COLUMN IF NOT EXISTS "normalized_keyword" text NULL,
        ADD COLUMN IF NOT EXISTS "keyword_group_id" text NULL,
        ADD COLUMN IF NOT EXISTS "search_volume_monthly" integer NULL,
        ADD COLUMN IF NOT EXISTS "search_difficulty" integer NULL,
        ADD COLUMN IF NOT EXISTS "target_position" integer NULL,
        ADD COLUMN IF NOT EXISTS "target_country" text NOT NULL DEFAULT 'IN',
        ADD COLUMN IF NOT EXISTS "language" text NOT NULL DEFAULT 'en',
        ADD COLUMN IF NOT EXISTS "tags" jsonb NULL,
        ADD COLUMN IF NOT EXISTS "is_active" boolean NOT NULL DEFAULT true,
        ADD COLUMN IF NOT EXISTS "status" text NOT NULL DEFAULT 'tracking';
    `)

    // Url goes nullable.
    this.addSql(`
      ALTER TABLE "ovo_seo_keyword_target"
        ALTER COLUMN "url" DROP NOT NULL;
    `)

    // Backfill normalized_keyword for any pre-existing rows.
    // Matches `lib/keyword-normalizer.ts`:
    //   - lowercase
    //   - trim
    //   - collapse internal whitespace runs to a single space
    // NFKC + zero-width strip happen at write-time in the service for
    // new rows; for the backfill we accept the simpler form (existing
    // ops-entered keywords are very unlikely to contain those edge
    // cases).
    this.addSql(`
      UPDATE "ovo_seo_keyword_target"
      SET "normalized_keyword" = lower(trim(regexp_replace("keyword", '\\s+', ' ', 'g')))
      WHERE "normalized_keyword" IS NULL;
    `)

    this.addSql(`
      ALTER TABLE "ovo_seo_keyword_target"
        ALTER COLUMN "normalized_keyword" SET NOT NULL;
    `)

    // CHECK constraints.
    this.addSql(`
      ALTER TABLE "ovo_seo_keyword_target"
        ADD CONSTRAINT "chk_ovo_seo_keyword_target_priority"
          CHECK ("priority" BETWEEN 1 AND 5);
    `)
    this.addSql(`
      ALTER TABLE "ovo_seo_keyword_target"
        ADD CONSTRAINT "chk_ovo_seo_keyword_target_status"
          CHECK ("status" IN ('tracking','paused','won','lost'));
    `)

    // Drop the old (url, keyword) unique index — `url` is nullable
    // now so the constraint's semantics no longer hold (Postgres
    // treats NULL != NULL so it wouldn't enforce, but we want a clean
    // single source of truth).
    this.addSql(
      `DROP INDEX IF EXISTS "uq_ovo_seo_keyword_target_url_kw";`,
    )

    // New semantic dedup key.
    this.addSql(`
      CREATE UNIQUE INDEX IF NOT EXISTS "uq_ovo_seo_keyword_target_norm"
        ON "ovo_seo_keyword_target" ("normalized_keyword", "target_country", "language")
        WHERE "deleted_at" IS NULL;
    `)

    // Btree indexes for the most common admin filters.
    this.addSql(`
      CREATE INDEX IF NOT EXISTS "idx_ovo_seo_keyword_target_group"
        ON "ovo_seo_keyword_target" ("keyword_group_id")
        WHERE "deleted_at" IS NULL;
    `)
    this.addSql(`
      CREATE INDEX IF NOT EXISTS "idx_ovo_seo_keyword_target_active_status"
        ON "ovo_seo_keyword_target" ("is_active", "status")
        WHERE "deleted_at" IS NULL;
    `)

    // Trigram GIN — bridge index for admin-side fuzzy keyword search
    // before Meilisearch lands. Drops on Meili migration.
    this.addSql(`
      CREATE INDEX IF NOT EXISTS "idx_ovo_seo_keyword_target_norm_trgm"
        ON "ovo_seo_keyword_target" USING GIN ("normalized_keyword" gin_trgm_ops)
        WHERE "deleted_at" IS NULL;
    `)
  }

  override async down(): Promise<void> {
    // Drop new indexes + constraints, then drop the new columns, then
    // restore the original (url, keyword) unique index.
    this.addSql(
      `DROP INDEX IF EXISTS "idx_ovo_seo_keyword_target_norm_trgm";`,
    )
    this.addSql(
      `DROP INDEX IF EXISTS "idx_ovo_seo_keyword_target_active_status";`,
    )
    this.addSql(
      `DROP INDEX IF EXISTS "idx_ovo_seo_keyword_target_group";`,
    )
    this.addSql(
      `DROP INDEX IF EXISTS "uq_ovo_seo_keyword_target_norm";`,
    )

    this.addSql(`
      ALTER TABLE "ovo_seo_keyword_target"
        DROP CONSTRAINT IF EXISTS "chk_ovo_seo_keyword_target_status",
        DROP CONSTRAINT IF EXISTS "chk_ovo_seo_keyword_target_priority";
    `)

    this.addSql(`
      ALTER TABLE "ovo_seo_keyword_target"
        DROP COLUMN IF EXISTS "status",
        DROP COLUMN IF EXISTS "is_active",
        DROP COLUMN IF EXISTS "tags",
        DROP COLUMN IF EXISTS "language",
        DROP COLUMN IF EXISTS "target_country",
        DROP COLUMN IF EXISTS "target_position",
        DROP COLUMN IF EXISTS "search_difficulty",
        DROP COLUMN IF EXISTS "search_volume_monthly",
        DROP COLUMN IF EXISTS "keyword_group_id",
        DROP COLUMN IF EXISTS "normalized_keyword";
    `)

    // Restore url NOT NULL — only safe if no NULL rows exist; the up
    // migration didn't insert NULLs so this is correct.
    this.addSql(`
      ALTER TABLE "ovo_seo_keyword_target"
        ALTER COLUMN "url" SET NOT NULL;
    `)

    this.addSql(`
      CREATE UNIQUE INDEX IF NOT EXISTS "uq_ovo_seo_keyword_target_url_kw"
        ON "ovo_seo_keyword_target" ("url", "keyword")
        WHERE "deleted_at" IS NULL;
    `)

    // pg_trgm extension is NOT dropped — other modules may depend on
    // it (mirrors the precedent in Migration20260515220000.ts).
  }
}
