import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { z } from "zod"
import {
  ONLINE_VISIBILITY_OPTIMIZATION_MODULE,
  OvoService,
} from "../../../../modules/online_visibility_optimization"
import { INTENT_VALUES } from "../../../../modules/online_visibility_optimization/lib/intent"
import { logger } from "../../../../utils/logger"

/**
 * GET  /admin/ovo/keyword-groups       — list, optional filters
 * POST /admin/ovo/keyword-groups       — create
 *
 *   ?funnel_stage=TOFU|MOFU|BOFU       (optional)
 *   ?is_pillar=true|false              (optional)
 *   ?parent_group_id=:id|null          (optional)
 *
 * Powers the left sidebar tree on the Keywords admin tab.
 */

const FUNNEL = ["TOFU", "MOFU", "BOFU"] as const
// INTENT imported from the shared module — see lib/intent.ts.

const CreateSchema = z.object({
  name: z.string().min(1).max(100),
  slug: z.string().min(1).max(120).regex(/^[a-z0-9-]+$/),
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
  const ovo = req.scope.resolve(
    ONLINE_VISIBILITY_OPTIMIZATION_MODULE,
  ) as OvoService
  const q = req.query as Record<string, string | undefined>
  try {
    const filter: {
      funnel_stage?: "TOFU" | "MOFU" | "BOFU"
      is_pillar?: boolean
      parent_group_id?: string | null
    } = {}
    if (q.funnel_stage && (FUNNEL as readonly string[]).includes(q.funnel_stage)) {
      filter.funnel_stage = q.funnel_stage as "TOFU" | "MOFU" | "BOFU"
    }
    if (q.is_pillar !== undefined) {
      filter.is_pillar = q.is_pillar === "true"
    }
    if (q.parent_group_id !== undefined) {
      filter.parent_group_id =
        q.parent_group_id === "null" ? null : q.parent_group_id
    }
    const rows = await ovo.listKeywordGroups(filter)
    res.json({ rows })
  } catch (err) {
    logger.error("ovo.keyword-groups.GET failed", { error: err })
    res
      .status(500)
      .json({ message: (err as Error).message ?? "keyword_groups_load_failed" })
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
    const group = await ovo.saveKeywordGroup(parsed.data as any)
    res.json({ group })
  } catch (err) {
    const msg = (err as Error).message ?? "keyword_group_create_failed"
    // Slug conflict — surface as 409 not 500
    const status = msg.includes("already exists") ? 409 : 500
    if (status === 500) {
      logger.error("ovo.keyword-groups.POST failed", { error: err })
    }
    res.status(status).json({ message: msg })
  }
}
