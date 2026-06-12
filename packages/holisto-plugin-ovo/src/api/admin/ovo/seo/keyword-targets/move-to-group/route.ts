import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { z } from "zod"
import {
  ONLINE_VISIBILITY_OPTIMIZATION_MODULE,
  OvoService,
} from "../../../../../../modules/online_visibility_optimization"
import { logger } from "../../../../../../utils/logger"

/**
 * POST /admin/ovo/seo/keyword-targets/move-to-group
 *   { target_ids: string[], group_id: string | null }
 *
 * Bulk-reassign N keyword targets to a different group (or unassign
 * via `group_id: null`). Used by the multi-select toolbar in the
 * Keywords admin tab. Returns the moved count.
 */

const BodySchema = z.object({
  target_ids: z.array(z.string().min(1)).min(1).max(2000),
  group_id: z.string().min(1).nullable(),
})

export const POST = async (req: MedusaRequest, res: MedusaResponse) => {
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
    const result = await ovo.moveKeywordsToGroup(
      parsed.data.target_ids,
      parsed.data.group_id,
    )
    res.json(result)
  } catch (err) {
    logger.error("ovo.seo.keyword-targets.move-to-group failed", {
      error: err,
    })
    res
      .status(500)
      .json({ message: (err as Error).message ?? "move_failed" })
  }
}
