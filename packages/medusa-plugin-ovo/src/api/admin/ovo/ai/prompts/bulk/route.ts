import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { z } from "zod"
import {
  ONLINE_VISIBILITY_OPTIMIZATION_MODULE,
  OvoService,
} from "../../../../../../modules/online_visibility_optimization"
import { logger } from "../../../../../../utils/logger"

/**
 * POST /admin/ovo/ai/prompts/bulk
 *
 *   Body: { ids: string[], patch: { active?: boolean; category?: string|null } }
 *
 * Bulk-edit N citation prompts in one call — the AI Citations admin
 * tab uses this to drive its multi-select toolbar (bulk pause/resume,
 * bulk re-categorise). Single-row PATCH still works for inline edits
 * to text / notes; this endpoint is intentionally narrowed to the two
 * fields that make sense to flip across many rows at once.
 *
 * The bulk write is sequenced via Medusa's `updateOvoAiPrompts` so the
 * normal `updated_at` bookkeeping fires per row. Returns the updated
 * count + a per-id list of any rows that failed (rare — Zod
 * pre-validates inputs and the only runtime fault is the row going
 * missing between the list call and the bulk save).
 *
 * Capped at 500 ids per call (well above the seeded 10 default
 * citation prompts; far below anything that would block the request
 * pipeline).
 */
const BodySchema = z.object({
  ids: z.array(z.string().min(1).max(128)).min(1).max(500),
  patch: z
    .object({
      active: z.boolean().optional(),
      category: z.string().max(64).nullable().optional(),
    })
    .refine(
      (p) => p.active !== undefined || p.category !== undefined,
      "patch must include at least one of { active, category }",
    ),
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

  const { ids, patch } = parsed.data
  const data: Record<string, unknown> = {}
  if (patch.active !== undefined) data.active = patch.active
  if (patch.category !== undefined) data.category = patch.category

  let updated = 0
  const errors: Array<{ id: string; error: string }> = []
  for (const id of ids) {
    try {
      await (ovo as any).updateOvoAiPrompts({ selector: { id }, data })
      updated += 1
    } catch (err) {
      errors.push({ id, error: (err as Error).message ?? "update_failed" })
    }
  }

  if (errors.length > 0) {
    logger.warn("ovo.ai.prompts.bulk partial failure", {
      attempted: ids.length,
      updated,
      errors: errors.length,
    })
  }
  res.json({ attempted: ids.length, updated, errors })
}
