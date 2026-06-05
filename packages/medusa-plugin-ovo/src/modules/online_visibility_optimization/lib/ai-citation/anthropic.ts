import type { AiAnswer } from "./types"

/**
 * Anthropic Messages API wrapper for Phase 4 AI-citation tracker.
 *
 * Model default: `claude-haiku-4-5` — cheapest Haiku tier with strong
 * factual recall. Pricing (Dec 2025): $0.0010 / 1k input, $0.005 / 1k
 * output. At ~200 token answers × 30 prompts × weekly ≈ $0.05/week.
 */
const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages"
const DEFAULT_MODEL = "claude-haiku-4-5"
const ANSWER_CAP = 8000
const TIMEOUT_MS = 30_000

export async function askAnthropic(
  apiKey: string,
  prompt: string,
  modelName: string = DEFAULT_MODEL,
): Promise<AiAnswer> {
  const t0 = Date.now()
  const res = await fetch(ANTHROPIC_URL, {
    method: "POST",
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: modelName,
      max_tokens: 800,
      temperature: 0.2,
      messages: [{ role: "user", content: prompt }],
    }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  })
  const latency = Date.now() - t0
  if (!res.ok) {
    throw new Error(`anthropic_${res.status}: ${await safeText(res)}`)
  }
  const json = (await res.json()) as {
    content?: Array<{ type?: string; text?: string }>
    model?: string
    usage?: unknown
  }
  const textBlocks = (json.content ?? [])
    .filter((b) => b.type === "text" && typeof b.text === "string")
    .map((b) => b.text as string)
    .join("\n")
  return {
    provider: "anthropic",
    model_name: json.model ?? modelName,
    answer: textBlocks.slice(0, ANSWER_CAP),
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
