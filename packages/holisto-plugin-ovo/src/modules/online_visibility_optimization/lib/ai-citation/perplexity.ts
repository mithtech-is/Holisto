import type { AiAnswer } from "./types"

/**
 * Perplexity API wrapper for Phase 4 AI-citation tracker.
 *
 * Why Perplexity matters even though we already query OpenAI/Anthropic:
 * Perplexity is the only major answer engine that *cites* its sources
 * inline. Its `citations` array tells us exactly which URLs the model
 * grounded its answer in — strongest signal that AI search engines
 * are indexing your domain.
 *
 * Model default: `sonar` (online, fact-grounded, $0.005 / 1k tokens).
 * Cheaper than `sonar-pro` and adequate for brand-discovery questions.
 *
 * The citations array (when present) is preserved in `raw` for the
 * admin tab's drill-down view.
 */
const PERPLEXITY_URL = "https://api.perplexity.ai/chat/completions"
const DEFAULT_MODEL = "sonar"
const ANSWER_CAP = 8000
const TIMEOUT_MS = 30_000

export async function askPerplexity(
  apiKey: string,
  prompt: string,
  modelName: string = DEFAULT_MODEL,
): Promise<AiAnswer> {
  const t0 = Date.now()
  const res = await fetch(PERPLEXITY_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: modelName,
      messages: [{ role: "user", content: prompt }],
      max_tokens: 800,
      temperature: 0.2,
    }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  })
  const latency = Date.now() - t0
  if (!res.ok) {
    throw new Error(`perplexity_${res.status}: ${await safeText(res)}`)
  }
  const json = (await res.json()) as {
    choices?: Array<{ message?: { content?: string } }>
    model?: string
    citations?: string[]
    usage?: unknown
  }
  const answer = json.choices?.[0]?.message?.content?.slice(0, ANSWER_CAP) ?? ""
  return {
    provider: "perplexity",
    model_name: json.model ?? modelName,
    answer,
    latency_ms: latency,
    raw: json,
  }
}

async function safeText(res: Response): Promise<string> {
  try {
    return (await res.text()).slice(0, 500)
  } catch {
    return `http_${res.status}`
  }
}
