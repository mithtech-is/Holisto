import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { z } from "zod"
import {
  ONLINE_VISIBILITY_OPTIMIZATION_MODULE,
  OvoService,
} from "../../../../../../modules/online_visibility_optimization"
import { logger } from "../../../../../../utils/logger"

const BodySchema = z.object({
  url: z
    .string()
    .min(1)
    .max(2048)
    .url("url must be a valid absolute URL"),
})

/**
 * POST /admin/ovo/seo/audit/url
 *   { url: "https://your-domain.example/some-page" }
 *
 * Re-audit a single URL without rewalking the whole sitemap. Used by
 * the "Re-audit" button on each row of the Audit tab so an operator
 * can verify their fix without waiting for the next nightly cron.
 *
 * The supplied URL is matched verbatim against the row in
 * `ovo_seo_audit`. Pass the exact URL from the audit row (including
 * query string) — the auditor doesn't normalise the input.
 */
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

  // Soft hostname guard: only allow audits against the configured
  // storefront. Prevents the endpoint becoming a generic SSRF probe.
  // The allowed host is derived from the operator's configured site URL
  // (no hardcoded host); when unset we return an honest setup-required.
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
        "Configure OVO_SITE_URL (your storefront URL) before auditing a specific URL.",
    })
  }
  if (candidate.hostname !== allowedHost) {
    return res
      .status(400)
      .json({ message: `url must be on ${allowedHost}` })
  }

  try {
    const result = await ovo.runSeoAuditForUrl(parsed.data.url)
    res.json(result)
  } catch (err) {
    logger.error("ovo.seo.audit.url failed", { error: err })
    res
      .status(500)
      .json({ message: (err as Error).message ?? "audit_url_failed" })
  }
}
