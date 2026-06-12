import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import {
  ONLINE_VISIBILITY_OPTIMIZATION_MODULE,
  OvoService,
} from "../../../../../modules/online_visibility_optimization"
import { logger } from "../../../../../utils/logger"

/**
 * POST /admin/ovo/yandex/discover
 *
 * Re-run Yandex `user_id` + `host_id` auto-discovery for the
 * currently-saved OAuth token and persist the result on the
 * OvoSetting row. Useful when:
 *   - the operator pasted the token via env var (auto-discovery
 *     doesn't run on env-only configs by default)
 *   - the operator verified a new site variant on webmaster.yandex.com
 *     (e.g. added `https://your-domain.example/` after `http://`)
 *   - a previously-discovered host_id got stale
 *
 * Returns `{ user_id, host_id }` — both may be null when the token
 * has no verified sites matching `NEXT_PUBLIC_SITE_URL`.
 */
export const POST = async (req: MedusaRequest, res: MedusaResponse) => {
  const ovo = req.scope.resolve(
    ONLINE_VISIBILITY_OPTIMIZATION_MODULE,
  ) as OvoService
  try {
    const out = await ovo.discoverAndCacheYandexIds()
    res.json(out)
  } catch (err) {
    logger.error("ovo.yandex.discover failed", { error: err })
    res
      .status(500)
      .json({ message: (err as Error).message ?? "yandex_discover_failed" })
  }
}
