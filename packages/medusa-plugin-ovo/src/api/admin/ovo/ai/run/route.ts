import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { z } from "zod"
import {
  ONLINE_VISIBILITY_OPTIMIZATION_MODULE,
  OvoService,
} from "../../../../../modules/online_visibility_optimization"
import { logger } from "../../../../../utils/logger"

/**
 * POST /admin/ovo/ai/run
 *   { prompt_id?: string }   optional — if absent runs all active prompts
 *
 * Manually fire the AI-citation pipeline. Same code path as the
 * weekly cron. Useful when an operator pastes a new key + wants
 * immediate feedback ("is this working?") without waiting until
 * Sunday.
 */
const BodySchema = z.object({
  prompt_id: z.string().min(1).max(128).optional(),
})

export const POST = async (req: MedusaRequest, res: MedusaResponse) => {
  const parsed = BodySchema.safeParse(req.body ?? {})
  if (!parsed.success) {
    return res
      .status(400)
      .json({ message: "Invalid input", errors: parsed.error.flatten() })
  }
  const ovo = req.scope.resolve(
    ONLINE_VISIBILITY_OPTIMIZATION_MODULE,
  ) as OvoService

  try {
    if (parsed.data.prompt_id) {
      const [row] = await (ovo as any).listOvoAiPrompts(
        { id: parsed.data.prompt_id },
        { take: 1 },
      )
      if (!row) {
        return res.status(404).json({ message: "prompt not found" })
      }
      const result = await ovo.runAiCitationsForPrompt(
        row as { id: string; prompt: string },
      )
      return res.json({
        prompt_id: parsed.data.prompt_id,
        success: result.success,
        errors: result.errors,
      })
    }
    const result = await ovo.runAiCitationsForAll({ trigger: "manual" })
    res.json(result)
  } catch (err) {
    logger.error("ovo.ai.run failed", { error: err })
    res.status(500).json({ message: (err as Error).message ?? "run_failed" })
  }
}
