import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { z } from "zod"
import {
  ONLINE_VISIBILITY_OPTIMIZATION_MODULE,
  OvoService,
} from "../../../../../../modules/online_visibility_optimization"
import { logger } from "../../../../../../utils/logger"

/**
 * POST /admin/ovo/seo/keyword-targets/bulk-import
 *
 *   Body: { rows: Array<{
 *     keyword: string,
 *     keyword_group_id?: string|null,
 *     url?: string|null,
 *     priority?: 1..5,
 *     notes?: string|null,
 *     target_country?: string,
 *     language?: string,
 *     tags?: string[],
 *     target_position?: number|null,
 *     status?: "tracking"|"paused"|"won"|"lost",
 *     is_active?: boolean,
 *     search_intent?: "informational"|"navigational"|"transactional"|"commercial"
 *   }> }
 *
 * Returns: { inserted, updated, errors: [{index, keyword, error}] }
 *
 * Each row goes through the service's `upsertKeywordTarget` so
 * normalisation + dedup + intent classification behave identically to
 * single-row creates. Errors are collected per-row rather than failing
 * the whole batch — the admin UI displays them in a preview before the
 * operator commits.
 *
 * Capped at `OvoService.KEYWORD_TARGET_BULK_IMPORT_CAP` (5000) to
 * prevent operator footguns. CSV → JSON conversion happens in the
 * admin client.
 */

const STATUS = ["tracking", "paused", "won", "lost"] as const
const INTENT = [
  "informational",
  "navigational",
  "transactional",
  "commercial",
] as const

const RowSchema = z.object({
  keyword: z.string().min(2).max(200),
  keyword_group_id: z.string().nullable().optional(),
  url: z.string().url().max(2000).nullable().optional(),
  priority: z.number().int().min(1).max(5).optional(),
  notes: z.string().max(1000).nullable().optional(),
  target_country: z.string().min(2).max(2).optional(),
  language: z.string().min(2).max(8).optional(),
  tags: z.array(z.string().min(1).max(60)).max(20).nullable().optional(),
  target_position: z.number().int().min(1).max(100).nullable().optional(),
  status: z.enum(STATUS).optional(),
  is_active: z.boolean().optional(),
  search_intent: z.enum(INTENT).optional(),
})

const BodySchema = z.object({
  rows: z.array(RowSchema).min(1).max(5000),
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
    const result = await ovo.bulkUpsertKeywordTargets(
      parsed.data.rows as any,
    )
    res.json(result)
  } catch (err) {
    logger.error("ovo.seo.keyword-targets.bulk-import failed", {
      error: err,
    })
    res
      .status(500)
      .json({ message: (err as Error).message ?? "bulk_import_failed" })
  }
}
