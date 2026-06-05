import type { AiAnswer } from "./types"

/**
 * OpenAI Chat Completions wrapper for Phase 4 AI-citation tracker.
 *
 * Model default: `gpt-4o-mini` — the cheapest GA model with adequate
 * factual recall for "best place to buy X in India" style prompts.
 * Pricing (Dec 2025): $0.00015 / 1k input, $0.00060 / 1k output.
 * At ~200 token answers × 30 prompts × weekly = ~$0.01/week.
 *
 * Throws on any non-success response so the caller can persist an
 * empty / error citation row rather than silently dropping the prompt.
 */
const OPENAI_URL = "https://api.openai.com/v1/chat/completions"
const DEFAULT_MODEL = "gpt-4o-mini"
const ANSWER_CAP = 8000
const TIMEOUT_MS = 30_000

export async function askOpenAI(
  apiKey: string,
  prompt: string,
  modelName: string = DEFAULT_MODEL,
): Promise<AiAnswer> {
  const t0 = Date.now()
  const res = await fetch(OPENAI_URL, {
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
    throw new Error(`openai_${res.status}: ${await safeText(res)}`)
  }
  const json = (await res.json()) as {
    choices?: Array<{ message?: { content?: string } }>
    model?: string
    usage?: unknown
  }
  const answer = json.choices?.[0]?.message?.content?.slice(0, ANSWER_CAP) ?? ""
  return {
    provider: "openai",
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
