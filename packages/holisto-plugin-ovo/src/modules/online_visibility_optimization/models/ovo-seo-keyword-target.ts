import { model } from "@medusajs/framework/utils"

/**
 * Operator-curated "this keyword is meant to rank for us" target.
 *
 * Phase 1 of the OVO keyword-domination work widens the original
 * `(url, keyword, priority, notes)` row into a richer shape:
 *
 *   - Keywords are grouped via `keyword_group_id` so admins can slice
 *     performance by funnel stage / intent / sector / campaign.
 *   - `url` is now nullable: keywords can be queued for tracking
 *     before a landing page exists (the eventual page picks them up
 *     when published).
 *   - `normalized_keyword` is the dedup key — lowercased, trimmed,
 *     whitespace-collapsed, NFKC-normalised, zero-width-stripped.
 *     Matching against `ovo_seo_query_history.query` in the daily
 *     rollup uses this column.
 *   - `target_position` lets ops say "we want to rank ≤ X" so the
 *     service can auto-flip status to "won" / "lost" on threshold
 *     cross.
 *   - `status` is an explicit state machine: tracking → won|lost,
 *     plus a manual `paused` escape hatch.
 *   - `tags` is a free-text array for cross-cutting concerns that
 *     don't justify a group of their own (e.g. "seasonal", "needs
 *     refresh").
 *
 * The row is consumed by:
 *
 *   1. **Daily rollup** — `keyword-performance-rollup.ts` joins this
 *      table against `ovo_seo_query_history` using
 *      `lower(query) = normalized_keyword` and writes one
 *      `ovo_seo_keyword_perf_snapshot` row per match.
 *
 *   2. **Opportunity detection** — `keyword-opportunity-detector.ts`
 *      reads the rollup history per target and surfaces ranking gaps
 *      (`ctr_optimization`, `striking_distance`, etc.).
 *
 *   3. **Audit lint** — when auditing `url` (if set), the auditor
 *      checks that `keyword` appears in title / h1 / body.
 *
 *   4. **Admin Keywords tab** — 3-column layout: group tree on the
 *      left, target table in the middle, detail drawer on the right.
 *
 * Priority is widened from 1-3 to 1-5 (`CHECK` constraint added in
 * migration) so admins can split "secondary" into closely-related vs
 * tangential.
 */
export const OvoSeoKeywordTarget = model.define("ovo_seo_keyword_target", {
  id: model.id().primaryKey(),

  /** The full URL this target is attached to. Nullable in Phase 1
   *  so keywords can be queued before a page exists. Stored as
   *  plaintext rather than a path so the natural-key index works
   *  against whatever the live sitemap currently returns. */
  url: model.text().nullable(),

  /** The exact search-engine query string as authored. Stored
   *  verbatim so the admin UI can show it as the operator typed it
   *  (capitalisation, punctuation). Matching uses
   *  `normalized_keyword` — never this column. */
  keyword: model.text(),

  /** Lowercased, trimmed, whitespace-collapsed, NFKC-normalised,
   *  zero-width-stripped form of `keyword`. This is the dedup key
   *  and the column the rollup join uses. Backfilled by
   *  Migration20260516110000 for pre-existing rows. */
  normalized_keyword: model.text().index(),

  /** Soft FK → `ovo_seo_keyword_group.id`. Null = "Uncategorized"
   *  virtual bucket (rendered in admin sidebar but not stored). */
  keyword_group_id: model.text().index().nullable(),

  /** 1 = primary head term, 5 = experimental long tail. Used purely
   *  for sorting + visual grouping in admin. `CHECK BETWEEN 1 AND
   *  5` enforced at the DB level. */
  priority: model.number().default(2),

  /** Monthly search volume from external provider (Ahrefs / SEMrush
   *  / Google Keyword Planner). Null until the optional refresh
   *  job is run. Hint, not authoritative. */
  search_volume_monthly: model.number().nullable(),

  /** Keyword-difficulty score, 0-100. Provider-specific scale
   *  (Ahrefs KD, SEMrush KD%). Drives the prioritisation column in
   *  admin. Null until refreshed. */
  search_difficulty: model.number().nullable(),

  /** "We want to rank ≤ X for this keyword." Null = no auto-flip;
   *  `status` then stays at "tracking" forever. When set, the
   *  rollup cron flips status to "won" once `position <=
   *  target_position`, and back to "lost" if position regresses by
   *  >3 ranks. Admin override (`status_override` future field)
   *  sticks. */
  target_position: model.number().nullable(),

  /** Optional operator note — why this is the target, expected
   *  difficulty, etc. Not surfaced to search engines. */
  notes: model.text().nullable(),

  /** ISO 3166-1 alpha-2 country code. Most rows are "IN" (India).
   *  Lets us run separate target lists per country in future
   *  (en-IN vs en-US). Defaults from `ovo_setting.keyword_tracking
   *  .default_country`. */
  target_country: model.text().default("IN"),

  /** BCP-47 language tag. Defaults from `ovo_setting.keyword_tracking
   *  .default_language`. */
  language: model.text().default("en"),

  /** Cross-cutting tags ("seasonal", "needs-refresh", "experimental").
   *  Stored as jsonb (text[] semantically) so admin can filter
   *  without joining a tag table. Operator-curated. */
  tags: model.json().nullable(),

  /** Soft-pause without deleting. Inactive targets still appear in
   *  history but the rollup cron skips them. */
  is_active: model.boolean().default(true),

  /** State machine: "tracking" | "paused" | "won" | "lost".
   *  Auto-managed when `target_position` is set; manual otherwise.
   *  `CHECK` constraint enforced at the DB level. */
  status: model.text().default("tracking"),

  /** Auto-classified search intent (OVO Phase 8.D).
   *  One of: "informational" | "navigational" | "transactional" |
   *  "commercial". Set by `lib/intent-classifier.ts` on every
   *  upsert; admins can manually override via the Keywords tab.
   *  Drives the "funnel-stage" mix chart in the dashboard. */
  search_intent: model.text().default("informational").index(),
})
