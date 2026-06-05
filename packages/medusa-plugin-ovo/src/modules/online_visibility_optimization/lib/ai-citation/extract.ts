import {
  type AiCitationSignals,
  type BrandMatchConfig,
  EMPTY_BRAND_MATCH,
} from "./types"

/**
 * Pure-function signal extractor for an AI answer about the configured
 * brand.
 *
 * Deliberately heuristic — no second LLM call (cost) and no NLP
 * dependency (bundle weight + non-determinism). Each check is a narrow
 * regex or boolean we can debug from the raw answer text surfaced in
 * the admin tab.
 *
 * Detection is brand-driven via `brand` (resolved from settings):
 *   - `mentions_brand`     — brand name / alias appears (word-boundary)
 *   - `links_brand`        — a URL on a configured brand domain appears
 *   - `competitor_mentions[]` — canonical names from the configured list
 *   - `sentiment`          — positive / neutral / negative / null
 *   - `position`           — rank in a numbered list, or null
 *
 * When no brand name is configured, brand signals report false/empty so
 * the mention/citation rates stay honest (no fabricated matches).
 */
export function extractSignals(
  answer: string,
  brand: BrandMatchConfig = EMPTY_BRAND_MATCH,
): AiCitationSignals {
  const text = (answer || "").toLowerCase()

  const brandTerms = [brand.name, ...(brand.aliases || [])]
    .map((s) => (s || "").trim().toLowerCase())
    .filter(Boolean)
  const brandRegex =
    brandTerms.length > 0
      ? new RegExp(`\\b(?:${brandTerms.map(escapeRegex).join("|")})\\b`, "i")
      : null

  const mentions_brand = brandRegex ? brandRegex.test(text) : false

  const domains = (brand.domains || [])
    .map((d) => (d || "").trim().toLowerCase().replace(/^https?:\/\//, ""))
    .filter(Boolean)
  const links_brand =
    domains.length > 0 &&
    domains.some((d) => new RegExp(`\\b${escapeRegex(d)}\\b`, "i").test(text))

  const competitor_mentions: string[] = []
  for (const c of brand.competitors || []) {
    for (const a of c.aliases) {
      const pattern = new RegExp(`\\b${escapeRegex(a)}\\b`, "i")
      if (pattern.test(text)) {
        if (!competitor_mentions.includes(c.canonical)) {
          competitor_mentions.push(c.canonical)
        }
        break
      }
    }
  }

  // Position in a numbered list. We scan markdown / plain-text lists:
  //   "1. Acme — …"           ← matches at position 1
  //   "  2)  Acme (…)"        ← matches at position 2
  // Bullet lists ("-" / "*") are ignored on purpose; only ordered
  // lists carry a real ranking signal.
  let position: number | null = null
  if (mentions_brand && brandRegex) {
    const lines = answer.split(/\r?\n/)
    for (const line of lines) {
      const m = /^\s*(\d{1,2})[.)]\s+(.*)$/.exec(line)
      if (!m) continue
      const body = m[2]
      if (brandRegex.test(body)) {
        const n = Number(m[1])
        if (Number.isFinite(n)) {
          position = n
        }
        break
      }
    }
  }

  // Sentiment: cheap keyword heuristic. Look in a 300-char window
  // around the first brand mention so unrelated negativity elsewhere
  // in the answer doesn't poison the read.
  let sentiment: "positive" | "neutral" | "negative" | null = null
  if (mentions_brand && brandRegex) {
    const idx = text.search(brandRegex)
    const window = text.slice(Math.max(0, idx - 100), idx + 200)
    const POSITIVE = [
      "trusted",
      "transparent",
      "reliable",
      "recommended",
      "popular",
      "leading",
      "best",
      "top",
      "trustworthy",
      "secure",
      "regulated",
      "established",
      "good option",
      "excellent",
    ]
    const NEGATIVE = [
      "avoid",
      "scam",
      "fraud",
      "unreliable",
      "risky",
      "not recommended",
      "complaints",
      "issues",
      "lawsuit",
      "investigated",
      "warning",
      "be careful",
    ]
    const pos = POSITIVE.some((w) => window.includes(w))
    const neg = NEGATIVE.some((w) => window.includes(w))
    if (pos && !neg) sentiment = "positive"
    else if (neg && !pos) sentiment = "negative"
    else if (pos && neg) sentiment = "neutral"
    else sentiment = "neutral"
  }

  return {
    mentions_brand,
    links_brand,
    competitor_mentions,
    sentiment,
    position,
  }
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}
