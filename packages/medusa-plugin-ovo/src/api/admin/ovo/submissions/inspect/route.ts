import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { z } from "zod"
import {
  ONLINE_VISIBILITY_OPTIMIZATION_MODULE,
  OvoService,
} from "../../../../../modules/online_visibility_optimization"
import { logger } from "../../../../../utils/logger"

/**
 * POST /admin/ovo/submissions/inspect
 *
 * Calls the GSC URL Inspection API for a single URL. Used by the
 * Submit tab's "is this URL indexed?" spot-check. Returns the
 * `coverageState` (e.g. "Submitted and indexed", "Crawled - currently
 * not indexed", "URL is unknown to Google") alongside the standard
 * SubmissionResult.
 */

const InspectSchema = z.object({
  url: z.string().url(),
})

export const POST = async (req: MedusaRequest, res: MedusaResponse) => {
  const parsed = InspectSchema.safeParse(req.body)
  if (!parsed.success) {
    return res
      .status(400)
      .json({ message: "Invalid input", errors: parsed.error.flatten() })
  }

  const ovo = req.scope.resolve(
    ONLINE_VISIBILITY_OPTIMIZATION_MODULE,
  ) as OvoService

  const adminUserId =
    (req as any).auth_context?.actor_id ??
    (req as any).auth_context?.app_metadata?.user_id ??
    null

  try {
    const result = await ovo.inspectGscUrl(parsed.data.url, {
      triggered_by_user_id: adminUserId,
    })
    return res.json({ result })
  } catch (err) {
    logger.error("ovo.submissions.inspect failed", { error: err })
    return res
      .status(500)
      .json({ message: (err as Error).message ?? "inspect_failed" })
  }
}
