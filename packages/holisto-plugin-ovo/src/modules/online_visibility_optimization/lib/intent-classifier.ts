/**
 * Search-intent classifier for keyword targets (OVO Phase 8.D).
 *
 * Bucketing follows the canonical four-way split used in modern SEO:
 *
 *   - "informational"  — the searcher wants to understand a topic
 *                        ("what is", "how does X work", "explain Y")
 *   - "navigational"   — the searcher is looking for a specific brand
 *                        / page / login screen
 *   - "transactional"  — the searcher is ready to act: buy, sign up,
 *                        invest, download, register
 *   - "commercial"     — the searcher is researching before buying:
 *                        comparisons, "best X", reviews, "vs", pricing
 *
 * The classifier is intentionally a heuristic — search-volume cost
 * makes a model-driven approach not worth it for the ~hundreds of
 * keywords a single admin would track. The fallback when no signal
 * fires is "informational" because that's the empirical mode for
 * unstructured queries in our corpus (the operator tracks knowledge,
 * sector, and brand-research queries).
 *
 * India-specific quirks: a small Hinglish lexicon ("kya hai", "kaise",
 * "kharidne") is included because a meaningful chunk of long-tail
 * traffic to the storefront knowledge base comes through Hindi-
 * transliterated queries. Keep the lexicon English-leaning but allow
 * those exact phrases.
 */

export type SearchIntent =
  | "informational"
  | "navigational"
  | "transactional"
  | "commercial"

const INFORMATIONAL_MARKERS: RegExp[] = [
  /\bwhat\s+is\b/i,
  /\bhow\s+(?:to|does|do|can|is|are)\b/i,
  /\bwhy\s+(?:is|are|do|does)\b/i,
  /\bwhen\s+(?:is|will|did)\b/i,
  /\bwhere\s+(?:is|are|to)\b/i,
  /\bguide\b/i,
  /\btutorial\b/i,
  /\bexplain(?:ed|er)?\b/i,
  /\bdefinition\b/i,
  /\bmeaning\b/i,
  /\bbasics?\b/i,
  /\bfor\s+beginners?\b/i,
  /\bfaq\b/i,
  /\bquestions?\b/i,
  /\barticle\b/i,
  /\bknowledge\b/i,
  // Hinglish — captures a meaningful slice of long-tail informational
  // queries in our SGE/AEO traffic.
  /\bkya\s+(?:hai|hain)\b/i,
  /\bkaise\b/i,
  /\bkyun\b/i,
]

const TRANSACTIONAL_MARKERS: RegExp[] = [
  /\bbuy\b/i,
  /\bpurchase\b/i,
  /\binvest\s+in\b/i,
  /\binvestment\s+platform\b/i,
  /\bregister\b/i,
  /\bsign\s*up\b/i,
  /\bcreate\s+account\b/i,
  /\bopen\s+account\b/i,
  /\bdownload\b/i,
  /\bsubscribe\b/i,
  /\border\b/i,
  /\bcheckout\b/i,
  /\benroll\b/i,
  /\bkharidne?\b/i, // Hinglish: "to buy"
  /\bkharido\b/i, // Hinglish: "buy" (imperative)
  /\bget\s+(?:started|access)\b/i,
]

const COMMERCIAL_MARKERS: RegExp[] = [
  /\bbest\b/i,
  /\btop\s*\d*\b/i,
  /\bvs\.?\b/i,
  /\bversus\b/i,
  /\bcompare(?:d|s)?\b/i,
  /\bcomparison\b/i,
  /\balternatives?\b/i,
  /\breviews?\b/i,
  /\brating\b/i,
  /\brankings?\b/i,
  /\bcheapest\b/i,
  /\bcheap\b/i,
  /\bbudget\b/i,
  /\baffordable\b/i,
  /\bpricing\b/i,
  /\bprice\b/i,
  /\bcost\b/i,
  /\bfees\b/i,
  /\bdiscount\b/i,
  /\bpros?\s+and\s+cons?\b/i,
  /\bworth\s+it\b/i,
  /\bshould\s+i\b/i,
]

const NAVIGATIONAL_MARKERS: RegExp[] = [
  /\blogin\b/i,
  /\bsign\s*in\b/i,
  /\bdashboard\b/i,
  /\bcontact\s+us\b/i,
  /\bsupport\b/i,
  /\bhelp\s+(?:center|desk)\b/i,
  /\babout\s+us\b/i,
  /\bofficial\s+(?:site|website|page)\b/i,
  /\bhomepage\b/i,
]

/**
 * Classify a single keyword. Returns the intent + a short reason
 * string showing which marker fired (so the admin UI can explain the
 * classification on hover).
 *
 * Priority order: navigational > transactional > commercial >
 * informational. Rationale:
 *
 *   - Navigational beats everything: if the user typed a brand or
 *     "login", the funnel position is "they're already at the bottom"
 *     and we want to track distinct from research-mode traffic.
 *   - Transactional beats commercial: "buy X" + "best X" pattern is
 *     transactional (the buying word is the more committal one).
 *   - Commercial beats informational: "best X" + "what is X" pattern
 *     is research (commercial signal wins).
 */
export function classifyIntent(keyword: string): {
  intent: SearchIntent
  reason: string
} {
  const k = keyword.trim()
  if (!k) return { intent: "informational", reason: "empty input" }

  for (const re of NAVIGATIONAL_MARKERS) {
    if (re.test(k)) return navResult(re, k)
  }
  for (const re of TRANSACTIONAL_MARKERS) {
    if (re.test(k)) return txnResult(re, k)
  }
  for (const re of COMMERCIAL_MARKERS) {
    if (re.test(k)) return commResult(re, k)
  }
  for (const re of INFORMATIONAL_MARKERS) {
    if (re.test(k)) return infoResult(re, k)
  }
  // Fallback — see header comment for why "informational" is the
  // chosen default rather than e.g. "commercial".
  return { intent: "informational", reason: "no signal — default" }
}

function navResult(re: RegExp, k: string) {
  return { intent: "navigational" as const, reason: `matched ${describeMatch(re, k)}` }
}
function txnResult(re: RegExp, k: string) {
  return { intent: "transactional" as const, reason: `matched ${describeMatch(re, k)}` }
}
function commResult(re: RegExp, k: string) {
  return { intent: "commercial" as const, reason: `matched ${describeMatch(re, k)}` }
}
function infoResult(re: RegExp, k: string) {
  return { intent: "informational" as const, reason: `matched ${describeMatch(re, k)}` }
}

function describeMatch(re: RegExp, k: string): string {
  const m = re.exec(k)
  if (m && m[0]) return `"${m[0].toLowerCase()}"`
  return re.source
}
