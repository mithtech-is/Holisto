import { model } from "@medusajs/framework/utils"

/**
 * Per-URL SEO audit snapshot. One row per public URL, replaced on
 * every nightly audit run. Powers the `/app/ovo?tab=audit` admin
 * view — a table with pass/warn/fail badges per check so ops can
 * spot real on-page regressions without leaving the dashboard.
 *
 * Why one-row-per-URL (latest only) and not a time series:
 *   - The audit answers "what's broken right now?", not "when did
 *     this break?". A simple replace-on-run keeps storage flat at
 *     ~150 rows steady state.
 *   - If a URL drops out of the sitemap (taxonomy or product
 *     deletion), its stale row gets GC'd on the next audit run.
 *
 * The `issues` JSON column carries an array of structured findings
 * per row — the UI explodes them into chips per check. Severity is
 * "error" (page is unindexable / hostile to Google) or "warn"
 * (sub-optimal but not blocking).
 *
 * `raw_html_sample` keeps the first ~2 KB of the response for
 * debugging unexpected results — only stored when an issue was
 * detected, so the table doesn't bloat with happy-path payloads.
 */
export const OvoSeoAudit = model.define("ovo_seo_audit", {
  id: model.id().primaryKey(),

  /** The audited URL (canonical hostname + path, no trailing slash
   *  normalisation — we match the sitemap value verbatim). */
  url: model.text().searchable(),

  /** When this audit row was written. The whole audit batch shares
   *  one timestamp; useful for the UI footer "last audit ran X ago". */
  audited_at: model.dateTime(),

  /** HTTP response code. < 200 / > 299 surfaces as an "error" issue. */
  status_code: model.number(),

  /** Wall-clock milliseconds for the HEAD + GET round trip. > 5s
   *  surfaces as a "warn" issue. */
  response_time_ms: model.number(),

  /** Extracted `<title>` text (trimmed). Null when missing. */
  title: model.text().nullable(),

  /** Length of `title`. 0 = missing. */
  title_length: model.number(),

  /** Extracted `<meta name="description">` content. */
  meta_description: model.text().nullable(),

  /** Length of meta description. */
  meta_description_length: model.number(),

  /** Extracted `<link rel="canonical">` href. Null when missing. */
  canonical_url: model.text().nullable(),

  /** Whether the canonical URL points at this page (ignoring query
   *  string + trailing slash). False → split-canonical bug. */
  canonical_ok: model.boolean(),

  /** Count of `<h1>` tags. Should be exactly 1. */
  h1_count: model.number(),

  /** Text content of the first `<h1>`. */
  h1_text: model.text().nullable(),

  /** Total `<img>` tags on the page. */
  image_count: model.number(),

  /** `<img>` tags missing an `alt` attribute. */
  image_missing_alt_count: model.number(),

  /** Count of <script type="application/ld+json"> blocks. */
  jsonld_count: model.number(),

  /** JSON-LD blocks that failed JSON.parse — these blow up Google's
   *  rich-results validator. */
  jsonld_invalid_count: model.number(),

  /** Detected schema.org @type values present on the page (e.g.
   *  ["Organization", "Product", "BreadcrumbList", "FAQPage"]). */
  jsonld_types: model.json().nullable(),

  /** Word count of the visible body — proxy for "thin content". */
  word_count: model.number(),

  /** OpenGraph + Twitter tag presence flags. */
  has_og_title: model.boolean(),
  has_og_image: model.boolean(),
  has_twitter_card: model.boolean(),

  /** Structured findings — array of { severity, code, message }. */
  issues: model.json(),

  /** First ~2 KB of raw HTML, only when the row has any issue. */
  raw_html_sample: model.text().nullable(),

  /** Page quality score 0-100. Composed from findings: starts at 100,
   *  -15 per error, -5 per warn. Floor 0. See `computeScore` in
   *  `lib/seo-auditor.ts`. */
  quality_score: model.number().default(100),

  /** Headings: <h2> count, <h3> count. */
  h2_count: model.number().default(0),
  h3_count: model.number().default(0),

  /** CLS-critical: <img> tags missing explicit width+height. */
  images_missing_dim_count: model.number().default(0),

  /** Served over HTTPS? */
  is_https: model.boolean().default(true),

  /** Mobile viewport meta tag present? */
  has_viewport: model.boolean().default(false),

  /** <html lang="..."> set? */
  has_lang: model.boolean().default(false),

  /** Page emits <meta name="robots" content="noindex">? */
  robots_noindex: model.boolean().default(false),

  /** Approx HTML response size in bytes. */
  response_bytes: model.number().default(0),

  /** External <script src=…> count — LCP-budget signal. */
  external_script_count: model.number().default(0),

  /** Anchor counts (same-host vs off-domain). */
  internal_link_count: model.number().default(0),
  external_link_count: model.number().default(0),

  /** Per-target-keyword presence map computed at audit time:
   *  `[{ keyword, in_title, in_h1, in_body }, ...]`. Cached so the
   *  Audit tab can render the keyword status without re-fetching. */
  target_keywords_match: model.json().nullable(),
})
