import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { z } from "zod"
import {
  ONLINE_VISIBILITY_OPTIMIZATION_MODULE,
  OvoService,
} from "../../../../../modules/online_visibility_optimization"
import { logger } from "../../../../../utils/logger"

const PostBodySchema = z.object({
  url: z
    .string()
    .min(1)
    .max(2048)
    .url("url must be a valid absolute URL")
    .optional(),
})

/**
 * GET  /admin/ovo/seo/url-index
 *      Returns the latest inspection per URL + a coverage summary.
 *
 * POST /admin/ovo/seo/url-index
 *      Body: { url?: string }
 *      - If url is provided, inspect just that URL ("Inspect now").
 *      - Otherwise, walk the whole sitemap (same as the daily cron).
 *
 * Powers the Indexability admin tab.
 */
export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const ovo = req.scope.resolve(
    ONLINE_VISIBILITY_OPTIMIZATION_MODULE,
  ) as OvoService
  try {
    const result = await ovo.listUrlIndexLatest()
    res.json(result)
  } catch (err) {
    logger.error("ovo.seo.url-index.GET failed", { error: err })
    res
      .status(500)
      .json({ message: (err as Error).message ?? "url_index_load_failed" })
  }
}

export const POST = async (req: MedusaRequest, res: MedusaResponse) => {
  const parsed = PostBodySchema.safeParse(req.body ?? {})
  if (!parsed.success) {
    return res
      .status(400)
      .json({ message: "Invalid input", errors: parsed.error.flatten() })
  }
  const ovo = req.scope.resolve(
    ONLINE_VISIBILITY_OPTIMIZATION_MODULE,
  ) as OvoService
  try {
    if (parsed.data.url) {
      const candidate = new URL(parsed.data.url)
      const siteUrl =
        process.env.OVO_SITE_URL ||
        process.env.NEXT_PUBLIC_SITE_URL ||
        process.env.STOREFRONT_URL ||
        ""
      let allowedHost: string | null = null
      try {
        allowedHost = siteUrl ? new URL(siteUrl).hostname : null
      } catch {
        allowedHost = null
      }
      if (!allowedHost) {
        return res.status(400).json({
          message:
            "Configure OVO_SITE_URL (your storefront URL) before inspecting a specific URL.",
        })
      }
      if (candidate.hostname !== allowedHost) {
        return res
          .status(400)
          .json({ message: `url must be on ${allowedHost}` })
      }
      const r = await ovo.inspectOneUrlIndex(parsed.data.url)
      return res.json(r)
    }
    const r = await ovo.runUrlIndexInspection()
    res.json(r)
  } catch (err) {
    logger.error("ovo.seo.url-index.POST failed", { error: err })
    res
      .status(500)
      .json({ message: (err as Error).message ?? "url_index_run_failed" })
  }
}
