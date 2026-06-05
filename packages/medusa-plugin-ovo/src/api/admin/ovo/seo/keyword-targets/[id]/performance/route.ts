import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import {
  ONLINE_VISIBILITY_OPTIMIZATION_MODULE,
  OvoService,
} from "../../../../../../../modules/online_visibility_optimization"
import { logger } from "../../../../../../../utils/logger"

/**
 * GET /admin/ovo/seo/keyword-targets/:id/performance?window_days=28
 *
 * Per-target daily trend from `ovo_seo_keyword_perf_snapshot`. Powers
 * the rank-trend chart in the Keywords admin tab's detail drawer.
 *
 * Returns { series: KwPerfPoint[], latest: KwPerfPoint | null }
 *   where KwPerfPoint = { date, clicks, impressions, ctr, position,
 *                         indexed }
 *
 * Window default 28 days. Capped at the retention horizon (730 days).
 */
export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const id = (req.params as Record<string, string>).id
  const ovo = req.scope.resolve(
    ONLINE_VISIBILITY_OPTIMIZATION_MODULE,
  ) as OvoService
  const q = req.query as Record<string, string | undefined>
  const window_days = q.window_days
    ? Math.max(1, Math.min(Number(q.window_days) || 28, 730))
    : undefined
  try {
    const perf = await ovo.getKeywordPerformance(id, window_days)
    res.json(perf)
  } catch (err) {
    logger.error("ovo.seo.keyword-targets.performance failed", {
      error: err,
    })
    res
      .status(500)
      .json({ message: (err as Error).message ?? "keyword_perf_load_failed" })
  }
}
