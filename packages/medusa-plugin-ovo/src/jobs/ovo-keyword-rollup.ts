import type { MedusaContainer } from "@medusajs/framework/types"
import { runOvoJob } from "../utils/ovo-job"

/**
 * Daily keyword-performance roll-up. Snapshots each active keyword
 * target's rank/clicks/impressions/CTR from the stored GSC query
 * history for the day. Self-skips (returns zero) when there are no
 * keyword targets or no query history yet.
 */
export default async function ovoKeywordRollup(container: MedusaContainer) {
  await runOvoJob(container, "ovo-keyword-rollup", async (ovo) => {
    // Roll up "yesterday" (UTC) — GSC data lands with a ~2-3 day lag,
    // but rolling up the most recent fully-elapsed day keeps the
    // snapshot series dense; late-arriving rows are upserted.
    const d = new Date()
    d.setUTCDate(d.getUTCDate() - 1)
    return await ovo.rollupKeywordPerformance(d)
  })
}

export const config = {
  name: "ovo-keyword-rollup",
  // 01:00 every day
  schedule: "0 1 * * *",
}
