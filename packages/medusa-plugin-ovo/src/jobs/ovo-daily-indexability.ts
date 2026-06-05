import type { MedusaContainer } from "@medusajs/framework/types"
import { runOvoJob } from "../utils/ovo-job"
import { getNumberOption } from "../modules/online_visibility_optimization/lib/options"

/**
 * Daily URL indexability check via the GSC URL Inspection API. No-op
 * (logged) when GSC credentials aren't configured.
 */
export default async function ovoDailyIndexability(container: MedusaContainer) {
  await runOvoJob(container, "ovo-daily-indexability", async (ovo, logger) => {
    const creds = await ovo.getApiCredentials()
    if (!creds.gsc_service_account_json) {
      logger.info?.(
        "[ovo] indexability: Google Search Console URL Inspection access is required — connect GSC first.",
      )
      return { skipped: "gsc_not_configured" }
    }
    const limit = getNumberOption(
      "max_inspection_urls",
      "OVO_MAX_INSPECTION_URLS",
      200,
    )
    return await ovo.runUrlIndexInspection({ limit })
  })
}

export const config = {
  name: "ovo-daily-indexability",
  // 04:30 every day
  schedule: "30 4 * * *",
}
