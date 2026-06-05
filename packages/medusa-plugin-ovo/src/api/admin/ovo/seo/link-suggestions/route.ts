import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import {
  ONLINE_VISIBILITY_OPTIMIZATION_MODULE,
  OvoService,
} from "../../../../../modules/online_visibility_optimization"
import { logger } from "../../../../../utils/logger"

/**
 * GET /admin/ovo/seo/link-suggestions?url=<absolute>
 *   ?limit=N   (default 8, max 20)
 *
 * Returns 0..N topically-related source URLs to link FROM the given
 * target URL. Powers the AuditTab expanded-row "Suggested incoming
 * links" block — operator clicks a suggestion to copy the URL, then
 * edits that source page's body to add an anchor pointing at the
 * target.
 *
 * The matcher reads exclusively from the existing `ovo_seo_audit`
 * snapshot — no fresh HTML fetch is needed, so the response is
 * sub-100ms even with a few hundred URLs in the index.
 *
 * Especially useful for the 9 "URL is unknown to Google" findings the
 * URL Inspection tab surfaces — those need internal-link discovery
 * before Googlebot crawls them.
 */
export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const ovo = req.scope.resolve(
    ONLINE_VISIBILITY_OPTIMIZATION_MODULE,
  ) as OvoService
  const q = req.query as Record<string, string | undefined>

  if (!q.url) {
    return res.status(400).json({ message: "url is required" })
  }

  const limit = q.limit ? Math.max(1, Math.min(20, Number(q.limit))) : 8

  try {
    const result = await ovo.getInternalLinkSuggestions(q.url, limit)
    if (!result) {
      return res
        .status(404)
        .json({ message: "no audit row exists for that url yet" })
    }
    res.json(result)
  } catch (err) {
    logger.error("ovo.seo.link-suggestions failed", { error: err })
    res
      .status(500)
      .json({ message: (err as Error).message ?? "suggestions_failed" })
  }
}
