import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import {
  ONLINE_VISIBILITY_OPTIMIZATION_MODULE,
  OvoService,
} from "../../../../../modules/online_visibility_optimization"
import { logger } from "../../../../../utils/logger"

/**
 * GET /admin/ovo/ai/trend?prompt_id=...&window_weeks=12
 *
 * Per-prompt AI-citation time-series for the trend chart in the
 * AI-citations tab. Default window is 12 weeks (matches the
 * 90-day retention so the chart never has prune-induced gaps).
 *
 * Response shape: see `OvoService.getAiCitationTrend` — buckets
 * keyed by ISO Monday so a cron drift of a few hours doesn't
 * smear into adjacent buckets.
 */
export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const q = req.query as Record<string, string | undefined>
  const prompt_id = q.prompt_id
  if (!prompt_id) {
    return res.status(400).json({ message: "prompt_id required" })
  }
  const window_weeks = q.window_weeks ? Number(q.window_weeks) : 12

  const ovo = req.scope.resolve(
    ONLINE_VISIBILITY_OPTIMIZATION_MODULE,
  ) as OvoService
  try {
    const trend = await ovo.getAiCitationTrend({ prompt_id, window_weeks })
    res.json(trend)
  } catch (err) {
    logger.error("ovo.ai.trend failed", { error: err, prompt_id })
    res
      .status(500)
      .json({ message: (err as Error).message ?? "ai_trend_failed" })
  }
}
