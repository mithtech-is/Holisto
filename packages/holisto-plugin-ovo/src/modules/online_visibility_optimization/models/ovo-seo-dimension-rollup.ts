import { model } from "@medusajs/framework/utils"

/**
 * Current top-N snapshot of one search-analytics dimension. Powers the
 * "top queries / top pages / countries / devices" tables on the OVO
 * metrics tab.
 *
 * One row per (engine, dimension_type, dimension_value, window_days).
 * The daily ingest cron does DELETE-then-INSERT per (dimension_type,
 * window_days) so the table only ever holds the latest snapshot — no
 * unbounded growth. Per-query rank *history* lives in the sibling
 * `ovo_seo_query_history` table.
 *
 * Why a single tall table for all four dimensions (query, page,
 * country, device):
 *   - Same shape per row; one ingest pattern; one list endpoint.
 *   - Adding a new dimension (e.g. `appearance`) is a no-op — just
 *     write rows with the new `dimension_type`. No migration.
 *   - Each dimension's read query is cheap: filter by
 *     `(engine, dimension_type)` which is the composite index.
 *
 * `dimension_value` is intentionally untyped — for `page` it's a URL,
 * for `country` an ISO 3166-1 alpha-3 code, for `device` "DESKTOP" /
 * "MOBILE" / "TABLET", for `query` the raw search string. GSC sometimes
 * returns very long queries; we leave them uncapped here since the
 * table is bounded by daily replacement.
 */
export const OvoSeoDimensionRollup = model.define(
  "ovo_seo_dimension_rollup",
  {
    id: model.id().primaryKey(),

    /** "gsc" — open-typed for future engines that expose query-level
     *  analytics (Bing Webmaster's query stats endpoint, Yandex …). */
    engine: model.text().index(),

    /** "query" | "page" | "country" | "device". Validated at service
     *  boundary. Indexed for the common "top X for dimension Y" read. */
    dimension_type: model.text().index(),

    /** The dimension value itself. */
    dimension_value: model.text(),

    /** Rolling window the snapshot represents. 28 = last 4 weeks. */
    window_days: model.number(),

    /** Total clicks in the window. */
    clicks: model.number(),

    /** Total impressions in the window. */
    impressions: model.number(),

    /** Click-through rate (clicks ÷ impressions), 0..1. */
    ctr: model.number(),

    /** Mean SERP position (lower is better). */
    position: model.number(),

    /** When this snapshot was written. Useful to detect a stale ingest
     *  in the UI footer. */
    captured_at: model.dateTime(),
  },
)
