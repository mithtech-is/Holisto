import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import {
  ONLINE_VISIBILITY_OPTIMIZATION_MODULE,
  OvoService,
  type SubmissionDestination,
} from "../../../../../modules/online_visibility_optimization"
import { logger } from "../../../../../utils/logger"

/**
 * GET /admin/ovo/submissions/log
 *
 * Returns recent submission events for the admin Submit tab. Newest
 * first.
 *
 *   ?destination=indexnow|gsc|bing|yandex|all  filter (default: all)
 *   ?status=success|error|skipped              filter (default: all)
 *   ?limit=N                                   default 50, max 200
 *
 * The Status dropdown in SubmitTab passes `?status=` — this used to be
 * dropped silently because the route only parsed `destination` + `limit`.
 */
const ALLOWED_STATUS = new Set(["success", "error", "skipped"])

export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const ovo = req.scope.resolve(
    ONLINE_VISIBILITY_OPTIMIZATION_MODULE,
  ) as OvoService

  const q = req.query as Record<string, string | undefined>

  const destination = (q.destination as SubmissionDestination | undefined) ??
    undefined
  const status = q.status && ALLOWED_STATUS.has(q.status)
    ? (q.status as "success" | "error" | "skipped")
    : undefined
  const limit = q.limit ? Math.max(1, Math.min(200, Number(q.limit))) : 50

  try {
    const rows = await ovo.listSubmissionLog({
      ...(destination ? { destination } : {}),
      ...(status ? { status } : {}),
      limit,
    })
    return res.json({ rows })
  } catch (err) {
    logger.error("ovo.submissions.log failed", { error: err })
    return res
      .status(500)
      .json({ message: (err as Error).message ?? "log_load_failed" })
  }
}
