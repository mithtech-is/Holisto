/**
 * Shared types for the AI-citation surface.
 *
 * Each provider lib wraps a single chat-style endpoint and returns
 * `AiAnswer`. The citation service then runs the answer through
 * `extractSignals()` (see `./extract.ts`) to derive booleans + the
 * competitor list + sentiment without a second LLM round-trip.
 *
 * Detection is brand-driven: the brand name, link domains, and the
 * competitor list all come from the OVO settings row (configured per
 * install), so the plugin carries no hardcoded client identity.
 */

export type AiProvider = "openai" | "anthropic" | "perplexity" | "gemini"

export type AiAnswer = {
  provider: AiProvider
  model_name: string
  answer: string
  latency_ms: number
  raw: unknown
}

export type AiCitationSignals = {
  /** The configured brand name appears in the answer text. */
  mentions_brand: boolean
  /** A URL on one of the configured brand domains appears in the answer. */
  links_brand: boolean
  competitor_mentions: string[]
  sentiment: "positive" | "neutral" | "negative" | null
  position: number | null
}

/** A competitor the operator wants tracked in extracted answers. */
export type CompetitorMatcher = { canonical: string; aliases: string[] }

/**
 * Brand-matching configuration resolved from settings and handed to
 * `extractSignals`. When `name` is empty (brand not configured yet) the
 * extractor reports `mentions_brand: false` rather than guessing.
 */
export type BrandMatchConfig = {
  /** Primary brand name, e.g. "Acme". */
  name: string
  /** Alternate names / aliases to also count as a brand mention. */
  aliases: string[]
  /** Bare domains (no scheme), e.g. ["acme.com", "acme.io"]. */
  domains: string[]
  /** Competitor matchers, configured per install. */
  competitors: CompetitorMatcher[]
}

export const EMPTY_BRAND_MATCH: BrandMatchConfig = {
  name: "",
  aliases: [],
  domains: [],
  competitors: [],
}
