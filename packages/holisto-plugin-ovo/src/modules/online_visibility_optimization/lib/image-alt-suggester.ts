/**
 * Image-alt AI suggester (OVO Phase 8.F).
 *
 * Per-page workflow: fetch the live HTML, find every `<img>` tag that
 * has no `alt` attribute, fetch each image's bytes, send to Gemini's
 * vision-capable model (`gemini-2.0-flash-lite`), and return a single
 * suggested alt-text string per image.
 *
 * Why server-side: keeps the Gemini API key out of the browser, lets
 * us share the existing `credentials` table key, and benefits from
 * the longer fetch timeouts that admin SPAs don't get reliably (CORS
 * + popup-blocker behaviours).
 *
 * Trade-offs:
 *   - We deliberately cap the number of images per page (default 12)
 *     so a media-heavy page doesn't blow through the free-tier quota
 *     in one click. Admins re-click for the next batch if needed.
 *   - The model can return a multi-sentence response despite the
 *     prompt asking for a single line; the wrapper trims to the
 *     first sentence + ≤ 200 chars before returning to the caller.
 *   - Images >5MB are skipped (too big for the free-tier inline
 *     base64 cap of ~10MB after encoding) — we surface them with a
 *     `skipped_reason: "too_large"` so the admin sees the gap.
 */

const PAGE_FETCH_TIMEOUT_MS = 15_000
const IMG_FETCH_TIMEOUT_MS = 10_000
const GEMINI_TIMEOUT_MS = 30_000
const IMG_MAX_BYTES = 5_000_000 // 5 MB
const DEFAULT_LIMIT = 12

const GEMINI_BASE = "https://generativelanguage.googleapis.com/v1beta/models"
const VISION_MODEL = "gemini-2.0-flash-lite"

const SUGGEST_PROMPT =
  "Write a single concise alt-text (10 to 15 words, no quotes, no trailing period) " +
  "describing this image for blind/low-vision users and SEO. Be specific to the " +
  "visible content. If the image is a logo, brand mark, or chart, lead with that " +
  "fact. Return ONLY the alt text — no preamble, no explanation, no markdown."

export type AltSuggestion = {
  image_url: string
  current_alt: string | null
  suggested_alt: string | null
  skipped_reason:
    | null
    | "fetch_failed"
    | "too_large"
    | "unsupported_mime"
    | "gemini_failed"
    | "empty_response"
  error?: string
}

export type SuggestAltsResult = {
  url: string
  images_total: number
  images_missing_alt: number
  suggestions: AltSuggestion[]
  errors: string[]
}

/**
 * End-to-end: given a page URL, find missing-alt images and produce
 * suggestions. `limit` caps the number of images Gemini is called on
 * per invocation (defaults to 12).
 *
 * `apiKey` is the Gemini key from the OVO credentials table (see
 * the OVO crypto helper for the decryption pathway).
 */
export async function suggestImageAltsForPage(
  pageUrl: string,
  apiKey: string,
  limit: number = DEFAULT_LIMIT,
): Promise<SuggestAltsResult> {
  const out: SuggestAltsResult = {
    url: pageUrl,
    images_total: 0,
    images_missing_alt: 0,
    suggestions: [],
    errors: [],
  }

  let html: string
  try {
    const res = await fetch(pageUrl, {
      headers: {
        Accept: "text/html,application/xhtml+xml",
        "User-Agent":
          "OvoAltSuggester/1.0 (+https://www.npmjs.com/package/@mithtech/medusa-plugin-ovo)",
      },
      signal: AbortSignal.timeout(PAGE_FETCH_TIMEOUT_MS),
      redirect: "follow",
    })
    if (!res.ok) {
      out.errors.push(`page_fetch_${res.status}`)
      return out
    }
    html = await res.text()
  } catch (err) {
    out.errors.push(`page_fetch_failed: ${(err as Error).message}`)
    return out
  }

  const imgs = extractImagesNeedingAlt(html, pageUrl)
  out.images_total = imgs.total
  out.images_missing_alt = imgs.missing.length

  const queue = imgs.missing.slice(0, Math.max(1, Math.min(limit, 24)))

  // Run Gemini calls sequentially — free tier is 15 req/min, and we'd
  // rather succeed slowly than burst-fail at 16 concurrent calls.
  for (const img of queue) {
    out.suggestions.push(await suggestOne(img, apiKey))
  }

  return out
}

type ImgEntry = { image_url: string; current_alt: string | null }
type ImgExtract = { total: number; missing: ImgEntry[] }

function extractImagesNeedingAlt(html: string, pageUrl: string): ImgExtract {
  const matches = [...html.matchAll(/<img\b[^>]*>/gi)]
  const missing: ImgEntry[] = []
  const seen = new Set<string>()
  for (const m of matches) {
    const tag = m[0]
    const srcM = /\bsrc\s*=\s*["']([^"']+)["']/i.exec(tag)
    if (!srcM || !srcM[1]) continue
    const altM = /\balt\s*=\s*["']([^"']*)["']/i.exec(tag)
    const has_alt = !!altM
    if (has_alt) continue // includes `alt=""` (decorative) — auditor parity

    // Skip data: URIs (inline base64, can't meaningfully be re-described)
    // and javascript: schemes (defence-in-depth).
    const raw = srcM[1].trim()
    if (raw.startsWith("data:") || raw.startsWith("javascript:")) continue

    let abs: string
    try {
      abs = new URL(raw, pageUrl).toString()
    } catch {
      continue
    }
    if (seen.has(abs)) continue
    seen.add(abs)
    missing.push({ image_url: abs, current_alt: null })
  }
  return { total: matches.length, missing }
}

async function suggestOne(
  img: ImgEntry,
  apiKey: string,
): Promise<AltSuggestion> {
  // 1. Fetch the image bytes.
  let bytes: ArrayBuffer
  let mime: string
  try {
    const res = await fetch(img.image_url, {
      signal: AbortSignal.timeout(IMG_FETCH_TIMEOUT_MS),
      redirect: "follow",
    })
    if (!res.ok) {
      return {
        ...img,
        suggested_alt: null,
        skipped_reason: "fetch_failed",
        error: `img_fetch_${res.status}`,
      }
    }
    const ct = (res.headers.get("content-type") || "").toLowerCase()
    if (
      ct &&
      !ct.startsWith("image/jpeg") &&
      !ct.startsWith("image/png") &&
      !ct.startsWith("image/webp") &&
      !ct.startsWith("image/gif")
    ) {
      return {
        ...img,
        suggested_alt: null,
        skipped_reason: "unsupported_mime",
        error: ct || "no_content_type",
      }
    }
    mime = ct.split(";")[0] || guessMimeFromUrl(img.image_url)
    bytes = await res.arrayBuffer()
    if (bytes.byteLength > IMG_MAX_BYTES) {
      return {
        ...img,
        suggested_alt: null,
        skipped_reason: "too_large",
        error: `${Math.round(bytes.byteLength / 1024)}KB`,
      }
    }
  } catch (err) {
    return {
      ...img,
      suggested_alt: null,
      skipped_reason: "fetch_failed",
      error: (err as Error).message,
    }
  }

  // 2. Send to Gemini Vision.
  const b64 = bufferToBase64(bytes)
  let suggested: string | null = null
  try {
    const url = `${GEMINI_BASE}/${encodeURIComponent(VISION_MODEL)}:generateContent?key=${encodeURIComponent(apiKey)}`
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [
          {
            role: "user",
            parts: [
              { text: SUGGEST_PROMPT },
              { inline_data: { mime_type: mime, data: b64 } },
            ],
          },
        ],
        generationConfig: {
          maxOutputTokens: 80,
          temperature: 0.2,
        },
      }),
      signal: AbortSignal.timeout(GEMINI_TIMEOUT_MS),
    })
    if (!res.ok) {
      return {
        ...img,
        suggested_alt: null,
        skipped_reason: "gemini_failed",
        error: `gemini_${res.status}`,
      }
    }
    const json = (await res.json()) as {
      candidates?: Array<{
        content?: { parts?: Array<{ text?: string }> }
      }>
    }
    const parts = json.candidates?.[0]?.content?.parts ?? []
    suggested = parts
      .map((p) => (typeof p.text === "string" ? p.text : ""))
      .join(" ")
      .trim()
  } catch (err) {
    return {
      ...img,
      suggested_alt: null,
      skipped_reason: "gemini_failed",
      error: (err as Error).message,
    }
  }

  const cleaned = cleanSuggestion(suggested)
  if (!cleaned) {
    return {
      ...img,
      suggested_alt: null,
      skipped_reason: "empty_response",
    }
  }

  return {
    ...img,
    suggested_alt: cleaned,
    skipped_reason: null,
  }
}

/**
 * Trim to first sentence + ≤ 200 chars + strip stray quotes/markdown.
 * Gemini sometimes returns "Alt: a photo of …" or wraps in quotes
 * despite the prompt — defensive normalisation here keeps the admin
 * UI clean.
 */
function cleanSuggestion(raw: string | null): string | null {
  if (!raw) return null
  let s = raw.trim()
  // Strip "alt: " / "alt text: " / leading markdown bullets.
  s = s.replace(/^[-*]\s+/, "")
  s = s.replace(/^(alt(?:\s*text)?\s*:\s*)/i, "")
  // Strip wrapping quotes.
  if (
    (s.startsWith('"') && s.endsWith('"')) ||
    (s.startsWith("'") && s.endsWith("'")) ||
    (s.startsWith("“") && s.endsWith("”"))
  ) {
    s = s.slice(1, -1).trim()
  }
  // Take first sentence if multi-line.
  const firstLine = s.split(/\n/)[0].trim()
  s = firstLine || s
  // Drop trailing period (Google's accessibility guide treats alt as a
  // phrase, not a sentence).
  s = s.replace(/\.$/, "")
  if (s.length > 200) s = s.slice(0, 200).trim()
  if (s.length < 3) return null
  return s
}

function guessMimeFromUrl(url: string): string {
  const u = url.toLowerCase()
  if (u.endsWith(".png")) return "image/png"
  if (u.endsWith(".webp")) return "image/webp"
  if (u.endsWith(".gif")) return "image/gif"
  return "image/jpeg"
}

function bufferToBase64(buf: ArrayBuffer): string {
  // Node Buffer is available in the Medusa server runtime.
  return Buffer.from(buf).toString("base64")
}
