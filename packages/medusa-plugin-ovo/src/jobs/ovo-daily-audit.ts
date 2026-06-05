import type { MedusaContainer } from "@medusajs/framework/types"
import { runOvoJob } from "../utils/ovo-job"
import { getNumberOption } from "../modules/online_visibility_optimization/lib/options"

/**
 * Daily on-site SEO audit. Crawls the configured sitemap/site URL and
 * stores a run with per-URL findings. No-op (logged) when no site URL
 * is configured (OVO_SITE_URL) — the auditor has nothing to crawl.
 */
export default async function ovoDailyAudit(container: MedusaContainer) {
  await runOvoJob(container, "ovo-daily-audit", async (ovo, logger) => {
    const siteUrl =
      process.env.OVO_SITE_URL ||
      process.env.NEXT_PUBLIC_SITE_URL ||
      process.env.STOREFRONT_URL ||
      ""
    if (!siteUrl) {
      logger.info?.(
        "[ovo] audit: no site URL configured — set OVO_SITE_URL (or add a sitemap) to enable audits.",
      )
      return { skipped: "site_url_not_configured" }
    }
    const limit = getNumberOption("max_audit_urls", "OVO_MAX_AUDIT_URLS", 500)
    return await ovo.runSeoAudit({ trigger: "cron", limit })
  })
}

export const config = {
  name: "ovo-daily-audit",
  // 02:00 every day
  schedule: "0 2 * * *",
}
