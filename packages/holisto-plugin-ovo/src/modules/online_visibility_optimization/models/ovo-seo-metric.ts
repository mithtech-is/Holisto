import { model } from "@medusajs/framework/utils"

/**
 * Daily snapshot of one (engine, metric_type) pair from GSC or Bing
 * Webmaster API. Charted in the OVO metrics tab.
 *
 * Why a single tall table instead of one column per metric:
 *   - Adding a new metric (e.g. `valid_amp_pages`) is a no-op — just
 *     write rows with the new `metric_type`. No migration.
 *   - Charts are uniformly `SELECT date, value FROM ovo_seo_metric
 *     WHERE engine = ? AND metric_type = ?` — same shape for every
 *     line on every chart.
 *   - Sparse coverage is natural: Bing doesn't expose `indexed_pages`
 *     today; we just don't write those rows.
 *
 * Granularity: one row per (engine, metric_type, date). The cron
 * upserts daily; back-fills are idempotent. `date` is the UTC calendar
 * date the metric represents (e.g. "2026-05-14"), not the time the
 * ingest ran.
 *
 * Retention: see `OvoService.SEO_METRIC_RETENTION_DAYS`. Older rows
 * are pruned by the daily cron after a fresh insert. Default 2 years.
 */
export const OvoSeoMetric = model.define("ovo_seo_metric", {
  id: model.id().primaryKey(),

  /** "gsc" | "bing". Open-typed at the column level for future-proof
   *  (e.g. "yandex" if we ever ingest from Yandex Webmaster); validated
   *  at the service boundary. */
  engine: model.text().index(),

  /** What the value is. Open vocabulary; current canonical set:
   *    "impressions"         — query impressions (count)
   *    "clicks"              — query clicks (count)
   *    "ctr"                 — click-through rate (0..1, float)
   *    "avg_position"        — average SERP position (float)
   *    "indexed_pages"       — total indexed URL count (count)
   *    "submitted_urls"      — total URLs in sitemap (count)
   *    "crawl_errors_4xx"    — 4xx errors in last 24h (count)
   *    "crawl_errors_5xx"    — 5xx errors in last 24h (count)
   *    "deindexed_pages"     — URLs removed from index in last 24h
   *    "discovered_pages"    — URLs discovered but not yet indexed
   *
   * Keeping it text lets us add metrics from new APIs (Yandex Search
   * Console, Brave Search Webmaster, …) without enum migration. */
  metric_type: model.text().index(),

  /** UTC calendar date this row represents — YYYY-MM-DD wrapped in a
   *  timestamp at 00:00:00Z so chart code can sort/filter as date
   *  comparison. Mikro-ORM's date type would also work but timestamptz
   *  is consistent with the rest of the module. */
  date: model.dateTime(),

  /** Numeric value. Stored as `model.number()` (double precision) to
   *  fit both whole-number counts and floats (avg_position, ctr). */
  value: model.number(),

  /** Full upstream API response for the row — kept for debugging
   *  unexpected values + future retro extraction of fields we don't
   *  yet surface. NULL when the upstream call lumped many metrics
   *  into one response (we wrote one row per metric but stashed the
   *  blob only on the first row to keep storage small). */
  raw_response: model.json().nullable(),
})
