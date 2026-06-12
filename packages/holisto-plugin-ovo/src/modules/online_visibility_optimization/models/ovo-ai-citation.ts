import { model } from "@medusajs/framework/utils"

/**
 * One AI-citation observation: prompt × provider × week.
 *
 * Populated by the `ai-citation-weekly` cron (Sundays 02:00 UTC) and
 * the manual "Run now" admin button. Each (prompt, provider) pair
 * gets one row per run — the week-cadence + 90-day retention keeps
 * the table bounded (~120 rows/week × 12 weeks ≈ 1,440 rows steady
 * state).
 *
 * The extracted signal columns (`mentions_brand`,
 * `competitor_mentions`, `position`, etc.) are derived by
 * `lib/ai-citation/extract.ts` from the raw `answer` text — kept as
 * separate columns so the admin tab can chart them without re-parsing
 * the long-form text on every load.
 *
 * `raw_response` is the full provider payload (model + usage + any
 * Perplexity citations array) for debugging unexpected extractions.
 */
export const OvoAiCitation = model.define("ovo_ai_citation", {
  id: model.id().primaryKey(),

  /** Which prompt was asked. FK-style via id, but no hard FK because
   *  prompts can be soft-deleted and we want the historical citation
   *  to remain readable. */
  prompt_id: model.text().index(),

  /** Snapshot of the prompt text at run time. Lets the admin UI show
   *  the original phrasing even if the prompt was later edited. */
  prompt_text: model.text(),

  /** "openai" | "anthropic" | "perplexity" | "gemini". Indexed because
   *  the admin tab's per-provider matrix filters on this. */
  provider: model.text().index(),

  /** Which model variant produced the answer ("gpt-4o-mini",
   *  "claude-haiku-4-5", "sonar", "gemini-2.0-flash-lite"). Stored so
   *  a model swap mid-tracking is visible in retrospect. */
  model_name: model.text(),

  /** The provider's full answer text. Up to a few KB — capped at
   *  ~8000 chars by the lib wrappers to keep the row reasonable. */
  answer: model.text(),

  /** Run wall-clock time. */
  latency_ms: model.number(),

  /** Did the answer mention the configured brand (case-insensitive)? */
  mentions_brand: model.boolean(),

  /** Did the answer reference a configured brand domain by URL? */
  links_brand: model.boolean(),

  /** Competitor brand names found in the answer (subset of the
   *  module-level competitor list — see `lib/ai-citation/extract.ts`). */
  competitor_mentions: model.json().nullable(),

  /** Heuristic sentiment toward the configured brand in this answer: "positive",
   *  "neutral", "negative", or null when not enough signal. Pure
   *  keyword check (no per-row ML call). */
  sentiment: model.text().nullable(),

  /** If the answer is a numbered list, the position the brand appears
   *  at (1-based). null when the brand isn't in any ranked list. */
  position: model.number().nullable(),

  /** Full provider response JSON for debugging. */
  raw_response: model.json().nullable(),

  /** When the citation was captured. */
  captured_at: model.dateTime(),
})
