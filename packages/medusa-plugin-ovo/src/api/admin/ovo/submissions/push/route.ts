import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { z } from "zod"
import {
  ONLINE_VISIBILITY_OPTIMIZATION_MODULE,
  OvoService,
} from "../../../../../modules/online_visibility_optimization"
import { logger } from "../../../../../utils/logger"

/**
 * POST /admin/ovo/submissions/push
 *
 * Manual "submit to discovery surface now" trigger. Wraps the
 * service-level push methods so the admin Submit tab can fire any of:
 *   - destination = "indexnow" → push every sitemap URL to Bing+Yandex
 *   - destination = "gsc"       → submit sitemap to Google
 *   - destination = "bing"      → submit sitemap to Bing
 *   - destination = "all"       → fan out to all three in parallel
 *
 * Optional `urls` array overrides the sitemap-enumerated list for
 * IndexNow (e.g. push a specific subset).
 *
 * Returns the structured SubmissionResult(s) inline so the UI can
 * toast the outcome without a follow-up GET.
 */

const PushSchema = z.object({
  destination: z.enum(["indexnow", "gsc", "bing", "all"]),
  urls: z.array(z.string()).optional(),
})

export const POST = async (req: MedusaRequest, res: MedusaResponse) => {
  const parsed = PushSchema.safeParse(req.body)
  if (!parsed.success) {
    return res
      .status(400)
      .json({ message: "Invalid input", errors: parsed.error.flatten() })
  }

  const ovo = req.scope.resolve(
    ONLINE_VISIBILITY_OPTIMIZATION_MODULE,
  ) as OvoService

  const adminUserId =
    (req as any).auth_context?.actor_id ??
    (req as any).auth_context?.app_metadata?.user_id ??
    null

  try {
    if (parsed.data.destination === "indexnow") {
      const result = await ovo.pushToIndexNow(parsed.data.urls ?? null, {
        triggered_by_user_id: adminUserId,
      })
      return res.json({ results: [result] })
    }
    if (parsed.data.destination === "gsc") {
      const result = await ovo.pushSitemapToGsc({
        triggered_by_user_id: adminUserId,
      })
      return res.json({ results: [result] })
    }
    if (parsed.data.destination === "bing") {
      const result = await ovo.pushSitemapToBing({
        triggered_by_user_id: adminUserId,
      })
      return res.json({ results: [result] })
    }
    // "all"
    const results = await ovo.pushToAll({
      triggered_by_user_id: adminUserId,
    })
    return res.json({ results })
  } catch (err) {
    logger.error("ovo.submissions.push failed", { error: err })
    return res
      .status(500)
      .json({ message: (err as Error).message ?? "submit_failed" })
  }
}
