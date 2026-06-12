import type { MedusaContainer } from "@medusajs/framework/types"
import { runOvoJob } from "../utils/ovo-job"

/**
 * Weekly AI-citation scan: asks every active prompt across the
 * configured providers (OpenAI / Anthropic / Perplexity / Gemini) and
 * stores the answers + extracted brand/competitor signals. No-op
 * (logged) when no provider key is configured or no active prompts
 * exist.
 */
export default async function ovoWeeklyAiCitations(container: MedusaContainer) {
  await runOvoJob(container, "ovo-weekly-ai-citations", async (ovo, logger) => {
    const creds = await ovo.getApiCredentials()
    const hasProvider =
      !!creds.openai_api_key ||
      !!creds.anthropic_api_key ||
      !!creds.perplexity_api_key ||
      !!creds.google_ai_api_key
    if (!hasProvider) {
      logger.info?.(
        "[ovo] ai-citations: add at least one AI provider key and active prompts to run a scan.",
      )
      return { skipped: "no_provider_configured" }
    }
    // Seeds example prompts only in demo mode; otherwise no-op.
    await ovo.seedDefaultAiPromptsIfEmpty()
    return await ovo.runAiCitationsForAll({ trigger: "cron" })
  })
}

export const config = {
  name: "ovo-weekly-ai-citations",
  // 05:00 every Monday
  schedule: "0 5 * * 1",
}
