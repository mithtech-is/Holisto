import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import {
  ONLINE_VISIBILITY_OPTIMIZATION_MODULE,
  OvoService,
} from "../../../../../../modules/online_visibility_optimization"
import { logger } from "../../../../../../utils/logger"

/**
 * GET /admin/ovo/seo/audit/history
 *   ?url=<absolute>     — required, per-URL trend
 *   ?limit=N            — default 60 (~30 days at 2/day if manually re-fired)
 *
 * Returns asc-by-time snapshots of one URL's quality_score + issue
 * counts. Powers the per-URL trend mini-chart in the Audit-tab
 * expanded row.
 */
export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const ovo = req.scope.resolve(
    ONLINE_VISIBILITY_OPTIMIZATION_MODULE,
  ) as OvoService
  const q = req.query as Record<string, string | undefined>
  if (!q.url) {
    return res.status(400).json({ message: "url is required" })
  }
  try {
    const rows = await ovo.listAuditHistoryForUrl(
      q.url,
      q.limit ? Math.max(1, Math.min(365, Number(q.limit))) : 60,
    )
    res.json({ url: q.url, rows })
  } catch (err) {
    logger.error("ovo.seo.audit.history failed", { error: err })
    res
      .status(500)
      .json({ message: (err as Error).message ?? "history_load_failed" })
  }
}
