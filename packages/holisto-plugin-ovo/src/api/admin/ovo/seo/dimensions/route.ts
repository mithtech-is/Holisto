import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import {
  ONLINE_VISIBILITY_OPTIMIZATION_MODULE,
  OvoService,
} from "../../../../../modules/online_visibility_optimization"
import { logger } from "../../../../../utils/logger"

const VALID_DIMS = new Set(["query", "page", "country", "device"])

/**
 * GET /admin/ovo/seo/dimensions
 *   ?dimension=query|page|country|device   (required)
 *   ?engine=gsc                            (default gsc)
 *   ?window_days=28                        (default unset — return all)
 *   ?limit=N                               (default 200, max 1000)
 *
 * Returns top rows from `ovo_seo_dimension_rollup` for the requested
 * dimension, sorted by clicks descending. Powers the "top queries",
 * "top pages", "countries", and "devices" tables on the OVO metrics
 * tab.
 */
export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const ovo = req.scope.resolve(
    ONLINE_VISIBILITY_OPTIMIZATION_MODULE,
  ) as OvoService
  const q = req.query as Record<string, string | undefined>

  const dimension = q.dimension
  if (!dimension || !VALID_DIMS.has(dimension)) {
    return res
      .status(400)
      .json({ message: "dimension must be one of query|page|country|device" })
  }

  try {
    const rows = await ovo.listSeoDimensionRollup({
      engine: q.engine ?? "gsc",
      dimension_type: dimension as "query" | "page" | "country" | "device",
      window_days: q.window_days ? Number(q.window_days) : undefined,
      limit: q.limit ? Math.max(1, Math.min(1000, Number(q.limit))) : 200,
    })
    res.json({ rows })
  } catch (err) {
    logger.error("ovo.seo.dimensions failed", { error: err })
    res
      .status(500)
      .json({
        message: (err as Error).message ?? "dimensions_load_failed",
      })
  }
}
