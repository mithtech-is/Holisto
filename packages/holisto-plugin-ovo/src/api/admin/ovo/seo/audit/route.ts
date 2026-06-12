import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { z } from "zod"
import {
  ONLINE_VISIBILITY_OPTIMIZATION_MODULE,
  OvoService,
} from "../../../../../modules/online_visibility_optimization"
import { logger } from "../../../../../utils/logger"

const PostBodySchema = z.object({
  limit: z.number().int().positive().max(2000).optional(),
})

/**
 * GET  /admin/ovo/seo/audit
 *   ?severity=error|warn|all   (default all)
 *   ?search=...                (substring match on url)
 *   ?limit=N                   (default 500, max 2000)
 *
 *   Returns the latest per-URL audit snapshot from `ovo_seo_audit`
 *   plus a `summary` block (total / healthy / warn / error /
 *   last_run_at). Powers the `/app/ovo?tab=audit` view.
 *
 * POST /admin/ovo/seo/audit
 *   { limit?: number }   optional first-N URLs cap for ad-hoc runs
 *
 *   Manually trigger the audit. Same code path as the nightly
 *   `seo-audit-nightly` cron. Walks the sitemap, fetches each URL,
 *   replaces audit rows. Returns the run summary.
 *
 * Run time: ~30s for ~150 URLs at 8-way concurrency. Stays well below
 * the typical 60s gateway timeout on the admin proxy.
 */
export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const ovo = req.scope.resolve(
    ONLINE_VISIBILITY_OPTIMIZATION_MODULE,
  ) as OvoService
  const q = req.query as Record<string, string | undefined>

  try {
    const severity =
      q.severity === "error" || q.severity === "warn" ? q.severity : "all"
    const [rows, summary] = await Promise.all([
      ovo.listSeoAudit({
        severity,
        search: q.search,
        limit: q.limit ? Math.max(1, Math.min(2000, Number(q.limit))) : 500,
      }),
      ovo.getSeoAuditSummary(),
    ])
    res.json({ rows, summary })
  } catch (err) {
    logger.error("ovo.seo.audit.GET failed", { error: err })
    res
      .status(500)
      .json({ message: (err as Error).message ?? "audit_load_failed" })
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
    const result = await ovo.runSeoAudit({
      limit:
        typeof parsed.data.limit === "number"
          ? Math.min(parsed.data.limit, 500)
          : undefined,
    })
    res.json(result)
  } catch (err) {
    logger.error("ovo.seo.audit.POST failed", { error: err })
    res
      .status(500)
      .json({ message: (err as Error).message ?? "audit_run_failed" })
  }
}
