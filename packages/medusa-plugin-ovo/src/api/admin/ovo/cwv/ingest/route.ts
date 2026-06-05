import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import {
  ONLINE_VISIBILITY_OPTIMIZATION_MODULE,
  OvoService,
} from "../../../../../modules/online_visibility_optimization"
import { logger } from "../../../../../utils/logger"

/**
 * POST /admin/ovo/cwv/ingest
 *
 * Trigger an immediate Chrome UX Report pull. Mirrors the 4th step of
 * the 00:30 UTC `seo-daily-ingest` cron: queries the CrUX API once
 * per form factor (mobile, desktop, all) and upserts rows into
 * `ovo_seo_metric` with engine="crux".
 *
 * Returns `{ written: <row count> }`. `0` is the silent "no CrUX key"
 * or "origin has insufficient real-user data" no-op — Yandex-style
 * warmup is normal for low-traffic domains.
 */
export const POST = async (req: MedusaRequest, res: MedusaResponse) => {
  const ovo = req.scope.resolve(
    ONLINE_VISIBILITY_OPTIMIZATION_MODULE,
  ) as OvoService
  try {
    const out = await ovo.ingestCwvMetrics()
    res.json(out)
  } catch (err) {
    logger.error("ovo.cwv.ingest failed", { error: err })
    res
      .status(500)
      .json({ message: (err as Error).message ?? "cwv_ingest_failed" })
  }
}
