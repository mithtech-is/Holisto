import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { z } from "zod"
import {
  ONLINE_VISIBILITY_OPTIMIZATION_MODULE,
  OvoService,
} from "../../../../../../modules/online_visibility_optimization"
import { logger } from "../../../../../../utils/logger"

/**
 * PATCH  /admin/ovo/ai/prompts/:id    — edit prompt (any field)
 * DELETE /admin/ovo/ai/prompts/:id    — soft-delete via Medusa default
 *
 * The DELETE path soft-deletes (sets `deleted_at`) so previously
 * captured citations against this prompt remain readable in the
 * admin tab's drill-down view.
 */
const UpdateSchema = z.object({
  prompt: z.string().min(8).max(500).optional(),
  category: z.string().max(64).nullable().optional(),
  notes: z.string().max(1000).nullable().optional(),
  active: z.boolean().optional(),
})

export const PATCH = async (req: MedusaRequest, res: MedusaResponse) => {
  const id = (req.params as Record<string, string>).id
  const parsed = UpdateSchema.safeParse(req.body)
  if (!parsed.success) {
    return res
      .status(400)
      .json({ message: "Invalid input", errors: parsed.error.flatten() })
  }
  const ovo = req.scope.resolve(
    ONLINE_VISIBILITY_OPTIMIZATION_MODULE,
  ) as OvoService
  try {
    await (ovo as any).updateOvoAiPrompts({
      selector: { id },
      data: parsed.data,
    })
    const [row] = await (ovo as any).listOvoAiPrompts(
      { id },
      { take: 1 },
    )
    res.json({ prompt: row })
  } catch (err) {
    logger.error("ovo.ai.prompts.PATCH failed", { error: err })
    res
      .status(500)
      .json({ message: (err as Error).message ?? "prompt_update_failed" })
  }
}

export const DELETE = async (req: MedusaRequest, res: MedusaResponse) => {
  const id = (req.params as Record<string, string>).id
  const ovo = req.scope.resolve(
    ONLINE_VISIBILITY_OPTIMIZATION_MODULE,
  ) as OvoService
  try {
    await (ovo as any).deleteOvoAiPrompts([id])
    res.json({ deleted: id })
  } catch (err) {
    logger.error("ovo.ai.prompts.DELETE failed", { error: err })
    res
      .status(500)
      .json({ message: (err as Error).message ?? "prompt_delete_failed" })
  }
}
