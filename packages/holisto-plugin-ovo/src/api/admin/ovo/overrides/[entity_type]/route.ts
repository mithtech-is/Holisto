import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import {
  ONLINE_VISIBILITY_OPTIMIZATION_MODULE,
  OvoService,
  OVO_ENTITY_TYPES,
  type OvoEntityType,
} from "../../../../../modules/online_visibility_optimization"
import { logger } from "../../../../../utils/logger"

/**
 * GET /admin/ovo/overrides/:entity_type
 *
 * Lists every override row of a given type. Used by the OVO admin
 * "Page overrides" tab to display all path-keyed overrides
 * (entity_type=page); also useful for ops audits ("which products
 * have an OVO override?").
 *
 * Returns at most 500 rows (no pagination — typical sites have far
 * fewer overrides than products).
 */
export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const ovo = req.scope.resolve(
    ONLINE_VISIBILITY_OPTIMIZATION_MODULE,
  ) as OvoService

  const t = (req.params as any).entity_type as string
  if (!(OVO_ENTITY_TYPES as readonly string[]).includes(t)) {
    return res.status(400).json({ message: "invalid entity_type" })
  }
  const entity_type = t as OvoEntityType

  try {
    const rows = await ovo.listOverridesOfType(entity_type)
    // Returns BOTH keys for back-compat: existing PagesTab reads
    // `overrides`; new code should read `rows` (matches every other
    // list endpoint). Drop the legacy key in a future cleanup pass
    // once PagesTab is updated.
    res.json({ rows, overrides: rows })
  } catch (err) {
    logger.error("ovo.listOverridesOfType failed", {
      error: err,
      entity_type,
    })
    res
      .status(500)
      .json({ message: (err as Error).message ?? "override_list_failed" })
  }
}
