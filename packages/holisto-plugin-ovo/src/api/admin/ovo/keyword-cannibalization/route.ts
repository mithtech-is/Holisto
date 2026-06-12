import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import {
  ONLINE_VISIBILITY_OPTIMIZATION_MODULE,
  OvoService,
} from "../../../../modules/online_visibility_optimization"
import { logger } from "../../../../utils/logger"

/**
 * GET /admin/ovo/keyword-cannibalization
 *   ?window_days=14    optional analysis window (7–730), default 14
 *   ?top_n=10          optional rank threshold (3–50), default 10
 *
 * Surfaces queries where multiple owned URLs rank in the top-N
 * within the window. Computed live from `ovo_seo_query_history` ×
 * `ovo_seo_dimension_rollup` (query_page dimension), joined to
 * `ovo_seo_keyword_target` so the admin can spot when a cannibal is
 * also an explicit tracking target.
 *
 * Sorted: high → medium → low severity, then by total impressions
 * desc. Cross-references the `keyword_group_id` so the admin tab can
 * group findings by funnel stage.
 *
 * Phase 1 does NOT persist findings — live recomputation is cheap at
 * current data scale.
 */
export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const ovo = req.scope.resolve(
    ONLINE_VISIBILITY_OPTIMIZATION_MODULE,
  ) as OvoService
  const q = req.query as Record<string, string | undefined>
  const window_days = q.window_days
    ? Math.max(7, Math.min(Number(q.window_days) || 14, 730))
    : undefined
  const top_n = q.top_n
    ? Math.max(3, Math.min(Number(q.top_n) || 10, 50))
    : undefined
  try {
    const rows = await ovo.detectCannibalization({ window_days, top_n })
    const by_severity = rows.reduce<Record<string, number>>((acc, r) => {
      acc[r.severity] = (acc[r.severity] ?? 0) + 1
      return acc
    }, {})
    res.json({ rows, by_severity, total: rows.length })
  } catch (err) {
    logger.error("ovo.keyword-cannibalization.GET failed", { error: err })
    res
      .status(500)
      .json({ message: (err as Error).message ?? "cannibalization_load_failed" })
  }
}
