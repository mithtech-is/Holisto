import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { z } from "zod"
import {
  ONLINE_VISIBILITY_OPTIMIZATION_MODULE,
  OvoService,
} from "../../../../../modules/online_visibility_optimization"
import { logger } from "../../../../../utils/logger"

/**
 * GET  /admin/ovo/ai/prompts?kind=citation  — list prompts of one kind
 * POST /admin/ovo/ai/prompts                — create new citation prompt
 *
 *   GET: defaults to kind=citation so AiCitationsTab doesn't display
 *        Phase 4's content_gen / moderation / summary prompts mixed
 *        in with the citation prompts it owns. Pass `kind=all` to
 *        return everything (legacy callers).
 *
 *   POST body: { prompt, category?, notes?, active? } — always creates
 *   a kind="citation" row (other kinds are seeded server-side, not
 *   operator-created).
 */

const KindSchema = z.enum([
  "citation",
  "content_gen",
  "moderation",
  "summary",
])

const CreateSchema = z.object({
  prompt: z.string().min(8).max(500),
  category: z.string().max(64).nullable().optional(),
  notes: z.string().max(1000).nullable().optional(),
  active: z.boolean().optional(),
})

export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const ovo = req.scope.resolve(
    ONLINE_VISIBILITY_OPTIMIZATION_MODULE,
  ) as OvoService
  const q = req.query as Record<string, string | undefined>
  const kindParam = (q.kind ?? "citation").toLowerCase()
  const opts: Parameters<OvoService["listAiPrompts"]>[0] = {}
  if (kindParam !== "all") {
    const parsed = KindSchema.safeParse(kindParam)
    if (!parsed.success) {
      return res
        .status(400)
        .json({ message: `invalid kind: ${kindParam}` })
    }
    opts.kind = parsed.data
  }
  try {
    const rows = await ovo.listAiPrompts(opts)
    res.json({ rows })
  } catch (err) {
    logger.error("ovo.ai.prompts.GET failed", { error: err })
    res
      .status(500)
      .json({ message: (err as Error).message ?? "prompts_load_failed" })
  }
}

export const POST = async (req: MedusaRequest, res: MedusaResponse) => {
  const parsed = CreateSchema.safeParse(req.body)
  if (!parsed.success) {
    return res
      .status(400)
      .json({ message: "Invalid input", errors: parsed.error.flatten() })
  }
  const ovo = req.scope.resolve(
    ONLINE_VISIBILITY_OPTIMIZATION_MODULE,
  ) as OvoService
  try {
    const row = await (ovo as any).createOvoAiPrompts({
      prompt: parsed.data.prompt,
      category: parsed.data.category ?? null,
      notes: parsed.data.notes ?? null,
      active: parsed.data.active ?? true,
      kind: "citation",
    })
    res.json({ prompt: Array.isArray(row) ? row[0] : row })
  } catch (err) {
    logger.error("ovo.ai.prompts.POST failed", { error: err })
    res
      .status(500)
      .json({ message: (err as Error).message ?? "prompt_create_failed" })
  }
}
