import { Migration } from "@medusajs/framework/mikro-orm/migrations"

/**
 * Adds the Phase 4 AI-citation tracker surface:
 *
 *   - `ovo_ai_prompt`              — operator-curated prompt list
 *   - `ovo_ai_citation`            — per-(prompt, provider, run) result
 *   - 4 encrypted credential cols on `ovo_setting` for the AI APIs:
 *       openai_api_key_encrypted
 *       anthropic_api_key_encrypted
 *       perplexity_api_key_encrypted
 *       google_ai_api_key_encrypted
 *
 * Indexing:
 *   - `idx_ovo_ai_citation_prompt_provider_captured` — the admin
 *     matrix's exact read shape ("latest row per prompt + provider").
 *   - `idx_ovo_ai_citation_captured_at` — trend chart over time.
 *
 * `down()` drops both tables + the 4 columns. Citation data is
 * derived from external APIs, so a rollback is reversible in days
 * (one cron run repopulates).
 */
export class Migration20260515300000 extends Migration {
  override async up(): Promise<void> {
    this.addSql(`
      CREATE TABLE IF NOT EXISTS "ovo_ai_prompt" (
        "id" text NOT NULL,
        "prompt" text NOT NULL,
        "category" text NULL,
        "active" boolean NOT NULL DEFAULT true,
        "notes" text NULL,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        "deleted_at" timestamptz NULL,
        CONSTRAINT "ovo_ai_prompt_pkey" PRIMARY KEY ("id")
      );

      CREATE INDEX IF NOT EXISTS "idx_ovo_ai_prompt_active"
        ON "ovo_ai_prompt" ("active")
        WHERE "deleted_at" IS NULL;
    `)

    this.addSql(`
      CREATE TABLE IF NOT EXISTS "ovo_ai_citation" (
        "id" text NOT NULL,
        "prompt_id" text NOT NULL,
        "prompt_text" text NOT NULL,
        "provider" text NOT NULL,
        "model_name" text NOT NULL,
        "answer" text NOT NULL,
        "latency_ms" integer NOT NULL DEFAULT 0,
        "mentions_brand" boolean NOT NULL DEFAULT false,
        "links_brand" boolean NOT NULL DEFAULT false,
        "competitor_mentions" jsonb NULL,
        "sentiment" text NULL,
        "position" integer NULL,
        "raw_response" jsonb NULL,
        "captured_at" timestamptz NOT NULL DEFAULT now(),
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        "deleted_at" timestamptz NULL,
        CONSTRAINT "ovo_ai_citation_pkey" PRIMARY KEY ("id")
      );

      CREATE INDEX IF NOT EXISTS "idx_ovo_ai_citation_prompt_provider_captured"
        ON "ovo_ai_citation" ("prompt_id", "provider", "captured_at" DESC)
        WHERE "deleted_at" IS NULL;

      CREATE INDEX IF NOT EXISTS "idx_ovo_ai_citation_captured_at"
        ON "ovo_ai_citation" ("captured_at" DESC)
        WHERE "deleted_at" IS NULL;
    `)

    this.addSql(`
      ALTER TABLE "ovo_setting"
        ADD COLUMN IF NOT EXISTS "openai_api_key_encrypted" text NULL,
        ADD COLUMN IF NOT EXISTS "anthropic_api_key_encrypted" text NULL,
        ADD COLUMN IF NOT EXISTS "perplexity_api_key_encrypted" text NULL,
        ADD COLUMN IF NOT EXISTS "google_ai_api_key_encrypted" text NULL;
    `)
  }

  override async down(): Promise<void> {
    this.addSql(`DROP TABLE IF EXISTS "ovo_ai_citation";`)
    this.addSql(`DROP TABLE IF EXISTS "ovo_ai_prompt";`)
    this.addSql(`
      ALTER TABLE "ovo_setting"
        DROP COLUMN IF EXISTS "openai_api_key_encrypted",
        DROP COLUMN IF EXISTS "anthropic_api_key_encrypted",
        DROP COLUMN IF EXISTS "perplexity_api_key_encrypted",
        DROP COLUMN IF EXISTS "google_ai_api_key_encrypted";
    `)
  }
}
