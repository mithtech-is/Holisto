import { model } from "@medusajs/framework/utils"

/**
 * Daily per-query rank + traffic snapshot. One row per
 * (engine, query, date). Powers the "click a query → see its position
 * trend over time" interaction on the OVO metrics tab.
 *
 * Source: GSC `searchAnalytics.query` with `dimensions=["query","date"]`.
 * That endpoint returns every query that had at least one impression
 * on a given UTC date, capped by `rowLimit`. We pass 5000 so we capture
 * a long tail without paginating.
 *
 * Why a separate table from `ovo_seo_dimension_rollup`:
 *   - Rollup is a single replaced-daily snapshot; this is a growing
 *     time series. Mixing them in one table would force an awkward
 *     "is `date` NULL" branch on every read.
 *   - The composite index needed differs — chart reads filter
 *     `(query, engine, date)` in that order.
 *
 * Retention: `SEO_QUERY_HISTORY_RETENTION_DAYS` (default 90). Older
 * rows are pruned by the daily cron after each fresh upsert. GSC's
 * own per-query rank graph in the UI is 16-month-deep, but we don't
 * need that depth in-app — 90 days catches every "did the new
 * homepage change move my unlisted-shares rank?" question, beyond
 * which the operator can open GSC directly.
 */
export const OvoSeoQueryHistory = model.define("ovo_seo_query_history", {
  id: model.id().primaryKey(),

  /** "gsc". Same open-typed convention as the rollup table. */
  engine: model.text().index(),

  /** The search query string as GSC reports it. Trimmed of trailing
   *  whitespace; otherwise stored verbatim (GSC sometimes returns
   *  punctuation / Unicode). */
  query: model.text().index(),

  /** UTC calendar date the row represents — YYYY-MM-DD wrapped at
   *  midnight UTC. */
  date: model.dateTime().index(),

  /** Clicks for this (query, date) bucket. */
  clicks: model.number(),

  /** Impressions for this (query, date) bucket. */
  impressions: model.number(),

  /** Click-through rate, 0..1. */
  ctr: model.number(),

  /** SERP position for this (query, date) bucket. Lower is better. */
  position: model.number(),
})
