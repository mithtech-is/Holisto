import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { z } from "zod"
import {
  ONLINE_VISIBILITY_OPTIMIZATION_MODULE,
  OvoService,
} from "../../../../../modules/online_visibility_optimization"
import { INTENT_VALUES } from "../../../../../modules/online_visibility_optimization/lib/intent"
import { logger } from "../../../../../utils/logger"

/**
 * GET /admin/ovo/seo/keyword-targets
 *
 *   ?url=...               legacy exact-URL filter
 *   ?keyword=...           legacy exact-keyword filter
 *   ?group_id=:id|null     filter to one group (Phase 1)
 *   ?status=tracking|paused|won|lost
 *   ?tag=:tag              tag membership (Phase 1)
 *   ?q=:fragment           prefix match on normalized_keyword
 *   ?is_active=true|false  defaults true
 *   ?limit=:n              default 500, capped 5000
 *   ?offset=:n             pagination
 *   ?with_performance=1    join latest GSC snapshot / rollup
 *
 * POST /admin/ovo/seo/keyword-targets
 *   { keyword, keyword_group_id?, url?, priority?, notes?,
 *     target_country?, language?, tags?, target_position?,
 *     search_volume_monthly?, search_difficulty?, status?,
 *     is_active?, search_intent? }
 *
 *   Phase 1 widening:
 *     - `url` optional (keywords can be queued before a page exists)
 *     - `priority` widened to 1-5
 *     - upsert by `(normalized_keyword, target_country, language)`
 *       so retried CSV imports stay idempotent
 *     - auto-classifies `search_intent` via `lib/intent-classifier`
 *
 * Powers the Keywords admin tab (`/app/ovo?tab=keywords`).
 */

const STATUS = ["tracking", "paused", "won", "lost"] as const
// INTENT now imported from the module so target + group + intent
// route stay in sync. Adds "comparison" to the target-allowed set
// (was previously rejected, while groups already accepted it).

const CreateSchema = z.object({
  keyword: z.string().min(2).max(200),
  keyword_group_id: z.string().nullable().optional(),
  url: z.string().url().max(2000).nullable().optional(),
  priority: z.number().int().min(1).max(5).optional(),
  notes: z.string().max(1000).nullable().optional(),
  target_country: z.string().min(2).max(2).optional(),
  language: z.string().min(2).max(8).optional(),
  tags: z.array(z.string().min(1).max(60)).max(20).nullable().optional(),
  target_position: z.number().int().min(1).max(100).nullable().optional(),
  search_volume_monthly: z.number().int().min(0).nullable().optional(),
  search_difficulty: z.number().int().min(0).max(100).nullable().optional(),
  status: z.enum(STATUS).optional(),
  is_active: z.boolean().optional(),
  search_intent: z.enum(INTENT_VALUES).optional(),
})

export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const ovo = req.scope.resolve(
    ONLINE_VISIBILITY_OPTIMIZATION_MODULE,
  ) as OvoService
  const q = req.query as Record<string, string | undefined>
  try {
    const filter: any = {}
    if (q.url) filter.url = q.url
    if (q.keyword) filter.keyword = q.keyword
    if (q.group_id !== undefined) {
      filter.group_id = q.group_id === "null" ? null : q.group_id
    }
    if (q.status && (STATUS as readonly string[]).includes(q.status)) {
      filter.status = q.status
    }
    if (q.tag) filter.tag = q.tag
    if (q.q) filter.q = q.q
    if (q.is_active !== undefined) {
      filter.is_active = q.is_active === "true"
    }
    if (q.limit) filter.limit = Math.min(Number(q.limit) || 500, 5000)
    if (q.offset) filter.offset = Math.max(Number(q.offset) || 0, 0)

    if (q.with_performance === "1" || q.with_performance === "true") {
      const rows = await ovo.listKeywordTargetsWithPerformance(filter)
      return res.json({ rows })
    }
    const rows = await ovo.listKeywordTargets(filter)
    res.json({ rows })
  } catch (err) {
    logger.error("ovo.seo.keyword-targets.GET failed", { error: err })
    res
      .status(500)
      .json({ message: (err as Error).message ?? "keyword_targets_load_failed" })
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
    const target = await ovo.upsertKeywordTarget(parsed.data as any)
    res.json({ target })
  } catch (err) {
    logger.error("ovo.seo.keyword-targets.POST failed", { error: err })
    const msg = (err as Error).message ?? "keyword_target_create_failed"
    // Normalisation failures map to 400 not 500
    const status = msg.startsWith("empty:") || msg.startsWith("too_long:")
      ? 400
      : 500
    res.status(status).json({ message: msg })
  }
}
