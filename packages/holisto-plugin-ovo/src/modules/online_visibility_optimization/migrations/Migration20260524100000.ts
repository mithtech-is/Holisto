import { Migration } from "@medusajs/framework/mikro-orm/migrations"

/**
 * Phase 4 — extends `ovo_ai_prompt` with content-generation columns.
 *
 * The existing citation-tracking prompt rows keep working: `kind`
 * defaults to 'citation' so a NULL/missing value on legacy rows
 * stays addressable.
 *
 * Added columns:
 *
 *   - `kind`                  'citation' | 'content_gen' | 'moderation' | 'summary'
 *                             Drives prompt selection in the generator
 *                             pipeline. The existing weekly citation
 *                             cron filters on `kind = 'citation'` after
 *                             this migration.
 *
 *   - `system_prompt`         Optional system message for content-gen
 *                             prompts. Citation prompts use only the
 *                             user-side `prompt` column.
 *
 *   - `user_prompt_template`  Handlebars-rendered template — the actual
 *                             user message sent to the model. References
 *                             {{title}}, {{variables.sector}}, etc. when
 *                             called from the template generator.
 *
 *   - `content_type_target`   'comparison' | 'category' | 'learn' | …
 *                             Restricts which template / page type the
 *                             prompt is eligible for. Null = any.
 *
 *   - `preferred_provider`    'openai' | 'anthropic' | 'perplexity' | 'gemini'
 *
 *   - `preferred_model`       e.g. 'gpt-4o-mini', 'claude-haiku-4-5'
 *
 *   - `temperature`           0..2, default 0.2 (terse + factual for
 *                             finance content)
 *
 *   - `max_tokens`            cap on output; default 2000
 *
 *   - `output_schema_json`    optional zod-compatible JSON schema for
 *                             structured-output mode
 *
 *   - `version`               int, increments on prompt edits via the
 *                             admin UI
 *
 * `down()` drops every new column. Existing citation rows stay valid.
 *
 * CHECK constraints:
 *   - kind IN the 4 enum values
 *   - temperature BETWEEN 0 AND 2
 *   - max_tokens BETWEEN 1 AND 16000
 *   - preferred_provider IN the 4 known providers (when not null)
 */
export class Migration20260524100000 extends Migration {
  override async up(): Promise<void> {
    this.addSql(`
      ALTER TABLE "ovo_ai_prompt"
        ADD COLUMN IF NOT EXISTS "kind" text NOT NULL DEFAULT 'citation',
        ADD COLUMN IF NOT EXISTS "system_prompt" text NULL,
        ADD COLUMN IF NOT EXISTS "user_prompt_template" text NULL,
        ADD COLUMN IF NOT EXISTS "content_type_target" text NULL,
        ADD COLUMN IF NOT EXISTS "preferred_provider" text NULL,
        ADD COLUMN IF NOT EXISTS "preferred_model" text NULL,
        ADD COLUMN IF NOT EXISTS "temperature" double precision NOT NULL DEFAULT 0.2,
        ADD COLUMN IF NOT EXISTS "max_tokens" integer NOT NULL DEFAULT 2000,
        ADD COLUMN IF NOT EXISTS "output_schema_json" jsonb NULL,
        ADD COLUMN IF NOT EXISTS "version" integer NOT NULL DEFAULT 1;
    `)

    this.addSql(`
      ALTER TABLE "ovo_ai_prompt"
        ADD CONSTRAINT "chk_ovo_ai_prompt_kind"
          CHECK ("kind" IN ('citation','content_gen','moderation','summary'));
    `)
    this.addSql(`
      ALTER TABLE "ovo_ai_prompt"
        ADD CONSTRAINT "chk_ovo_ai_prompt_provider"
          CHECK ("preferred_provider" IS NULL OR "preferred_provider" IN ('openai','anthropic','perplexity','gemini'));
    `)
    this.addSql(`
      ALTER TABLE "ovo_ai_prompt"
        ADD CONSTRAINT "chk_ovo_ai_prompt_temperature"
          CHECK ("temperature" >= 0 AND "temperature" <= 2);
    `)
    this.addSql(`
      ALTER TABLE "ovo_ai_prompt"
        ADD CONSTRAINT "chk_ovo_ai_prompt_max_tokens"
          CHECK ("max_tokens" >= 1 AND "max_tokens" <= 16000);
    `)

    this.addSql(`
      CREATE INDEX IF NOT EXISTS "idx_ovo_ai_prompt_kind_active"
        ON "ovo_ai_prompt" ("kind", "active")
        WHERE "deleted_at" IS NULL;
    `)
    this.addSql(`
      CREATE INDEX IF NOT EXISTS "idx_ovo_ai_prompt_content_type"
        ON "ovo_ai_prompt" ("content_type_target")
        WHERE "deleted_at" IS NULL AND "content_type_target" IS NOT NULL;
    `)
  }

  override async down(): Promise<void> {
    this.addSql(
      `DROP INDEX IF EXISTS "idx_ovo_ai_prompt_content_type";`,
    )
    this.addSql(`DROP INDEX IF EXISTS "idx_ovo_ai_prompt_kind_active";`)
    this.addSql(`
      ALTER TABLE "ovo_ai_prompt"
        DROP CONSTRAINT IF EXISTS "chk_ovo_ai_prompt_max_tokens",
        DROP CONSTRAINT IF EXISTS "chk_ovo_ai_prompt_temperature",
        DROP CONSTRAINT IF EXISTS "chk_ovo_ai_prompt_provider",
        DROP CONSTRAINT IF EXISTS "chk_ovo_ai_prompt_kind";
    `)
    this.addSql(`
      ALTER TABLE "ovo_ai_prompt"
        DROP COLUMN IF EXISTS "version",
        DROP COLUMN IF EXISTS "output_schema_json",
        DROP COLUMN IF EXISTS "max_tokens",
        DROP COLUMN IF EXISTS "temperature",
        DROP COLUMN IF EXISTS "preferred_model",
        DROP COLUMN IF EXISTS "preferred_provider",
        DROP COLUMN IF EXISTS "content_type_target",
        DROP COLUMN IF EXISTS "user_prompt_template",
        DROP COLUMN IF EXISTS "system_prompt",
        DROP COLUMN IF EXISTS "kind";
    `)
  }
}
