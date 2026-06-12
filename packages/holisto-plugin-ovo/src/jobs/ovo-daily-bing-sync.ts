import type { MedusaContainer } from "@medusajs/framework/types"
import { runOvoJob } from "../utils/ovo-job"

/**
 * Daily Bing Webmaster sync: weekly query stats + daily crawl stats.
 * No-op (logged) when no Bing Webmaster API key is configured.
 */
export default async function ovoDailyBingSync(container: MedusaContainer) {
  await runOvoJob(container, "ovo-daily-bing-sync", async (ovo, logger) => {
    const creds = await ovo.getApiCredentials()
    if (!creds.bing_api_key) {
      logger.info?.(
        "[ovo] bing-sync: no Bing Webmaster API key configured — add one to sync Bing metrics.",
      )
      return { skipped: "bing_not_configured" }
    }
    return await ovo.ingestBingMetrics()
  })
}

export const config = {
  name: "ovo-daily-bing-sync",
  // 04:00 every day
  schedule: "0 4 * * *",
}
