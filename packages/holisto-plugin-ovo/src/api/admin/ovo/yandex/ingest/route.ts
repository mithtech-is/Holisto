import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import {
  ONLINE_VISIBILITY_OPTIMIZATION_MODULE,
  OvoService,
} from "../../../../../modules/online_visibility_optimization"
import { logger } from "../../../../../utils/logger"

/**
 * POST /admin/ovo/yandex/ingest
 *
 * Trigger an immediate Yandex Webmaster metric pull (~14 days of
 * impressions/clicks/CTR/avg-position + a point-in-time indexing
 * summary). Mirrors the daily 00:35 UTC cron — same writes, same
 * idempotent upserts.
 *
 * Returns `{ written: <row count> }`. A `0` return is the silent
 * "Yandex not configured" no-op (token missing, or auto-discovery
 * hasn't matched the site URL yet).
 */
export const POST = async (req: MedusaRequest, res: MedusaResponse) => {
  const ovo = req.scope.resolve(
    ONLINE_VISIBILITY_OPTIMIZATION_MODULE,
  ) as OvoService
  try {
    const out = await ovo.ingestYandexMetrics()
    res.json(out)
  } catch (err) {
    logger.error("ovo.yandex.ingest failed", { error: err })
    res
      .status(500)
      .json({ message: (err as Error).message ?? "yandex_ingest_failed" })
  }
}
