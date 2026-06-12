import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import {
  ONLINE_VISIBILITY_OPTIMIZATION_MODULE,
  OvoService,
} from "../../../../../../modules/online_visibility_optimization"
import { logger } from "../../../../../../utils/logger"

/**
 * POST /admin/ovo/seo/keywords/backfill-intent
 *
 * One-shot reclassification — recompute `search_intent` for every
 * keyword target using the current classifier. Useful right after
 * the Phase 8.D migration ships, or whenever the classifier rules
 * are updated. Returns `{ updated, by_intent }`.
 */
export const POST = async (req: MedusaRequest, res: MedusaResponse) => {
  const ovo = req.scope.resolve(
    ONLINE_VISIBILITY_OPTIMIZATION_MODULE,
  ) as OvoService
  try {
    const out = await ovo.backfillKeywordIntent()
    res.json(out)
  } catch (err) {
    logger.error("ovo.seo.keywords.backfill-intent failed", { error: err })
    res
      .status(500)
      .json({ message: (err as Error).message ?? "intent_backfill_failed" })
  }
}
