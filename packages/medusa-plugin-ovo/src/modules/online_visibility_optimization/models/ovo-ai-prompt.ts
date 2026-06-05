import { model } from "@medusajs/framework/utils"

/**
 * Operator-curated prompt — for both AI-citation tracking AND
 * content generation.
 *
 * Phase 4 widens the table from "citation-tracker only" to a unified
 * prompt library spanning four uses (kind column):
 *
 *   - "citation"   — weekly cron asks each AI provider this prompt;
 *                     extracts brand mentions into ovo_ai_citation.
 *                     The original Phase 7.B shape — pre-existing
 *                     rows default here.
 *
 *   - "content_gen" — wraps a programmatic-SEO template's output via
 *                     the AI generator (lib/ai-content-generator.ts).
 *                     Optionally produces structured output via
 *                     `output_schema_json`.
 *
 *   - "moderation" — Phase 4 round 2; runs against AI-drafted body
 *                     before publish to flag unverifiable claims,
 *                     missing SEBI disclosure, etc.
 *
 *   - "summary"    — generates the `ai_summary` for /llm.txt + the
 *                     in-app summary card.
 *
 * Content-gen + moderation + summary rows MUST set:
 *   - kind = the appropriate value
 *   - preferred_provider + preferred_model
 *   - user_prompt_template (Handlebars-rendered against the context)
 *   - optionally system_prompt
 *
 * Citation rows keep working unchanged — they only use `prompt`,
 * `category`, `active`, `notes`.
 */
export const OvoAiPrompt = model.define("ovo_ai_prompt", {
  id: model.id().primaryKey(),

  /** Plain-English prompt — fed verbatim to each AI provider for
   *  citation-tracker rows. Content-gen rows use `user_prompt_template`
   *  instead (this column may be a duplicate / blank for those). */
  prompt: model.text(),

  /** Optional category label for grouping in the admin UI
   *  (e.g. "brand-check", "category-comparison", "task-flow"). */
  category: model.text().nullable(),

  /** Whether this prompt is fired by the weekly cron / generator.
   *  Inactive prompts stay in the DB so historical citations + draft
   *  attribution are still resolvable. */
  active: model.boolean().default(true),

  /** Operator notes — why this prompt matters, what answer we hope to
   *  see. Not surfaced to the AI provider. */
  notes: model.text().nullable(),

  /** Phase 4 — discriminator. 'citation' | 'content_gen' |
   *  'moderation' | 'summary'. CHECK constraint enforced at DB. */
  kind: model.text().default("citation"),

  /** Content-gen-only: system message sent to the model. Null for
   *  citation rows. */
  system_prompt: model.text().nullable(),

  /** Content-gen-only: Handlebars-rendered template — the actual
   *  user message sent to the model. References variables like
   *  {{title}}, {{variables.sector}} when called from the template
   *  generator. */
  user_prompt_template: model.text().nullable(),

  /** Restricts which template / page type the prompt is eligible
   *  for. NULL = any. Values match `pc_content_page.content_type`
   *  plus the first-class types (comparison/valuation/tool). */
  content_type_target: model.text().nullable(),

  /** 'openai' | 'anthropic' | 'perplexity' | 'gemini'. CHECK
   *  constraint at DB. */
  preferred_provider: model.text().nullable(),

  /** Specific model id, e.g. 'gpt-4o-mini'. */
  preferred_model: model.text().nullable(),

  /** 0..2. Default 0.2 (low for factual finance content). DB CHECK
   *  constraint. */
  temperature: model.number().default(0.2),

  /** Output token cap. Default 2000. DB CHECK constraint
   *  1..16000. */
  max_tokens: model.number().default(2000),

  /** Optional Zod-compatible JSON Schema for structured-output
   *  mode. When provided, the generator passes `response_format:
   *  json_schema` to OpenAI / equivalent for Anthropic. */
  output_schema_json: model.json().nullable(),

  /** Increments on prompt edits via the admin UI. Helps audit
   *  which draft used which prompt version. */
  version: model.number().default(1),
})
