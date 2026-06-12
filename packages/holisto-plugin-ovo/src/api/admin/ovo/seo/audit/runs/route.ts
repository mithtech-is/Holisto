import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import {
  ONLINE_VISIBILITY_OPTIMIZATION_MODULE,
  OvoService,
} from "../../../../../../modules/online_visibility_optimization"
import { logger } from "../../../../../../utils/logger"

/**
 * GET /admin/ovo/seo/audit/runs
 *   ?limit=N   (default 30, max 365)
 *
 * Returns the last N audit runs in descending-time order. Powers the
 * "audit health over time" mini-trend chart on the Audit tab — lets an
 * operator see at a glance whether their last week of fixes actually
 * reduced the error count or just shuffled it around.
 */
export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const ovo = req.scope.resolve(
    ONLINE_VISIBILITY_OPTIMIZATION_MODULE,
  ) as OvoService
  const q = req.query as Record<string, string | undefined>

  try {
    const rows = await ovo.listSeoAuditRuns(
      q.limit ? Math.max(1, Math.min(365, Number(q.limit))) : 30,
    )
    res.json({ rows })
  } catch (err) {
    logger.error("ovo.seo.audit.runs failed", { error: err })
    res
      .status(500)
      .json({ message: (err as Error).message ?? "runs_load_failed" })
  }
}
