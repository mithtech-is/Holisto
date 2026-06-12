import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import {
  ONLINE_VISIBILITY_OPTIMIZATION_MODULE,
  OvoService,
} from "../../../../../modules/online_visibility_optimization"
import { logger } from "../../../../../utils/logger"

/**
 * GET /admin/ovo/seo/crawl-freshness
 *
 * Joins the live sitemap's `<lastmod>` per URL with Googlebot's
 * `last_crawl_time` from URL Inspection. Returns two buckets the
 * Indexability tab acts on:
 *
 *   - `stale_crawl`   — sitemap says "I updated this", Googlebot
 *                       hasn't visited since. IndexNow ping fixes.
 *   - `never_indexed` — coverage state is "Discovered/not indexed"
 *                       or "URL unknown to Google".
 *
 * Admin can bulk-push every "actionable" URL (union of the two) to
 * IndexNow via the existing `/admin/ovo/submissions/push` endpoint
 * with `destination: "indexnow"` + `urls: [...]`.
 */
export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const ovo = req.scope.resolve(
    ONLINE_VISIBILITY_OPTIMIZATION_MODULE,
  ) as OvoService
  try {
    const result = await ovo.getCrawlFreshness()
    res.json(result)
  } catch (err) {
    logger.error("ovo.seo.crawl-freshness failed", { error: err })
    res
      .status(500)
      .json({ message: (err as Error).message ?? "crawl_freshness_failed" })
  }
}
