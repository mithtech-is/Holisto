import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { z } from "zod"
import {
  ONLINE_VISIBILITY_OPTIMIZATION_MODULE,
  OvoService,
} from "../../../../../modules/online_visibility_optimization"
import { logger } from "../../../../../utils/logger"

/**
 * POST /admin/ovo/yandex/sitemap
 * Body: { feedUrl?: string }   (defaults to <SITE_URL>/sitemap.xml)
 *
 * Register a sitemap URL with Yandex Webmaster. Idempotent: Yandex
 * 409 (already-registered) is treated as success. Persists a row in
 * `ovo_submission_log` with `destination="yandex"` so the Submit-tab
 * UI can show it alongside GSC + Bing submissions.
 */
const BodySchema = z.object({
  feedUrl: z.string().url().optional(),
})

export const POST = async (req: MedusaRequest, res: MedusaResponse) => {
  const parsed = BodySchema.safeParse(req.body ?? {})
  if (!parsed.success) {
    return res
      .status(400)
      .json({ message: "Invalid input", errors: parsed.error.flatten() })
  }
  const ovo = req.scope.resolve(
    ONLINE_VISIBILITY_OPTIMIZATION_MODULE,
  ) as OvoService
  const adminUserId =
    (req as unknown as { auth_context?: { actor_id?: string } }).auth_context
      ?.actor_id ?? null
  try {
    const result = await ovo.pushSitemapToYandex({
      ...(parsed.data.feedUrl ? { feedUrl: parsed.data.feedUrl } : {}),
      triggered_by_user_id: adminUserId,
    })
    res.json(result)
  } catch (err) {
    logger.error("ovo.yandex.sitemap failed", { error: err })
    res
      .status(500)
      .json({ message: (err as Error).message ?? "yandex_sitemap_failed" })
  }
}
