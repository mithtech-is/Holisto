import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import {
  ONLINE_VISIBILITY_OPTIMIZATION_MODULE,
  OvoService,
} from "../../../../../../modules/online_visibility_optimization"
import { logger } from "../../../../../../utils/logger"

/**
 * GET /admin/ovo/seo/audit/regressions
 *   ?window_hours=168    default = 1 week
 *   ?min_delta=10        minimum score drop to surface (default 10 points)
 *   ?limit=N             default 100
 *
 * Returns URLs whose quality_score has dropped by ≥ `min_delta` in
 * the lookback window, sorted by largest drop first. Powers the
 * Audit-tab "Regressions" alert panel — the answer to "did anything
 * break this week?" without grepping diffs by hand.
 */
export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const ovo = req.scope.resolve(
    ONLINE_VISIBILITY_OPTIMIZATION_MODULE,
  ) as OvoService
  const q = req.query as Record<string, string | undefined>
  try {
    const rows = await ovo.getRegressionAlerts({
      window_hours: q.window_hours
        ? Math.max(1, Math.min(720, Number(q.window_hours)))
        : 168,
      min_delta: q.min_delta
        ? Math.max(1, Math.min(100, Number(q.min_delta)))
        : 10,
      limit: q.limit ? Math.max(1, Math.min(1000, Number(q.limit))) : 100,
    })
    res.json({ rows })
  } catch (err) {
    logger.error("ovo.seo.audit.regressions failed", { error: err })
    res
      .status(500)
      .json({ message: (err as Error).message ?? "regressions_load_failed" })
  }
}
