import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { z } from "zod"
import {
  ONLINE_VISIBILITY_OPTIMIZATION_MODULE,
  OvoService,
} from "../../../../../../modules/online_visibility_optimization"
import { logger } from "../../../../../../utils/logger"
import {
  normalizeKeyword,
  KeywordNormalisationError,
} from "../../../../../../modules/online_visibility_optimization/lib/keyword-normalizer"
import { classifyIntent } from "../../../../../../modules/online_visibility_optimization/lib/intent-classifier"
import { INTENT_VALUES } from "../../../../../../modules/online_visibility_optimization/lib/intent"

/**
 * PATCH  /admin/ovo/seo/keyword-targets/:id    — partial edit
 * DELETE /admin/ovo/seo/keyword-targets/:id    — soft-delete
 *
 * Phase 1: accepts the widened field set. When `keyword` changes we
 * also recompute `normalized_keyword` + `search_intent` in the same
 * write so the natural-key index stays consistent. Operators can
 * still override `search_intent` explicitly to override the
 * classifier.
 */

const STATUS = ["tracking", "paused", "won", "lost"] as const
// INTENT imported from the module — see lib/intent.ts. Adds
// "comparison" to the allowed set on PATCH (was previously
// rejected while groups already accepted it).

const UpdateSchema = z.object({
  url: z.string().url().max(2000).nullable().optional(),
  keyword: z.string().min(2).max(200).optional(),
  priority: z.number().int().min(1).max(5).optional(),
  notes: z.string().max(1000).nullable().optional(),
  keyword_group_id: z.string().nullable().optional(),
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
    const data: Record<string, unknown> = { ...parsed.data }

    // If keyword changes, recompute its derived columns in the same
    // write so the unique index on (normalized_keyword, country,
    // language) stays consistent. Explicit search_intent in the
    // patch still wins over the re-classification.
    if (parsed.data.keyword !== undefined) {
      try {
        data.normalized_keyword = normalizeKeyword(parsed.data.keyword)
      } catch (err) {
        if (err instanceof KeywordNormalisationError) {
          return res.status(400).json({ message: `${err.code}: ${err.message}` })
        }
        throw err
      }
      if (parsed.data.search_intent === undefined) {
        data.search_intent = classifyIntent(parsed.data.keyword).intent
      }
    }

    if (parsed.data.target_country !== undefined) {
      data.target_country = parsed.data.target_country.toUpperCase()
    }
    if (parsed.data.language !== undefined) {
      data.language = parsed.data.language.toLowerCase()
    }

    await (ovo as any).updateOvoSeoKeywordTargets({
      selector: { id },
      data,
    })
    const [row] = await (ovo as any).listOvoSeoKeywordTargets(
      { id },
      { take: 1 },
    )
    res.json({ target: row })
  } catch (err) {
    logger.error("ovo.seo.keyword-targets.PATCH failed", { error: err })
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
    await (ovo as any).deleteOvoSeoKeywordTargets([id])
    res.json({ deleted: id })
  } catch (err) {
    logger.error("ovo.seo.keyword-targets.DELETE failed", { error: err })
    res
      .status(500)
      .json({ message: (err as Error).message ?? "delete_failed" })
  }
}
