import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { z } from "zod"
import {
  ONLINE_VISIBILITY_OPTIMIZATION_MODULE,
  OvoService,
} from "../../../../../../modules/online_visibility_optimization"
import { logger } from "../../../../../../utils/logger"

/**
 * POST /admin/ovo/seo/image-alt/suggest
 * Body: { url: string, limit?: number }
 *
 * Calls Gemini Vision on every missing-alt `<img>` on the given URL
 * and returns suggested alt-text strings. Stateless — nothing is
 * persisted; admin copies the suggestions into the page source
 * themselves.
 *
 * Hostname guard: only URLs on the configured storefront hostname
 * are accepted so this can't be turned into an open-proxy to fetch
 * arbitrary pages on the public internet (and then call Gemini on
 * arbitrary images, which would burn the API quota).
 */
const BodySchema = z.object({
  url: z.string().url().max(2000),
  limit: z.number().int().min(1).max(24).optional(),
})

const ALLOWED_HOSTNAMES = (() => {
  const set = new Set<string>()
  // Derive the allowed host from the configured site URL (no hardcoded
  // host). Operators can add more hosts via OVO_ALT_SUGGEST_HOSTS.
  const site =
    process.env.OVO_SITE_URL ||
    process.env.NEXT_PUBLIC_SITE_URL ||
    process.env.STOREFRONT_URL ||
    ""
  if (site) {
    try {
      const h = new URL(site).hostname.toLowerCase()
      const bare = h.replace(/^www\./, "")
      set.add(bare)
      set.add(`www.${bare}`)
    } catch {
      /* ignore malformed site URL */
    }
  }
  const env = process.env.OVO_ALT_SUGGEST_HOSTS
  if (env) {
    for (const h of env.split(",")) {
      const t = h.trim().toLowerCase()
      if (t) set.add(t)
    }
  }
  if (process.env.NODE_ENV !== "production") {
    set.add("localhost")
    set.add("127.0.0.1")
  }
  return set
})()

export const POST = async (req: MedusaRequest, res: MedusaResponse) => {
  const parsed = BodySchema.safeParse(req.body)
  if (!parsed.success) {
    return res
      .status(400)
      .json({ message: "Invalid input", errors: parsed.error.flatten() })
  }

  let host: string
  try {
    host = new URL(parsed.data.url).hostname.toLowerCase()
  } catch {
    return res.status(400).json({ message: "url must parse as a valid URL" })
  }
  if (!ALLOWED_HOSTNAMES.has(host)) {
    return res.status(400).json({
      message: `Hostname not allowed: ${host}. Allowed: ${Array.from(ALLOWED_HOSTNAMES).join(", ")}`,
    })
  }

  const ovo = req.scope.resolve(
    ONLINE_VISIBILITY_OPTIMIZATION_MODULE,
  ) as OvoService
  try {
    const out = await ovo.suggestImageAltsForPage({
      url: parsed.data.url,
      limit: parsed.data.limit,
    })
    res.json(out)
  } catch (err) {
    logger.error("ovo.seo.image-alt.suggest failed", {
      error: err,
      url: parsed.data.url,
    })
    res
      .status(500)
      .json({ message: (err as Error).message ?? "image_alt_suggest_failed" })
  }
}
