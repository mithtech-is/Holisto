import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import {
  ONLINE_VISIBILITY_OPTIMIZATION_MODULE,
  OvoService,
} from "../../../../../modules/online_visibility_optimization"
import { logger } from "../../../../../utils/logger"

/**
 * GET /admin/ovo/submissions/stats
 *
 * Per-destination rollups for the Submit tab cards:
 *   - last success timestamp
 *   - 7-day success rate
 *   - lifetime URLs pushed
 *   - per-day event counts (last 7 days, oldest first)
 *
 * Walks the most-recent 1000 rows of `ovo_submission_log` in memory
 * — no SQL filter needed. The whole call is O(rows) so it stays
 * cheap; the 7-day window is then clipped within those rows. (The
 * `SUBMISSION_LOG_MAX=200` cap on the model prunes the table over
 * time; the service's `take: 1000` is just the read-side ceiling.)
 */
export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const ovo = req.scope.resolve(
    ONLINE_VISIBILITY_OPTIMIZATION_MODULE,
  ) as OvoService
  try {
    const stats = await ovo.getSubmissionStats()
    return res.json(stats)
  } catch (err) {
    logger.error("ovo.submissions.stats failed", { error: err })
    return res
      .status(500)
      .json({ message: (err as Error).message ?? "stats_load_failed" })
  }
}
