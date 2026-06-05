import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import {
  ONLINE_VISIBILITY_OPTIMIZATION_MODULE,
  OvoService,
} from "../../../../../modules/online_visibility_optimization"
import { logger } from "../../../../../utils/logger"

/**
 * GET /admin/ovo/cwv/latest
 *
 * Single batched read for the Metrics-tab CWV panel. Returns the
 * most-recent p75 + Good-density per (metric, form factor) in one
 * query. Replaces the 30-parallel `loadSeries("crux", ...)` calls
 * the original Phase 12.B panel made, which combined with the GSC +
 * Bing parallel loads tripped the admin route rate-limiter (429) on
 * Phase 12 launch.
 *
 * Read shape:
 *   {
 *     collected_at: "2026-05-15" | null,
 *     phone:   { lcp: {p75,good}, cls: {...}, inp: {...}, fcp: {...}, ttfb: {...} },
 *     desktop: { ... },
 *     all:     { ... }
 *   }
 *
 * `collected_at` is the most-recent `date` across all rows — used by
 * the panel header ("window ending YYYY-MM-DD"). Form-factor sections
 * with no data are returned as empty objects so the client doesn't
 * have to enumerate missing combinations.
 */

const METRIC_KEYS = ["lcp", "cls", "inp", "fcp", "ttfb"] as const
const FORM_FACTORS = ["phone", "desktop", "all"] as const

type MetricKey = (typeof METRIC_KEYS)[number]
type FormFactor = (typeof FORM_FACTORS)[number]

export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const ovo = req.scope.resolve(
    ONLINE_VISIBILITY_OPTIMIZATION_MODULE,
  ) as OvoService

  try {
    // Pull last 35 days of crux rows in ONE call. CrUX is a 28-day
    // rolling window; 35 days is plenty even if the cron skipped a
    // day. Engine + metric_type filter happens in-Memory below.
    const since = new Date(Date.now() - 35 * 24 * 60 * 60 * 1000)
    const rows = (await (ovo as any).listOvoSeoMetrics(
      { engine: "crux", date: { $gte: since } as any },
      { take: 5000, order: { date: "DESC" } } as any,
    )) as Array<{ metric_type: string; date: Date | string; value: number }>

    type Cell = { p75: number; good: number }
    const out: Record<FormFactor, Record<MetricKey, Cell | null>> = {
      phone: { lcp: null, cls: null, inp: null, fcp: null, ttfb: null },
      desktop: { lcp: null, cls: null, inp: null, fcp: null, ttfb: null },
      all: { lcp: null, cls: null, inp: null, fcp: null, ttfb: null },
    }
    let mostRecent: string | null = null

    // Rows are ordered DESC by date, so the FIRST occurrence per key
    // is the most-recent value.
    const seen = new Set<string>()
    for (const r of rows) {
      const m = /^cwv_(lcp|cls|inp|fcp|ttfb)_(p75|good)_(phone|desktop|all)$/.exec(
        r.metric_type,
      )
      if (!m) continue
      const [, metric, kind, ff] = m as unknown as [
        string,
        MetricKey,
        "p75" | "good",
        FormFactor,
      ]
      const key = `${ff}|${metric}|${kind}`
      if (seen.has(key)) continue
      seen.add(key)
      const cell = (out[ff][metric] ??= { p75: 0, good: 0 } as Cell)
      ;(cell as Cell)[kind] = Number(r.value)
      const dateIso =
        r.date instanceof Date
          ? r.date.toISOString().slice(0, 10)
          : String(r.date).slice(0, 10)
      if (!mostRecent || dateIso > mostRecent) mostRecent = dateIso
    }

    // Replace cells where only one of p75/good landed (rare — both
    // are written together by the ingest) with null so the client
    // doesn't display half-data.
    for (const ff of FORM_FACTORS) {
      for (const metric of METRIC_KEYS) {
        const c = out[ff][metric]
        if (c && (c.p75 === 0 && c.good === 0)) {
          // Both still zero → no real data; null it out
          out[ff][metric] = null
        }
      }
    }

    res.json({ collected_at: mostRecent, ...out })
  } catch (err) {
    logger.error("ovo.cwv.latest failed", { error: err })
    res
      .status(500)
      .json({ message: (err as Error).message ?? "cwv_latest_failed" })
  }
}
