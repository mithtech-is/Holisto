import { model } from "@medusajs/framework/utils"

/**
 * Per-URL audit snapshot history. One row per (url, captured_at).
 *
 * Why a separate table from `ovo_seo_audit`:
 *   - `ovo_seo_audit` is replaced-per-URL on every audit run (latest
 *     snapshot only). Without history we can't answer "did this URL
 *     regress this week?" — the single most useful operational
 *     question for keeping rankings stable.
 *
 * Stored columns are deliberately minimal: only the signals the
 * Audit-tab regression panel charts. The full per-URL audit row stays
 * in `ovo_seo_audit` — we don't need to dupe the JSONB findings or
 * raw HTML sample 30 times.
 *
 * Cadence + retention:
 *   - Snapshot written by `upsertAuditRow` BEFORE it overwrites the
 *     live row (so the new row's `quality_score` doesn't trample the
 *     pre-change value).
 *   - 30-day retention via the existing nightly audit cron. ~150 URLs
 *     × 1 row/day × 30 days = ~4,500 rows steady-state.
 */
export const OvoSeoAuditHistory = model.define("ovo_seo_audit_history", {
  id: model.id().primaryKey(),

  /** The audited URL. Indexed for the per-URL regression read. */
  url: model.text().index(),

  /** When this snapshot was taken. */
  captured_at: model.dateTime().index(),

  /** Quality score 0-100 at snapshot time. */
  quality_score: model.number().default(100),

  /** Counts at snapshot time — enough to chart regressions without
   *  needing the full findings JSON. */
  issue_count: model.number().default(0),
  error_count: model.number().default(0),
  warn_count: model.number().default(0),

  /** Compact map of issue codes → count at snapshot time. Used by the
   *  "what changed?" diff view between two snapshots. */
  issue_codes: model.json().nullable(),
})
