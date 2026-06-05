import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import {
  ONLINE_VISIBILITY_OPTIMIZATION_MODULE,
  OvoService,
} from "../../../../../modules/online_visibility_optimization"

/**
 * GET /admin/ovo/submissions/status
 *
 * Reports which discovery surfaces are wired up (i.e. their env vars
 * are set). Lets the admin Submit tab show "GSC: not configured —
 * set GOOGLE_GSC_SERVICE_ACCOUNT_JSON" hints without firing a probe
 * request.
 */
export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const ovo = req.scope.resolve(
    ONLINE_VISIBILITY_OPTIMIZATION_MODULE,
  ) as OvoService
  return res.json(await ovo.getSubmissionStatus())
}
