import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { z } from "zod"
import {
  ONLINE_VISIBILITY_OPTIMIZATION_MODULE,
  OvoService,
} from "../../../../../../../modules/online_visibility_optimization"
import { INTENT_VALUES } from "../../../../../../../modules/online_visibility_optimization/lib/intent"
import { logger } from "../../../../../../../utils/logger"

/**
 * POST /admin/ovo/seo/keyword-targets/:id/intent
 *
 * Operator override for the auto-classified `search_intent`. Body:
 *   { intent: "informational"|"navigational"|"transactional"|"commercial"|"comparison" }
 *
 * The classifier still runs on every keyword-text update; this
 * endpoint sets the row directly without re-running the classifier
 * so the operator's choice sticks across keyword-text edits *until*
 * the operator picks a different intent or hits the auto-reclassify
 * backfill button.
 */
const BodySchema = z.object({
  intent: z.enum(INTENT_VALUES),
})

export const POST = async (req: MedusaRequest, res: MedusaResponse) => {
  const id = (req.params as any).id as string
  if (!id) {
    return res.status(400).json({ message: "target id required" })
  }
  const parsed = BodySchema.safeParse(req.body)
  if (!parsed.success) {
    return res
      .status(400)
      .json({ message: "Invalid input", errors: parsed.error.flatten() })
  }
  const ovo = req.scope.resolve(
    ONLINE_VISIBILITY_OPTIMIZATION_MODULE,
  ) as OvoService
  try {
    await (ovo as any).updateOvoSeoKeywordTargets({
      selector: { id },
      data: { search_intent: parsed.data.intent },
    })
    res.json({ ok: true, id, intent: parsed.data.intent })
  } catch (err) {
    logger.error("ovo.seo.keyword-targets.intent.POST failed", { error: err })
    res
      .status(500)
      .json({ message: (err as Error).message ?? "intent_update_failed" })
  }
}
