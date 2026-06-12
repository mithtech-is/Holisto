import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import {
  ONLINE_VISIBILITY_OPTIMIZATION_MODULE,
  OvoService,
} from "../../../../../modules/online_visibility_optimization"
import { logger } from "../../../../../utils/logger"

/**
 * GET /admin/ovo/ai/citations
 *   ?prompt_id=...                       optional
 *   ?provider=openai|anthropic|perplexity|gemini   optional
 *   ?since=ISO8601                       optional (default 30 days back)
 *   ?limit=N                             default 500, max 5000
 *
 * Reads `ovo_ai_citation` with descending captured-at order. Admin
 * tab uses this for the per-(prompt, provider) latest matrix +
 * drill-down view.
 */
const VALID_PROVIDERS = new Set([
  "openai",
  "anthropic",
  "perplexity",
  "gemini",
])

export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const ovo = req.scope.resolve(
    ONLINE_VISIBILITY_OPTIMIZATION_MODULE,
  ) as OvoService
  const q = req.query as Record<string, string | undefined>

  const provider =
    q.provider && VALID_PROVIDERS.has(q.provider)
      ? (q.provider as "openai" | "anthropic" | "perplexity" | "gemini")
      : undefined
  const since = q.since ? new Date(q.since) : undefined
  try {
    const rows = await ovo.listAiCitations({
      prompt_id: q.prompt_id,
      provider,
      since,
      limit: q.limit ? Math.max(1, Math.min(5000, Number(q.limit))) : 500,
    })
    res.json({ rows })
  } catch (err) {
    logger.error("ovo.ai.citations failed", { error: err })
    res
      .status(500)
      .json({ message: (err as Error).message ?? "citations_load_failed" })
  }
}
