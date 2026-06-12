import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import {
  ONLINE_VISIBILITY_OPTIMIZATION_MODULE,
  OvoService,
} from "../../../../modules/online_visibility_optimization"
import { logger } from "../../../../utils/logger"

/**
 * GET /admin/ovo/keyword-opportunities
 *   ?window_days=14    optional analysis window (7–730)
 *   ?group_id=:id      optional filter to one group
 *
 * Computes Phase 1 keyword opportunities live from
 * `ovo_seo_keyword_perf_snapshot` history. Powers the Opportunities
 * admin tab. Sorted: losing_position → striking_distance →
 * ctr_optimization → position_climbing, then by impressions desc.
 *
 * Phase 1 does NOT persist opportunities — the data scale (a few
 * hundred keywords × ~4 detection rules) keeps live computation
 * cheap. When volume grows we can move to a daily-materialised table.
 */
export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const ovo = req.scope.resolve(
    ONLINE_VISIBILITY_OPTIMIZATION_MODULE,
  ) as OvoService
  const q = req.query as Record<string, string | undefined>
  const window_days = q.window_days
    ? Math.max(7, Math.min(Number(q.window_days) || 14, 730))
    : undefined
  const group_id = q.group_id || undefined
  try {
    const rows = await ovo.detectKeywordOpportunities({
      window_days,
      group_id,
    })
    const by_type = rows.reduce<Record<string, number>>((acc, r) => {
      acc[r.opportunity_type] = (acc[r.opportunity_type] ?? 0) + 1
      return acc
    }, {})
    res.json({ rows, by_type, total: rows.length })
  } catch (err) {
    logger.error("ovo.keyword-opportunities.GET failed", { error: err })
    res
      .status(500)
      .json({ message: (err as Error).message ?? "opportunities_load_failed" })
  }
}
