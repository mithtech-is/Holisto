/**
 * Provider-dispatched AI call for CONTENT GENERATION.
 *
 * Distinct from `lib/ai-citation/{openai,anthropic,perplexity,gemini}.ts`
 * (citation tracker) because content generation needs:
 *
 *   - system_prompt (in addition to user_prompt)
 *   - controllable max_tokens + temperature (not baked-in 800 / 0.2)
 *   - response_format = json_schema for structured output (OpenAI)
 *   - usage object for token accounting (cost tracking)
 *
 * Reads keys via the caller's `apiKey` parameter — the OvoService
 * method `callAiForContentGeneration` resolves credentials from
 * `getApiCredentials()` before invoking.
 *
 * Each provider's response is normalised to a common shape:
 *   { text, tokens_in, tokens_out, model, latency_ms, raw }
 *
 * Token counts are best-effort (different providers report slightly
 * differently). When unknown, returns 0 — caller falls back to
 * character-count estimation.
 */

const TIMEOUT_MS = 90_000

export type CallOpts = {
    apiKey: string
    system_prompt?: string | null
    user_prompt: string
    model_name: string
    temperature?: number
    max_tokens?: number
    /** OpenAI structured-output JSON schema. Ignored by other providers
     *  for now — Phase 4 round 2 wires Anthropic tool-use as the
     *  Anthropic-side equivalent. */
    response_format_json_schema?: Record<string, unknown> | null
}

export type CallResult = {
    text: string
    tokens_in: number
    tokens_out: number
    model: string
    latency_ms: number
    raw: unknown
}

/* ── OpenAI Chat Completions ─────────────────────────────────── */

export async function callOpenAI(opts: CallOpts): Promise<CallResult> {
    const t0 = Date.now()
    const body: Record<string, unknown> = {
        model: opts.model_name,
        messages: [
            ...(opts.system_prompt
                ? [{ role: "system", content: opts.system_prompt }]
                : []),
            { role: "user", content: opts.user_prompt },
        ],
        temperature: opts.temperature ?? 0.2,
        max_tokens: opts.max_tokens ?? 2000,
    }
    if (opts.response_format_json_schema) {
        body.response_format = {
            type: "json_schema",
            json_schema: opts.response_format_json_schema,
        }
    }
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
            Authorization: `Bearer ${opts.apiKey}`,
            "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(TIMEOUT_MS),
    })
    const latency = Date.now() - t0
    if (!res.ok) {
        throw new Error(`openai_${res.status}: ${await safeText(res)}`)
    }
    const json = (await res.json()) as {
        choices?: Array<{ message?: { content?: string } }>
        model?: string
        usage?: {
            prompt_tokens?: number
            completion_tokens?: number
        }
    }
    return {
        text: json.choices?.[0]?.message?.content ?? "",
        tokens_in: json.usage?.prompt_tokens ?? 0,
        tokens_out: json.usage?.completion_tokens ?? 0,
        model: json.model ?? opts.model_name,
        latency_ms: latency,
        raw: json,
    }
}

/* ── Anthropic Messages ──────────────────────────────────────── */

export async function callAnthropic(opts: CallOpts): Promise<CallResult> {
    const t0 = Date.now()
    const body: Record<string, unknown> = {
        model: opts.model_name,
        max_tokens: opts.max_tokens ?? 2000,
        temperature: opts.temperature ?? 0.2,
        messages: [{ role: "user", content: opts.user_prompt }],
    }
    if (opts.system_prompt) {
        body.system = opts.system_prompt
    }
    const res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
            "x-api-key": opts.apiKey,
            "anthropic-version": "2023-06-01",
            "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(TIMEOUT_MS),
    })
    const latency = Date.now() - t0
    if (!res.ok) {
        throw new Error(`anthropic_${res.status}: ${await safeText(res)}`)
    }
    const json = (await res.json()) as {
        content?: Array<{ type?: string; text?: string }>
        model?: string
        usage?: {
            input_tokens?: number
            output_tokens?: number
        }
    }
    // Concatenate every text block — usually one, but tool-use replies
    // can interleave.
    const text = (json.content ?? [])
        .filter((b) => b.type === "text" && typeof b.text === "string")
        .map((b) => b.text as string)
        .join("")
    return {
        text,
        tokens_in: json.usage?.input_tokens ?? 0,
        tokens_out: json.usage?.output_tokens ?? 0,
        model: json.model ?? opts.model_name,
        latency_ms: latency,
        raw: json,
    }
}

/* ── Perplexity (OpenAI-compatible) ──────────────────────────── */

export async function callPerplexity(opts: CallOpts): Promise<CallResult> {
    const t0 = Date.now()
    const body: Record<string, unknown> = {
        model: opts.model_name,
        messages: [
            ...(opts.system_prompt
                ? [{ role: "system", content: opts.system_prompt }]
                : []),
            { role: "user", content: opts.user_prompt },
        ],
        temperature: opts.temperature ?? 0.2,
        max_tokens: opts.max_tokens ?? 2000,
    }
    const res = await fetch("https://api.perplexity.ai/chat/completions", {
        method: "POST",
        headers: {
            Authorization: `Bearer ${opts.apiKey}`,
            "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(TIMEOUT_MS),
    })
    const latency = Date.now() - t0
    if (!res.ok) {
        throw new Error(`perplexity_${res.status}: ${await safeText(res)}`)
    }
    const json = (await res.json()) as {
        choices?: Array<{ message?: { content?: string } }>
        model?: string
        usage?: {
            prompt_tokens?: number
            completion_tokens?: number
        }
    }
    return {
        text: json.choices?.[0]?.message?.content ?? "",
        tokens_in: json.usage?.prompt_tokens ?? 0,
        tokens_out: json.usage?.completion_tokens ?? 0,
        model: json.model ?? opts.model_name,
        latency_ms: latency,
        raw: json,
    }
}

/* ── Gemini generateContent ──────────────────────────────────── */

export async function callGemini(opts: CallOpts): Promise<CallResult> {
    const t0 = Date.now()
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
        opts.model_name,
    )}:generateContent?key=${encodeURIComponent(opts.apiKey)}`
    const body: Record<string, unknown> = {
        contents: [
            {
                role: "user",
                parts: [{ text: opts.user_prompt }],
            },
        ],
        generationConfig: {
            temperature: opts.temperature ?? 0.2,
            maxOutputTokens: opts.max_tokens ?? 2000,
        },
    }
    if (opts.system_prompt) {
        body.systemInstruction = {
            parts: [{ text: opts.system_prompt }],
        }
    }
    const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
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
        usageMetadata?: {
            promptTokenCount?: number
            candidatesTokenCount?: number
        }
    }
    const parts = json.candidates?.[0]?.content?.parts ?? []
    const text = parts
        .map((p) => p.text ?? "")
        .filter(Boolean)
        .join("")
    return {
        text,
        tokens_in: json.usageMetadata?.promptTokenCount ?? 0,
        tokens_out: json.usageMetadata?.candidatesTokenCount ?? 0,
        model: json.modelVersion ?? opts.model_name,
        latency_ms: latency,
        raw: json,
    }
}

/* ── Dispatcher ──────────────────────────────────────────────── */

export type Provider = "openai" | "anthropic" | "perplexity" | "gemini"

export async function callProvider(
    provider: Provider,
    opts: CallOpts,
): Promise<CallResult> {
    switch (provider) {
        case "openai":
            return callOpenAI(opts)
        case "anthropic":
            return callAnthropic(opts)
        case "perplexity":
            return callPerplexity(opts)
        case "gemini":
            return callGemini(opts)
        default: {
            // Defensive — should never hit unless an admin invented a
            // new provider string.
            const _exhaustive: never = provider
            void _exhaustive
            throw new Error(`unknown_ai_provider: ${provider}`)
        }
    }
}

async function safeText(res: Response): Promise<string> {
    try {
        return (await res.text()).slice(0, 500)
    } catch {
        return `http_${res.status}`
    }
}
