import { model } from "@medusajs/framework/utils"

/**
 * Daily per-target rollup snapshot. One row per
 * (keyword_target_id, engine, date). Powers the per-keyword trend
 * chart in the Keywords admin tab and the aggregated Groups
 * Performance dashboard.
 *
 * Derived from the existing `ovo_seo_query_history` table by the
 * daily `keyword-performance-rollup` cron — we DO NOT duplicate raw
 * GSC data, we denormalise the join (`query_history` × `keyword_target`)
 * for fast dashboard reads.
 *
 * Matching strategy:
 *   - v1 (Phase 1): exact match on lowercased / collapsed-whitespace
 *     `normalized_keyword`.
 *   - v2 (Phase 2): trigram similarity (`pg_trgm`, threshold 0.7) to
 *     catch GSC variants ("nse unlisted shares" vs
 *     "nse unlisted-shares").
 *
 * `top_url` records the URL that actually ranked for this keyword on
 * the given day — usually but not always equal to
 * `keyword_target.url`. Diverging values signal cannibalisation.
 *
 * Retention: 730 days (mirrors `SEO_METRIC_RETENTION_DAYS` in the
 * service). Two years is enough for year-over-year trend overlays;
 * beyond that the chart compresses into noise.
 */
export const OvoSeoKeywordPerfSnapshot = model.define(
  "ovo_seo_keyword_perf_snapshot",
  {
    id: model.id().primaryKey(),

    /** Soft FK → `ovo_seo_keyword_target.id`. No hard REFERENCES so
     *  archiving a target doesn't cascade-delete its history. The
     *  service is responsible for orphan handling. */
    keyword_target_id: model.text().index(),

    /** "gsc" | "bing" (open-typed). Mirrors `ovo_seo_metric.engine`
     *  so we can later combine multi-engine performance. */
    engine: model.text().default("gsc").index(),

    /** UTC calendar date wrapped at midnight UTC. YYYY-MM-DD
     *  granularity. */
    date: model.dateTime().index(),

    /** Clicks for this (target, engine, date) bucket. */
    clicks: model.number().default(0),

    /** Impressions for this (target, engine, date) bucket. */
    impressions: model.number().default(0),

    /** Click-through rate, 0..1. Stored rather than computed at read
     *  time so dashboard joins stay cheap. */
    ctr: model.number().default(0),

    /** SERP position — averaged across impressions for the day.
     *  Lower is better. Null if no impressions registered. */
    position: model.number().nullable(),

    /** Whether the keyword was indexed at all (any impressions ≥ 1
     *  on the day). Drives the "indexed coverage" gauge. */
    indexed: model.boolean().default(true),

    /** The URL that actually ranked for this keyword on this date —
     *  usually equal to `keyword_target.url`. Divergence flags
     *  cannibalisation in the admin tab. */
    top_url: model.text().nullable(),

    /** When the rollup row was written. Distinct from `date` (which
     *  is the snapshot's logical day) — `captured_at` reflects when
     *  the cron ran, useful for debugging delayed ingests. */
    captured_at: model.dateTime(),
  },
)
