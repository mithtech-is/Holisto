import type { MedusaContainer } from "@medusajs/framework/types"
import { runOvoJob } from "../utils/ovo-job"

/**
 * Daily Google Search Console sync: pulls daily Search-Analytics rows,
 * dimension roll-ups, and per-query history. No-op (logged) when GSC
 * credentials aren't configured.
 */
export default async function ovoDailyGscSync(container: MedusaContainer) {
  await runOvoJob(container, "ovo-daily-gsc-sync", async (ovo, logger) => {
    const creds = await ovo.getApiCredentials()
    if (!creds.gsc_service_account_json) {
      logger.info?.(
        "[ovo] gsc-sync: no GSC service-account configured — connect Google Search Console to sync metrics.",
      )
      return { skipped: "gsc_not_configured" }
    }
    const daily = await ovo.ingestGscDailyMetrics({ daysBack: 30 })
    const dims = await ovo.ingestAllGscDimensionRollups(28)
    const history = await ovo.ingestGscQueryHistory(30)
    return { daily, dims, history }
  })
}

export const config = {
  name: "ovo-daily-gsc-sync",
  // 03:00 every day
  schedule: "0 3 * * *",
}
