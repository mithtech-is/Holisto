import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { z } from "zod"
import {
  ONLINE_VISIBILITY_OPTIMIZATION_MODULE,
  OvoService,
} from "../../../../../modules/online_visibility_optimization"
import { INTENT_VALUES } from "../../../../../modules/online_visibility_optimization/lib/intent"
import { logger } from "../../../../../utils/logger"

/**
 * GET    /admin/ovo/keyword-groups/:id   — fetch one
 * PATCH  /admin/ovo/keyword-groups/:id   — edit
 * DELETE /admin/ovo/keyword-groups/:id   — soft-delete (reparents
 *                                          child groups + unassigns
 *                                          member targets)
 */

const FUNNEL = ["TOFU", "MOFU", "BOFU"] as const
// INTENT imported from the shared module — see lib/intent.ts.

const UpdateSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  slug: z.string().min(1).max(120).regex(/^[a-z0-9-]+$/).optional(),
  description: z.string().max(500).nullable().optional(),
  color: z.string().max(40).nullable().optional(),
  icon: z.string().max(40).nullable().optional(),
  parent_group_id: z.string().nullable().optional(),
  priority: z.number().int().min(1).max(5).optional(),
  sort_order: z.number().int().min(0).max(10_000).optional(),
  intent: z.enum(INTENT_VALUES).nullable().optional(),
  funnel_stage: z.enum(FUNNEL).nullable().optional(),
  is_pillar: z.boolean().optional(),
  audit_weight: z.number().min(0.1).max(5.0).optional(),
})

export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const id = (req.params as Record<string, string>).id
  const ovo = req.scope.resolve(
    ONLINE_VISIBILITY_OPTIMIZATION_MODULE,
  ) as OvoService
  try {
    const rows = await (ovo as any).listOvoSeoKeywordGroups(
      { id },
      { take: 1 },
    )
    if (!rows[0]) {
      return res.status(404).json({ message: "keyword_group_not_found" })
    }
    res.json({ group: rows[0] })
  } catch (err) {
    logger.error("ovo.keyword-groups.GET[id] failed", { error: err })
    res
      .status(500)
      .json({ message: (err as Error).message ?? "keyword_group_load_failed" })
  }
}

export const PATCH = async (req: MedusaRequest, res: MedusaResponse) => {
  const id = (req.params as Record<string, string>).id
  const parsed = UpdateSchema.safeParse(req.body)
  if (!parsed.success) {
    return res
      .status(400)
      .json({ message: "Invalid input", errors: parsed.error.flatten() })
  }
  // Prevent self-parent loops.
  if (parsed.data.parent_group_id === id) {
    return res
      .status(400)
      .json({ message: "group cannot be its own parent" })
  }
  const ovo = req.scope.resolve(
    ONLINE_VISIBILITY_OPTIMIZATION_MODULE,
  ) as OvoService
  try {
    const group = await ovo.saveKeywordGroup({ id, ...parsed.data } as any)
    res.json({ group })
  } catch (err) {
    logger.error("ovo.keyword-groups.PATCH failed", { error: err })
    res
      .status(500)
      .json({ message: (err as Error).message ?? "update_failed" })
  }
}

export const DELETE = async (req: MedusaRequest, res: MedusaResponse) => {
  const id = (req.params as Record<string, string>).id
  const ovo = req.scope.resolve(
    ONLINE_VISIBILITY_OPTIMIZATION_MODULE,
  ) as OvoService
  try {
    await ovo.deleteKeywordGroup(id)
    res.json({ deleted: id })
  } catch (err) {
    logger.error("ovo.keyword-groups.DELETE failed", { error: err })
    res
      .status(500)
      .json({ message: (err as Error).message ?? "delete_failed" })
  }
}
