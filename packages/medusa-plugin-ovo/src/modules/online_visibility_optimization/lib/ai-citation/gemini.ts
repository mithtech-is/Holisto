import type { AiAnswer } from "./types"

/**
 * Google Gemini wrapper for Phase 4 AI-citation tracker.
 *
 * Model default: `gemini-2.0-flash-lite` — free tier (15 req/min,
 * 1500 req/day) which fits the ~30-prompt weekly cron easily.
 *
 * Key auth quirk: Google's REST endpoint takes the key as a query
 * parameter, not a header — common source of "401 invalid key"
 * confusion when adapting from other provider patterns.
 */
const GEMINI_BASE = "https://generativelanguage.googleapis.com/v1beta/models"
const DEFAULT_MODEL = "gemini-2.0-flash-lite"
const ANSWER_CAP = 8000
const TIMEOUT_MS = 30_000

export async function askGemini(
  apiKey: string,
  prompt: string,
  modelName: string = DEFAULT_MODEL,
): Promise<AiAnswer> {
  const t0 = Date.now()
  const url = `${GEMINI_BASE}/${encodeURIComponent(modelName)}:generateContent?key=${encodeURIComponent(apiKey)}`
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      generationConfig: {
        maxOutputTokens: 800,
        temperature: 0.2,
      },
    }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  })
  const latency = Date.now() - t0
  if (!res.ok) {
    throw new Error(`gemini_${res.status}: ${await safeText(res)}`)
  }
  const json = (await res.json()) as {
    candidates?: Array<{
      content?: { parts?: Array<{ text?: string }> }
    }>
    modelVersion?: string
    usageMetadata?: unknown
  }
  const parts = json.candidates?.[0]?.content?.parts ?? []
  const answer = parts
    .map((p) => (typeof p.text === "string" ? p.text : ""))
    .join("\n")
    .slice(0, ANSWER_CAP)
  return {
    provider: "gemini",
    model_name: json.modelVersion ?? modelName,
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
