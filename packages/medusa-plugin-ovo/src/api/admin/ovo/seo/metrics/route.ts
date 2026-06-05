import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import {
  ONLINE_VISIBILITY_OPTIMIZATION_MODULE,
  OvoService,
} from "../../../../../modules/online_visibility_optimization"
import { logger } from "../../../../../utils/logger"

/**
 * GET /admin/ovo/seo/metrics
 *   ?engine=gsc|bing
 *   ?metric_type=impressions|clicks|ctr|avg_position|indexed_surfaced|crawled_pages|crawl_errors_4xx|crawl_errors_5xx
 *   ?from=ISO8601    optional lower bound (inclusive)
 *   ?to=ISO8601      optional upper bound (inclusive)
 *   ?limit=N         optional (default 1000, max 5000)
 *
 * Returns ascending-by-date rows from `ovo_seo_metric`. The admin
 * metrics tab calls this once per (engine, metric_type) tuple it wants
 * to chart.
 */
export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const ovo = req.scope.resolve(
    ONLINE_VISIBILITY_OPTIMIZATION_MODULE,
  ) as OvoService
  const q = req.query as Record<string, string | undefined>

  const parsed = {
    engine: q.engine,
    metric_type: q.metric_type,
    from: q.from ? new Date(q.from) : undefined,
    to: q.to ? new Date(q.to) : undefined,
    limit: q.limit ? Math.max(1, Math.min(5000, Number(q.limit))) : 1000,
  }

  try {
    const rows = await ovo.listSeoMetrics(parsed)
    res.json({ rows })
  } catch (err) {
    logger.error("ovo.seo.metrics failed", { error: err })
    res
      .status(500)
      .json({ message: (err as Error).message ?? "metrics_load_failed" })
  }
}
