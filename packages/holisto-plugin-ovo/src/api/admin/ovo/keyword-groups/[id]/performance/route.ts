import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import {
  ONLINE_VISIBILITY_OPTIMIZATION_MODULE,
  OvoService,
} from "../../../../../../modules/online_visibility_optimization"
import { logger } from "../../../../../../utils/logger"

/**
 * GET /admin/ovo/keyword-groups/:id/performance?window_days=28
 *
 * Aggregated rollup for one keyword group — totals, weekly trend,
 * impression-weighted avg position, and per-day variance (volatility).
 * Powers the Groups Performance dashboard tile + chart for a group.
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
    const summary = await ovo.getGroupPerformanceSummary(id, window_days)
    res.json(summary)
  } catch (err) {
    logger.error("ovo.keyword-groups.performance failed", { error: err })
    res
      .status(500)
      .json({ message: (err as Error).message ?? "group_perf_load_failed" })
  }
}
