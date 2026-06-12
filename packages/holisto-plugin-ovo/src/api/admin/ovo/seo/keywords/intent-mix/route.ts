import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import {
  ONLINE_VISIBILITY_OPTIMIZATION_MODULE,
  OvoService,
} from "../../../../../../modules/online_visibility_optimization"
import { logger } from "../../../../../../utils/logger"

/**
 * GET /admin/ovo/seo/keywords/intent-mix
 *
 * Funnel-stage mix across all active keyword targets — counts +
 * percent share for informational/navigational/transactional/
 * commercial. Drives the small stacked-bar at the top of the
 * Keywords tab so admins see whether their tracked terms are
 * biased to one funnel stage.
 */
export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const ovo = req.scope.resolve(
    ONLINE_VISIBILITY_OPTIMIZATION_MODULE,
  ) as OvoService
  try {
    const mix = await ovo.getKeywordIntentMix()
    res.json(mix)
  } catch (err) {
    logger.error("ovo.seo.keywords.intent-mix failed", { error: err })
    res
      .status(500)
      .json({ message: (err as Error).message ?? "intent_mix_failed" })
  }
}
