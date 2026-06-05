/**
 * Per-URL on-page SEO auditor. Fetches a URL, parses its HTML with
 * simple regexes (no full DOM parser — we don't need one for the
 * checks we run, and pulling in `cheerio` would add ~600 KB to the
 * runtime image), then emits a structured `AuditFinding` per check.
 *
 * Why regex over a DOM parser:
 *   - We only inspect the head (canonical, meta, title, og, ld+json)
 *     plus a few body tags (h1, img alt). All single-tag look-ups.
 *   - The audit runs on 100-200 URLs per night and finishes in a
 *     few seconds with regex — a real parser would multiply latency
 *     without adding diagnostic power.
 *   - When a regex is too brittle for a check, we degrade gracefully:
 *     a parse failure is silently treated as "not detected" rather
 *     than a thrown error, because the audit's value is "tell me what
 *     looks wrong" not "produce a perfect AST".
 *
 * The checks are deliberately conservative — we emit "warn" for
 * borderline issues (60 < title < 90 chars) and "error" only when
 * Google's docs explicitly call out a hard failure mode.
 */

const TIMEOUT_MS = 12_000
// User-Agent header must be Latin-1 (Node's fetch rejects characters
// > 0xFF). Plain ASCII only — no em-dashes, no smart quotes.
const USER_AGENT =
  "OVO-SEO-Auditor/1 (+https://www.npmjs.com/package/@mithtech/medusa-plugin-ovo)"

export type AuditSeverity = "error" | "warn"

export type AuditFinding = {
  severity: AuditSeverity
  code: string
  message: string
}

export type AuditResult = {
  url: string
  status_code: number
  response_time_ms: number
  title: string | null
  title_length: number
  meta_description: string | null
  meta_description_length: number
  canonical_url: string | null
  canonical_ok: boolean
  h1_count: number
  h1_text: string | null
  h2_count: number
  h3_count: number
  image_count: number
  image_missing_alt_count: number
  images_missing_dim_count: number
  jsonld_count: number
  jsonld_invalid_count: number
  jsonld_types: string[]
  word_count: number
  has_og_title: boolean
  has_og_image: boolean
  has_twitter_card: boolean
  /** Was the response served over HTTPS? */
  is_https: boolean
  /** Presence of mobile-friendly viewport meta. */
  has_viewport: boolean
  /** `<html lang="...">` attribute present. */
  has_lang: boolean
  /** `<meta name="robots" content="noindex">` — true means the page
   *  is intentionally or accidentally hidden from search engines. */
  robots_noindex: boolean
  /** Approx total HTML response size in bytes (cap at our read cap). */
  response_bytes: number
  /** Count of `<script src="..."></script>` tags. */
  external_script_count: number
  /** Number of internal anchor (<a href="/..."> or same-host) links. */
  internal_link_count: number
  /** Number of external anchor links. */
  external_link_count: number
  /** Page-level quality score 0-100. Composed by the lint pipeline:
   *  starts at 100, subtracts a small amount per finding by severity.
   *  Floor 0. Cheap to recompute on every audit run. */
  quality_score: number
  /** Target keywords (operator-curated, joined from
   *  `ovo_seo_keyword_target` BEFORE the audit). The auditor checks
   *  each keyword's presence in title/h1/body and emits findings. */
  target_keywords?: Array<{
    keyword: string
    in_title: boolean
    in_h1: boolean
    in_body: boolean
  }>
  findings: AuditFinding[]
  /** First ~2 KB of body, only stored when there are findings. */
  html_sample: string | null
}

/**
 * Audit one URL. Always resolves — network errors become a `status_code: 0`
 * row with a single "fetch_failed" error finding, so the caller can
 * persist the failure rather than skip it (operationally we want to
 * SEE the down page in the dashboard, not silently lose it).
 *
 * Optional `targetKeywords` is a per-URL list of operator-curated head
 * keywords the page is meant to rank for; each is checked for presence
 * in the title / h1 / body and emits a `keyword_missing_in_*` finding
 * per gap.
 */
export async function auditUrl(
  url: string,
  targetKeywords: string[] = [],
): Promise<AuditResult> {
  const startedAt = Date.now()
  let res: Response
  try {
    res = await fetch(url, {
      headers: {
        "User-Agent": USER_AGENT,
        Accept: "text/html,application/xhtml+xml",
      },
      redirect: "follow",
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
  } catch (err) {
    return failedAudit(
      url,
      Date.now() - startedAt,
      (err as Error).message || "network_error",
    )
  }
  const responseTime = Date.now() - startedAt

  if (!res.ok) {
    const text = await safeReadText(res, 4000)
    const failedFindings: AuditFinding[] = [
      {
        severity: "error",
        code: "non_2xx",
        message: `Returned HTTP ${res.status}`,
      },
    ]
    return {
      ...emptyResult(url, res.status, responseTime),
      findings: failedFindings,
      quality_score: computeScore(failedFindings),
      html_sample: text.slice(0, 2000),
    }
  }

  // 2 MB cap: large enough to capture the body's H1 + image alts on
  // the heaviest catalogue + screener pages (the live /invest currently
  // serialises to ~850 KB with all 60+ product cards inline). Pages
  // larger than 2 MB are deliberately truncated — they're already an
  // SEO problem in their own right and the auditor's existing
  // `thin_content` / `slow_response` checks will surface them.
  const html = await safeReadText(res, 2_000_000)
  const parsed = parseHtml(html, url)
  parsed.response_bytes = html.length
  parsed.is_https = url.startsWith("https://")

  const keywordResults = checkTargetKeywords(parsed, html, targetKeywords)
  const findings = runChecks(url, res.status, responseTime, parsed).concat(
    keywordResults.findings,
  )
  const quality_score = computeScore(findings)

  return {
    url,
    status_code: res.status,
    response_time_ms: responseTime,
    ...parsed,
    target_keywords: keywordResults.results,
    findings,
    quality_score,
    html_sample: findings.length > 0 ? html.slice(0, 2000) : null,
  }
}

/**
 * Page quality score: starts at 100, deducts 15 per error and 5 per
 * warn, floors at 0. Deliberately blunt — the value is "rough at-a-
 * glance health bucket" not a calibrated benchmark. Operators care
 * about the trend more than the absolute number.
 */
function computeScore(findings: AuditFinding[]): number {
  let s = 100
  for (const f of findings) {
    s -= f.severity === "error" ? 15 : 5
  }
  return Math.max(0, s)
}

/**
 * For each operator-supplied target keyword, check that the keyword
 * appears (case-insensitive) in the title, the first `<h1>`, and the
 * page body. Each missing location surfaces as a distinct finding so
 * the operator can see *where* the gap is.
 */
function checkTargetKeywords(
  parsed: ParsedHtml,
  html: string,
  targetKeywords: string[],
): {
  findings: AuditFinding[]
  results: Array<{
    keyword: string
    in_title: boolean
    in_h1: boolean
    in_body: boolean
  }>
} {
  if (!targetKeywords.length) return { findings: [], results: [] }
  const title = (parsed.title ?? "").toLowerCase()
  const h1 = (parsed.h1_text ?? "").toLowerCase()
  // Strip script/style + tags for body keyword search so we don't
  // false-positive on `<script>const brand = …</script>`.
  const bodyMatch = /<body[^>]*>([\s\S]*?)<\/body>/i.exec(html)
  const body = (bodyMatch ? bodyMatch[1] : html)
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .toLowerCase()

  const findings: AuditFinding[] = []
  const results: Array<{
    keyword: string
    in_title: boolean
    in_h1: boolean
    in_body: boolean
  }> = []
  for (const raw of targetKeywords) {
    const k = raw.toLowerCase().trim()
    if (!k) continue
    const in_title = title.includes(k)
    const in_h1 = h1.includes(k)
    const in_body = body.includes(k)
    results.push({ keyword: raw, in_title, in_h1, in_body })
    if (!in_title) {
      findings.push({
        severity: "warn",
        code: "keyword_missing_in_title",
        message: `Target keyword "${raw}" is not in the <title>.`,
      })
    }
    if (!in_h1) {
      findings.push({
        severity: "warn",
        code: "keyword_missing_in_h1",
        message: `Target keyword "${raw}" is not in the <h1>.`,
      })
    }
    if (!in_body) {
      findings.push({
        severity: "error",
        code: "keyword_missing_in_body",
        message: `Target keyword "${raw}" is not on the page body at all — the page can't rank for it.`,
      })
    }
  }
  return { findings, results }
}

/* ── HTML parsing ─────────────────────────────────────────────────── */

type ParsedHtml = {
  title: string | null
  title_length: number
  meta_description: string | null
  meta_description_length: number
  canonical_url: string | null
  canonical_ok: boolean
  h1_count: number
  h1_text: string | null
  h2_count: number
  h3_count: number
  image_count: number
  image_missing_alt_count: number
  images_missing_dim_count: number
  jsonld_count: number
  jsonld_invalid_count: number
  jsonld_types: string[]
  word_count: number
  has_og_title: boolean
  has_og_image: boolean
  has_twitter_card: boolean
  is_https: boolean
  has_viewport: boolean
  has_lang: boolean
  robots_noindex: boolean
  response_bytes: number
  external_script_count: number
  internal_link_count: number
  external_link_count: number
}

function parseHtml(html: string, sourceUrl: string): ParsedHtml {
  let sourceHost = ""
  try {
    sourceHost = new URL(sourceUrl).hostname.toLowerCase()
  } catch {
    /* fall through with empty host — internal/external check degrades to "any /path = internal" */
  }
  const decode = (s: string) =>
    s
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/&apos;/g, "'")
      .trim()

  // <title>
  const titleMatch = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)
  const title = titleMatch ? decode(titleMatch[1]) : null

  // <meta name="description">
  const descMatch =
    /<meta[^>]+name=["']description["'][^>]*content=["']([\s\S]*?)["']/i.exec(
      html,
    ) ||
    /<meta[^>]+content=["']([\s\S]*?)["'][^>]*name=["']description["']/i.exec(
      html,
    )
  const meta_description = descMatch ? decode(descMatch[1]) : null

  // <link rel="canonical">
  const canonicalMatch =
    /<link[^>]+rel=["']canonical["'][^>]*href=["']([^"']+)["']/i.exec(html) ||
    /<link[^>]+href=["']([^"']+)["'][^>]*rel=["']canonical["']/i.exec(html)
  const canonical_url = canonicalMatch ? decode(canonicalMatch[1]) : null

  // <h1>
  const h1Matches = [...html.matchAll(/<h1[^>]*>([\s\S]*?)<\/h1>/gi)]
  const h1_count = h1Matches.length
  const h1_text = h1Matches[0]
    ? decode(stripTags(h1Matches[0][1])).slice(0, 200)
    : null

  // <h2>, <h3>
  const h2_count = [...html.matchAll(/<h2[\s>]/gi)].length
  const h3_count = [...html.matchAll(/<h3[\s>]/gi)].length

  // <img> — count total + missing alt. Strict: an `alt=""` is treated as
  // a decorative-image declaration (valid) and not counted as missing,
  // matching Google's accessibility guidance.
  const imgMatches = [...html.matchAll(/<img\b[^>]*>/gi)]
  const image_count = imgMatches.length
  const image_missing_alt_count = imgMatches.filter(
    (m) => !/\balt\s*=\s*"/i.test(m[0]) && !/\balt\s*=\s*'/i.test(m[0]),
  ).length
  // CLS-critical: <img> without explicit width+height triggers layout
  // shift on every page load. Both Next.js Image and a hand-written
  // <img> can omit these — Lighthouse flags it.
  const images_missing_dim_count = imgMatches.filter(
    (m) => !/\bwidth\s*=/i.test(m[0]) || !/\bheight\s*=/i.test(m[0]),
  ).length

  // <html lang="..."> + viewport meta + robots meta
  const has_lang = /<html[^>]+lang\s*=\s*["'][^"']+["']/i.test(html)
  const has_viewport = /<meta[^>]+name=["']viewport["']/i.test(html)
  const robots_noindex =
    /<meta[^>]+name=["']robots["'][^>]*content=["'][^"']*noindex/i.test(html)

  // External <script src="..."> count — high count = LCP risk + third-party
  // privacy surface. Inline scripts don't count.
  const external_script_count = [
    ...html.matchAll(/<script\b[^>]*\bsrc\s*=\s*["'][^"']+["']/gi),
  ].length

  // Internal vs external <a href="...">. "Internal" = same-host or path-
  // relative href. Strip anchors + mailto/tel/javascript: links.
  const linkMatches = [
    ...html.matchAll(/<a\b[^>]*\bhref\s*=\s*["']([^"']+)["']/gi),
  ]
  let internal_link_count = 0
  let external_link_count = 0
  for (const m of linkMatches) {
    const href = m[1]
    if (
      !href ||
      href.startsWith("#") ||
      href.startsWith("mailto:") ||
      href.startsWith("tel:") ||
      href.startsWith("javascript:")
    )
      continue
    if (href.startsWith("/") || href.startsWith("?") || href.startsWith(".")) {
      internal_link_count += 1
      continue
    }
    try {
      const u = new URL(href)
      if (sourceHost && u.hostname.toLowerCase() === sourceHost) {
        internal_link_count += 1
      } else {
        external_link_count += 1
      }
    } catch {
      // Malformed href — count as internal (likely a fragment).
      internal_link_count += 1
    }
  }

  // <script type="application/ld+json">
  const ldMatches = [
    ...html.matchAll(
      /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi,
    ),
  ]
  let jsonld_invalid_count = 0
  const jsonld_types = new Set<string>()
  for (const m of ldMatches) {
    try {
      const parsed = JSON.parse(m[1].trim())
      collectTypes(parsed, jsonld_types)
    } catch {
      jsonld_invalid_count += 1
    }
  }

  // OpenGraph + Twitter
  const has_og_title = /<meta[^>]+property=["']og:title["']/i.test(html)
  const has_og_image = /<meta[^>]+property=["']og:image["']/i.test(html)
  const has_twitter_card = /<meta[^>]+name=["']twitter:card["']/i.test(html)

  // Visible-body word count — strip scripts/styles + tags, count whitespace splits.
  const bodyMatch = /<body[^>]*>([\s\S]*?)<\/body>/i.exec(html)
  const bodyText = (bodyMatch ? bodyMatch[1] : html)
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
  const word_count = bodyText.trim().split(/\s+/).filter(Boolean).length

  return {
    title,
    title_length: title ? title.length : 0,
    meta_description,
    meta_description_length: meta_description ? meta_description.length : 0,
    canonical_url,
    canonical_ok: false, // resolved by runChecks once it knows the source URL
    h1_count,
    h1_text,
    h2_count,
    h3_count,
    image_count,
    image_missing_alt_count,
    images_missing_dim_count,
    jsonld_count: ldMatches.length,
    jsonld_invalid_count,
    jsonld_types: [...jsonld_types],
    word_count,
    has_og_title,
    has_og_image,
    has_twitter_card,
    is_https: false, // resolved by auditUrl based on source URL scheme
    has_viewport,
    has_lang,
    robots_noindex,
    response_bytes: 0, // resolved by auditUrl
    external_script_count,
    internal_link_count,
    external_link_count,
  }
}

function stripTags(s: string): string {
  return s.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim()
}

function collectTypes(node: unknown, into: Set<string>) {
  if (!node) return
  if (Array.isArray(node)) {
    for (const n of node) collectTypes(n, into)
    return
  }
  if (typeof node === "object") {
    const obj = node as Record<string, unknown>
    const t = obj["@type"]
    if (typeof t === "string") into.add(t)
    else if (Array.isArray(t)) for (const tt of t) {
      if (typeof tt === "string") into.add(tt)
    }
    // mainEntity / itemListElement may carry nested types worth surfacing.
    for (const key of ["mainEntity", "itemListElement", "@graph"]) {
      if (key in obj) collectTypes(obj[key], into)
    }
  }
}

/* ── Lint checks ──────────────────────────────────────────────────── */

/** Length thresholds Google's documentation explicitly mentions. */
const TITLE_MIN = 30
const TITLE_MAX_WARN = 60
const TITLE_MAX_ERROR = 90
const DESC_MIN = 50
const DESC_MAX = 160
const RESP_SLOW_MS = 5000

function runChecks(
  sourceUrl: string,
  status: number,
  responseTime: number,
  p: ParsedHtml,
): AuditFinding[] {
  const findings: AuditFinding[] = []

  if (status >= 400) {
    findings.push({
      severity: "error",
      code: "non_2xx",
      message: `HTTP ${status} (page is broken or redirected to an error page)`,
    })
  }

  if (responseTime > RESP_SLOW_MS) {
    findings.push({
      severity: "warn",
      code: "slow_response",
      message: `Responded in ${(responseTime / 1000).toFixed(1)}s (> ${RESP_SLOW_MS / 1000}s — Googlebot may time out)`,
    })
  }

  // Title checks.
  if (!p.title || p.title_length === 0) {
    findings.push({
      severity: "error",
      code: "title_missing",
      message: "No <title> tag found.",
    })
  } else {
    if (p.title_length < TITLE_MIN) {
      findings.push({
        severity: "warn",
        code: "title_short",
        message: `Title is ${p.title_length} chars (< ${TITLE_MIN}). Add keywords or context.`,
      })
    } else if (p.title_length > TITLE_MAX_ERROR) {
      findings.push({
        severity: "error",
        code: "title_too_long",
        message: `Title is ${p.title_length} chars (> ${TITLE_MAX_ERROR}). Google will hard-truncate.`,
      })
    } else if (p.title_length > TITLE_MAX_WARN) {
      findings.push({
        severity: "warn",
        code: "title_long",
        message: `Title is ${p.title_length} chars (> ${TITLE_MAX_WARN}). Google may truncate.`,
      })
    }
  }

  // Meta description.
  if (!p.meta_description) {
    findings.push({
      severity: "warn",
      code: "meta_description_missing",
      message: "No <meta name=\"description\">. Google will synthesize one (worse CTR).",
    })
  } else {
    if (p.meta_description_length < DESC_MIN) {
      findings.push({
        severity: "warn",
        code: "meta_description_short",
        message: `Meta description is ${p.meta_description_length} chars (< ${DESC_MIN}).`,
      })
    } else if (p.meta_description_length > DESC_MAX) {
      findings.push({
        severity: "warn",
        code: "meta_description_long",
        message: `Meta description is ${p.meta_description_length} chars (> ${DESC_MAX}). Google will truncate.`,
      })
    }
  }

  // Canonical.
  if (!p.canonical_url) {
    findings.push({
      severity: "warn",
      code: "canonical_missing",
      message: "No <link rel=\"canonical\"> — risk of duplicate-content ambiguity.",
    })
    p.canonical_ok = false
  } else {
    p.canonical_ok = canonicalsAgree(sourceUrl, p.canonical_url)
    if (!p.canonical_ok) {
      findings.push({
        severity: "warn",
        code: "canonical_mismatch",
        message: `Canonical (${p.canonical_url}) doesn't match the page URL.`,
      })
    }
  }

  // H1.
  if (p.h1_count === 0) {
    findings.push({
      severity: "error",
      code: "h1_missing",
      message: "No <h1> on the page.",
    })
  } else if (p.h1_count > 1) {
    findings.push({
      severity: "warn",
      code: "h1_multiple",
      message: `${p.h1_count} <h1> tags found. Use exactly one.`,
    })
  }

  // Images.
  if (p.image_count > 0 && p.image_missing_alt_count > 0) {
    findings.push({
      severity: "warn",
      code: "img_missing_alt",
      message: `${p.image_missing_alt_count} of ${p.image_count} <img> tags missing alt="".`,
    })
  }

  // JSON-LD validity.
  if (p.jsonld_invalid_count > 0) {
    findings.push({
      severity: "error",
      code: "jsonld_invalid",
      message: `${p.jsonld_invalid_count} JSON-LD block(s) failed JSON.parse. Google's Rich Results test will reject them.`,
    })
  }

  // OG / Twitter.
  if (!p.has_og_title) {
    findings.push({
      severity: "warn",
      code: "og_title_missing",
      message: "No og:title — social shares fall back to <title>.",
    })
  }
  if (!p.has_og_image) {
    findings.push({
      severity: "warn",
      code: "og_image_missing",
      message: "No og:image — social shares render without a card image.",
    })
  }

  // Thin content (only for non-listing pages). Pages with no <h1>
  // already error out above so we skip the thin-content check there.
  if (p.h1_count > 0 && p.word_count < 100) {
    findings.push({
      severity: "warn",
      code: "thin_content",
      message: `Only ${p.word_count} body words. Google deprioritises sub-100-word pages.`,
    })
  }

  /* ── Additional checks (Phase 6) ─────────────────────────────── */

  // HTTPS — Google has used HTTPS as a ranking signal since 2014;
  // mixed-content + Chrome's "not secure" badge tanks CTR. Treat as
  // error since a single bad route can poison the whole property.
  if (!p.is_https) {
    findings.push({
      severity: "error",
      code: "not_https",
      message: "Page is served over HTTP. Migrate to HTTPS.",
    })
  }

  // Robots noindex — usually intentional on a 404/dashboard, but a
  // noindex on a marketing/landing page is a self-inflicted ranking
  // wound. Surface as error so the operator can confirm intent.
  if (p.robots_noindex) {
    findings.push({
      severity: "error",
      code: "robots_noindex",
      message:
        'Page has <meta name="robots" content="noindex">. It will be excluded from Google\'s index.',
    })
  }

  // Mobile viewport — required for mobile-friendly designation in
  // Google's index. Missing on responsive sites is a configuration
  // miss; absent from non-responsive sites is a deeper redesign.
  if (!p.has_viewport) {
    findings.push({
      severity: "warn",
      code: "viewport_missing",
      message:
        'No <meta name="viewport"> tag. Google flags the page as not mobile-friendly.',
    })
  }

  // <html lang> — needed for hreflang signals + screen-reader pron-
  // unciation. Cheap to add, costly to miss.
  if (!p.has_lang) {
    findings.push({
      severity: "warn",
      code: "lang_missing",
      message: 'No `lang` attribute on the <html> tag.',
    })
  }

  // H2 count — content depth signal. A long-form page with only an
  // H1 looks like thin content to ranking heuristics.
  if (p.word_count > 200 && p.h2_count === 0) {
    findings.push({
      severity: "warn",
      code: "h2_missing",
      message:
        "Long-form page has no <h2> subheadings. Adds structure for users + ranking heuristics.",
    })
  }

  // Image dimensions — width+height attrs prevent CLS (Core Web Vitals
  // metric). Especially relevant for `/invest/[id]` and other image-
  // heavy pages.
  if (p.image_count > 0 && p.images_missing_dim_count > 0) {
    findings.push({
      severity: "warn",
      code: "img_dim_missing",
      message: `${p.images_missing_dim_count} of ${p.image_count} <img> tags missing explicit width+height (causes Cumulative Layout Shift).`,
    })
  }

  // Page weight — > 1.5 MB of HTML on a marketing page is enormous.
  // Server-rendered `/invest` ships ~850 KB; > 1.5 MB usually means
  // someone inlined a huge data blob or a base-64'd image.
  const KB = 1024
  if (p.response_bytes > 1_500 * KB) {
    findings.push({
      severity: "warn",
      code: "page_too_heavy",
      message: `HTML response is ${(p.response_bytes / KB).toFixed(0)} KB. Aim for under 1500 KB to keep LCP fast on mobile networks.`,
    })
  }

  // External scripts — third-party JS is the leading LCP/INP regression
  // source. >= 30 third-party scripts is excessive even for an
  // analytics-heavy storefront.
  if (p.external_script_count > 30) {
    findings.push({
      severity: "warn",
      code: "too_many_external_scripts",
      message: `${p.external_script_count} external <script> tags. Each blocks main-thread; consider lazy-load.`,
    })
  }

  // Internal-link density — too few internal links = page is a dead
  // end for crawlers + users. < 3 on a typical marketing page is a
  // sign of poor information architecture.
  if (p.word_count > 200 && p.internal_link_count < 3) {
    findings.push({
      severity: "warn",
      code: "low_internal_links",
      message: `Only ${p.internal_link_count} internal links. Add navigation/related links so crawlers can move through.`,
    })
  }

  // Schema.org coverage by route — opinionated. /invest/[id] should
  // ship Product; /knowledge/articles/[slug] should ship Article;
  // every page should ship Organization (cascaded from root layout).
  // Operator-driven; if a future route has a different schema need,
  // extend this map.
  const path = (() => {
    try {
      return new URL(sourceUrl).pathname
    } catch {
      return sourceUrl
    }
  })()
  const expectedSchemas: string[] = []
  if (/^\/invest\/[^/]+$/.test(path)) expectedSchemas.push("Product")
  if (/^\/knowledge\/articles\/[^/]+$/.test(path)) expectedSchemas.push("Article")
  for (const expected of expectedSchemas) {
    if (!p.jsonld_types.includes(expected)) {
      findings.push({
        severity: "warn",
        code: "schema_missing",
        message: `Route ${path} should emit JSON-LD @type "${expected}" but doesn't.`,
      })
    }
  }

  return findings
}

/**
 * Strict-enough canonical comparator: ignore protocol case, host case,
 * trailing slash, and query string. Anything else mismatching means
 * a real misconfig.
 */
function canonicalsAgree(a: string, b: string): boolean {
  try {
    const norm = (u: string) => {
      const url = new URL(u)
      const host = url.hostname.toLowerCase()
      const path = url.pathname.replace(/\/$/, "")
      return `${url.protocol}//${host}${path}`
    }
    return norm(a) === norm(b)
  } catch {
    return false
  }
}

/* ── Helpers ──────────────────────────────────────────────────────── */

function emptyResult(
  url: string,
  status: number,
  responseTime: number,
): Omit<
  AuditResult,
  "findings" | "html_sample" | "quality_score" | "target_keywords"
> {
  return {
    url,
    status_code: status,
    response_time_ms: responseTime,
    title: null,
    title_length: 0,
    meta_description: null,
    meta_description_length: 0,
    canonical_url: null,
    canonical_ok: false,
    h1_count: 0,
    h1_text: null,
    h2_count: 0,
    h3_count: 0,
    image_count: 0,
    image_missing_alt_count: 0,
    images_missing_dim_count: 0,
    jsonld_count: 0,
    jsonld_invalid_count: 0,
    jsonld_types: [],
    word_count: 0,
    has_og_title: false,
    has_og_image: false,
    has_twitter_card: false,
    is_https: url.startsWith("https://"),
    has_viewport: false,
    has_lang: false,
    robots_noindex: false,
    response_bytes: 0,
    external_script_count: 0,
    internal_link_count: 0,
    external_link_count: 0,
  }
}

function failedAudit(
  url: string,
  responseTime: number,
  message: string,
): AuditResult {
  const findings: AuditFinding[] = [
    {
      severity: "error",
      code: "fetch_failed",
      message: `Could not fetch the URL: ${message}`,
    },
  ]
  return {
    ...emptyResult(url, 0, responseTime),
    findings,
    quality_score: computeScore(findings),
    html_sample: null,
  }
}

async function safeReadText(res: Response, cap: number): Promise<string> {
  try {
    const text = await res.text()
    return text.slice(0, cap)
  } catch {
    return ""
  }
}
