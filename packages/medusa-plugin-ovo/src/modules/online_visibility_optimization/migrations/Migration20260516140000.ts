import { Migration } from "@medusajs/framework/mikro-orm/migrations"

/**
 * Phase 8.D — adds `search_intent` column to `ovo_seo_keyword_target`.
 *
 * Values: "informational" | "navigational" | "transactional" |
 * "commercial". Auto-set by `lib/intent-classifier.ts` on every
 * upsert; admins can manually override via the Keywords tab.
 *
 * `CHECK` constraint enforces the enum at the DB level so a bad
 * client can't poison the rollup chart.
 *
 * Indexing: `(search_intent)` for the funnel-stage mix chart.
 *
 * Backfill: rows pre-Phase-8.D get "informational" via the default,
 * then a one-shot service helper re-classifies them on the next
 * keyword listing fetch. This keeps the migration fast (no row
 * scan) and predictable (no JS lookup table loaded into SQL).
 *
 * Reverse: drops the column + index + constraint.
 */
export class Migration20260516140000 extends Migration {
  override async up(): Promise<void> {
    this.addSql(`
      ALTER TABLE "ovo_seo_keyword_target"
        ADD COLUMN IF NOT EXISTS "search_intent" text
          NOT NULL DEFAULT 'informational';

      ALTER TABLE "ovo_seo_keyword_target"
        DROP CONSTRAINT IF EXISTS "ovo_seo_keyword_target_search_intent_check";

      ALTER TABLE "ovo_seo_keyword_target"
        ADD CONSTRAINT "ovo_seo_keyword_target_search_intent_check"
        CHECK ("search_intent" IN
          ('informational','navigational','transactional','commercial'));

      CREATE INDEX IF NOT EXISTS "idx_ovo_seo_keyword_target_search_intent"
        ON "ovo_seo_keyword_target" ("search_intent")
        WHERE "deleted_at" IS NULL;
    `)
  }

  override async down(): Promise<void> {
    this.addSql(`
      DROP INDEX IF EXISTS "idx_ovo_seo_keyword_target_search_intent";
      ALTER TABLE "ovo_seo_keyword_target"
        DROP CONSTRAINT IF EXISTS "ovo_seo_keyword_target_search_intent_check";
      ALTER TABLE "ovo_seo_keyword_target"
        DROP COLUMN IF EXISTS "search_intent";
    `)
  }
}
