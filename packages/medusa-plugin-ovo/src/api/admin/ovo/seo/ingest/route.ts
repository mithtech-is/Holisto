import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { z } from "zod"
import {
  ONLINE_VISIBILITY_OPTIMIZATION_MODULE,
  OvoService,
} from "../../../../../modules/online_visibility_optimization"
import { logger } from "../../../../../utils/logger"

/**
 * POST /admin/ovo/seo/ingest
 *   { engine: "gsc" | "bing" | "yandex" | "crux" | "all" }
 *
 * Manually fire the daily ingest for one (or all) engines. Same code
 * path as the nightly cron; useful for first-time setup ("we just
 * pasted the GSC service account, prove it works") and ad-hoc
 * back-fill ("we had a 2-day outage, repull GSC").
 *
 * Returns the per-engine write counts. Soft-fails when the engine's
 * env vars aren't set — the response shows `written: 0` and the
 * admin UI surfaces a "Not configured" hint based on the destinations
 * status endpoint.
 *
 * Previously this route only knew about GSC + Bing. The nightly cron
 * also ingests Yandex + CrUX; without those branches here ops had to
 * SSH in to back-fill Yandex/CrUX after fixing a token.
 */
const BodySchema = z.object({
  engine: z
    .enum(["gsc", "bing", "yandex", "crux", "all"])
    .optional()
    .default("all"),
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

  const engine = parsed.data.engine

  const out: Record<string, unknown> = {}
  try {
    if (engine === "gsc" || engine === "all") {
      // Site-level daily metrics → ovo_seo_metric
      out.gsc = await ovo.ingestGscDailyMetrics()
      // Dimension rollups → ovo_seo_dimension_rollup
      // (one GSC API call per dimension; failures are swallowed inside
      // so a flaky `page` dimension doesn't block `query`)
      out.gsc_dimensions = await ovo.ingestAllGscDimensionRollups()
      // Per-query daily history → ovo_seo_query_history
      out.gsc_query_history = await ovo.ingestGscQueryHistory()
    }
    if (engine === "bing" || engine === "all") {
      out.bing = await ovo.ingestBingMetrics()
    }
    if (engine === "yandex" || engine === "all") {
      // Soft-fails internally when oauth token isn't configured.
      out.yandex = await ovo.ingestYandexMetrics()
      try {
        out.yandex_queries = await ovo.ingestYandexQueryRollup()
      } catch (err) {
        // Query rollup failure shouldn't fail the whole call.
        out.yandex_queries = {
          error: (err as Error).message ?? "yandex_query_failed",
        }
      }
    }
    if (engine === "crux" || engine === "all") {
      // CrUX is anonymous public API, no creds — runs unless CRUX_API_KEY
      // is missing (the service handles that case).
      out.crux = await ovo.ingestCwvMetrics()
    }
    res.json(out)
  } catch (err) {
    logger.error("ovo.seo.ingest failed", { error: err })
    res
      .status(500)
      .json({ message: (err as Error).message ?? "ingest_failed" })
  }
}
