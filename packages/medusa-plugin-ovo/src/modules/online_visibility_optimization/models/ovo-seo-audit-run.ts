import { model } from "@medusajs/framework/utils"

/**
 * Aggregate snapshot of one audit run. Inserted once per `runSeoAudit()`
 * call (cron or manual). Powers the "audit health over time" trend
 * chart on the Audit tab — without this, an operator can't tell whether
 * yesterday's fixes actually made things better.
 *
 * Why a separate table from `ovo_seo_audit`:
 *   - `ovo_seo_audit` is replaced-per-URL on every run (latest snapshot
 *     only). The previous run's stats would be lost otherwise.
 *   - This table grows linearly with runs (~365 rows/year at daily
 *     cadence). Pruning > 1 year happens inside the service.
 *
 * No per-URL detail here — just the summary deltas. Operators who
 * want "which specific URL regressed yesterday?" still use the live
 * `ovo_seo_audit` table.
 */
export const OvoSeoAuditRun = model.define("ovo_seo_audit_run", {
  id: model.id().primaryKey(),

  /** When this run started. Used as the X-axis on the trend chart. */
  started_at: model.dateTime(),

  /** How long the full sweep took, milliseconds. */
  duration_ms: model.number(),

  /** Total URLs the audit attempted (everything in the sitemap-index). */
  urls_total: model.number(),

  /** URLs returning at least one "error"-severity finding. */
  urls_error: model.number(),

  /** URLs with no errors but at least one "warn". */
  urls_warn: model.number(),

  /** URLs that passed every check. */
  urls_healthy: model.number(),

  /** What kicked off the run — "cron" or "manual" (admin button) or
   *  "single_url" (per-URL re-audit). Useful for telemetry. */
  trigger: model.text(),

  /** Counts per finding code at the end of the run. Lets the trend
   *  chart break down "title_long over time" without scanning every
   *  `ovo_seo_audit` row historically. */
  issues_by_code: model.json().nullable(),
})
