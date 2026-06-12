import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import {
  ONLINE_VISIBILITY_OPTIMIZATION_MODULE,
  OvoService,
} from "../../../../../modules/online_visibility_optimization"
import { logger } from "../../../../../utils/logger"

/**
 * GET /admin/ovo/seo/query-trend
 *   ?query=<exact query string>   (required)
 *   ?engine=gsc                   (default gsc)
 *   ?from=ISO8601                 optional lower bound (inclusive)
 *   ?to=ISO8601                   optional upper bound (inclusive)
 *   ?limit=N                      (default 1000)
 *
 * Returns ascending-by-date rows from `ovo_seo_query_history`. Powers
 * the "click a query → see its rank trend" interaction on the OVO
 * metrics tab.
 *
 * The query is matched as an exact string against the `query` column
 * (no fuzzy match) — GSC's own analytics treats "unlisted shares" and
 * "unlisted share" as separate queries, so we mirror that.
 */
export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const ovo = req.scope.resolve(
    ONLINE_VISIBILITY_OPTIMIZATION_MODULE,
  ) as OvoService
  const q = req.query as Record<string, string | undefined>

  if (!q.query) {
    return res.status(400).json({ message: "query is required" })
  }

  try {
    const rows = await ovo.listSeoQueryHistory({
      engine: q.engine ?? "gsc",
      query: q.query,
      from: q.from ? new Date(q.from) : undefined,
      to: q.to ? new Date(q.to) : undefined,
      limit: q.limit ? Math.max(1, Math.min(5000, Number(q.limit))) : 1000,
    })
    res.json({ rows })
  } catch (err) {
    logger.error("ovo.seo.query-trend failed", { error: err })
    res
      .status(500)
      .json({ message: (err as Error).message ?? "trend_load_failed" })
  }
}
