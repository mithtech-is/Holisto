import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import {
  ONLINE_VISIBILITY_OPTIMIZATION_MODULE,
  OvoService,
} from "../../../../../modules/online_visibility_optimization"
import { logger } from "../../../../../utils/logger"

/**
 * GET /admin/ovo/sitemap/shard-counts
 *
 * Returns per-shard URL counts pulled live from the storefront's
 * sitemap index. Used by the SEO admin tab to render a "this shard
 * has N URLs" badge next to each shard toggle — quick sanity check
 * that no shard has gone empty after a publish-storm or a misconfig.
 *
 * Read-only and idempotent; the heavy lift is one HTTP GET per shard
 * against the public sitemap so we never tie up DB connections.
 * Cached upstream by the storefront's ISR, so repeat calls within
 * the cache TTL are cheap.
 */
export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const ovo = req.scope.resolve(
    ONLINE_VISIBILITY_OPTIMIZATION_MODULE,
  ) as OvoService
  try {
    const result = await ovo.getSitemapShardCounts()
    res.json(result)
  } catch (err) {
    logger.error("ovo.sitemap.shard-counts.GET failed", { error: err })
    res
      .status(500)
      .json({
        message: (err as Error).message ?? "shard_counts_failed",
      })
  }
}
