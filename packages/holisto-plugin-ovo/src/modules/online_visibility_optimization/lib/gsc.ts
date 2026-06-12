/**
 * Google Search Console push — sitemap submit + URL inspect.
 *
 * Auth is service-account JWT, signed with Node's built-in crypto.
 * No external dependency (avoids the 2MB `googleapis` package for one
 * endpoint). The service-account JSON is read from
 * `GOOGLE_GSC_SERVICE_ACCOUNT_JSON` and parsed once per call.
 *
 * Setup steps (one-time, human):
 *   1. Verify the property `your-domain.example` in Search Console (DNS TXT).
 *   2. Create a service account in Google Cloud Console.
 *   3. Add the service account email as a user on the GSC property.
 *   4. Download the JSON key, paste full JSON into
 *      `GOOGLE_GSC_SERVICE_ACCOUNT_JSON` env on the Medusa backend.
 *   5. Set `OVO_GSC_PROPERTY=https://your-domain.example/` (trailing slash).
 *
 * Endpoints used:
 *   - PUT  /webmasters/v3/sites/{siteUrl}/sitemaps/{feedpath}
 *           → submit / refresh a sitemap
 *   - POST /v1/urlInspection/index:inspect
 *           → inspect a single URL's indexability
 */

import { createSign } from "node:crypto"
import type { GscConfig, SubmissionResult } from "./types"

const TOKEN_URL = "https://oauth2.googleapis.com/token"
const WEBMASTERS_BASE = "https://www.googleapis.com/webmasters/v3"
const INSPECTION_BASE = "https://searchconsole.googleapis.com/v1"
const SCOPE = "https://www.googleapis.com/auth/webmasters"
const TIMEOUT_MS = 12_000

/**
 * Parse a service-account JSON env-var string into the minimal GscConfig
 * we need. Returns null if the JSON is missing / malformed — callers
 * surface that as a "skipped" submission so admins can see "GSC not
 * configured" without the route 500ing.
 */
export function parseGscConfig(
  serviceAccountJson: string | undefined,
  siteUrl: string | undefined,
): GscConfig | null {
  if (!serviceAccountJson || !siteUrl) return null
  try {
    const parsed = JSON.parse(serviceAccountJson) as {
      client_email?: string
      private_key?: string
    }
    if (!parsed.client_email || !parsed.private_key) return null
    return {
      service_account_email: parsed.client_email,
      private_key: parsed.private_key.replace(/\\n/g, "\n"),
      site_url: siteUrl,
    }
  } catch {
    return null
  }
}

/**
 * Submit a sitemap to Google. The `feedpath` is the absolute URL of
 * the sitemap file. Returns a structured SubmissionResult that the
 * service can persist.
 */
export async function submitSitemapToGsc(
  cfg: GscConfig,
  feedpath: string,
): Promise<SubmissionResult> {
  const startedAt = Date.now()
  try {
    const token = await getAccessToken(cfg)
    const url = `${WEBMASTERS_BASE}/sites/${encodeURIComponent(
      cfg.site_url,
    )}/sitemaps/${encodeURIComponent(feedpath)}`
    const res = await fetch(url, {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${token}`,
      },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
    return {
      destination: "gsc",
      action: "submit-sitemap",
      target: feedpath,
      url_count: 1,
      status: res.ok ? "success" : "error",
      http_status: res.status,
      error_message: res.ok ? null : await safeReadText(res),
      duration_ms: Date.now() - startedAt,
    }
  } catch (err) {
    return {
      destination: "gsc",
      action: "submit-sitemap",
      target: feedpath,
      url_count: 1,
      status: "error",
      http_status: null,
      error_message: (err as Error).message,
      duration_ms: Date.now() - startedAt,
    }
  }
}

/**
 * Inspect a single URL's index status. Useful for the admin "is this
 * page indexed?" check on top product pages.
 */
export async function inspectUrlOnGsc(
  cfg: GscConfig,
  inspectionUrl: string,
): Promise<SubmissionResult & { coverage?: string | null }> {
  const startedAt = Date.now()
  try {
    const token = await getAccessToken(cfg)
    const res = await fetch(`${INSPECTION_BASE}/urlInspection/index:inspect`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        inspectionUrl,
        siteUrl: cfg.site_url,
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
    if (!res.ok) {
      return {
        destination: "gsc",
        action: "inspect-url",
        target: inspectionUrl,
        url_count: 1,
        status: "error",
        http_status: res.status,
        error_message: await safeReadText(res),
        duration_ms: Date.now() - startedAt,
      }
    }
    const json = (await res.json()) as {
      inspectionResult?: {
        indexStatusResult?: {
          coverageState?: string
        }
      }
    }
    const coverage =
      json.inspectionResult?.indexStatusResult?.coverageState ?? null
    return {
      destination: "gsc",
      action: "inspect-url",
      target: inspectionUrl,
      url_count: 1,
      status: "success",
      http_status: res.status,
      error_message: null,
      duration_ms: Date.now() - startedAt,
      coverage,
    }
  } catch (err) {
    return {
      destination: "gsc",
      action: "inspect-url",
      target: inspectionUrl,
      url_count: 1,
      status: "error",
      http_status: null,
      error_message: (err as Error).message,
      duration_ms: Date.now() - startedAt,
    }
  }
}

/* ── Per-URL index inspection (Phase 7.A) ─────────────────────────── */

/**
 * Full structured response from GSC's URL Inspection API. Same
 * endpoint as `inspectUrlOnGsc` (used by the manual "inspect URL"
 * button on the Submit tab), but we keep every field instead of
 * collapsing to the coverage string — the URL-index admin tab
 * surfaces page-fetch state, robots state, rich-results verdict, etc.
 *
 * Quota: 2000 inspections / property / day. The daily 08:00 UTC cron
 * walks the ~150-URL sitemap with 12x headroom.
 *
 * Returns null when the inspection itself fails (non-success HTTP,
 * timeout, malformed payload). Caller persists a placeholder row so
 * the admin can see "couldn't inspect" rather than silently missing.
 */
export type UrlIndexInspection = {
  url: string
  verdict: string
  coverage_state: string | null
  last_crawl_time: string | null
  page_fetch_state: string | null
  robots_txt_state: string | null
  indexing_state: string | null
  mobile_usability_verdict: string | null
  rich_results_verdict: string | null
  google_canonical: string | null
  is_indexed: boolean
  is_blocked_by_robots: boolean
  has_mobile_issues: boolean
  raw: unknown
}

export async function fetchGscUrlIndex(
  cfg: GscConfig,
  inspectionUrl: string,
): Promise<UrlIndexInspection | null> {
  try {
    const token = await getAccessToken(cfg)
    const res = await fetch(`${INSPECTION_BASE}/urlInspection/index:inspect`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        inspectionUrl,
        siteUrl: cfg.site_url,
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
    if (!res.ok) return null
    const json = (await res.json()) as {
      inspectionResult?: {
        indexStatusResult?: {
          verdict?: string
          coverageState?: string
          lastCrawlTime?: string
          pageFetchState?: string
          robotsTxtState?: string
          indexingState?: string
          googleCanonical?: string
        }
        mobileUsabilityResult?: { verdict?: string }
        richResultsResult?: { verdict?: string }
      }
    }
    const inspection = json.inspectionResult ?? {}
    const idx = inspection.indexStatusResult ?? {}
    const verdict = idx.verdict ?? "VERDICT_UNSPECIFIED"
    const coverage = idx.coverageState ?? null
    return {
      url: inspectionUrl,
      verdict,
      coverage_state: coverage,
      last_crawl_time: idx.lastCrawlTime ?? null,
      page_fetch_state: idx.pageFetchState ?? null,
      robots_txt_state: idx.robotsTxtState ?? null,
      indexing_state: idx.indexingState ?? null,
      mobile_usability_verdict:
        inspection.mobileUsabilityResult?.verdict ?? null,
      rich_results_verdict: inspection.richResultsResult?.verdict ?? null,
      google_canonical: idx.googleCanonical ?? null,
      // Derived booleans for fast admin filtering.
      is_indexed:
        verdict === "PASS" ||
        (typeof coverage === "string" && /indexed/i.test(coverage)),
      is_blocked_by_robots:
        idx.robotsTxtState === "DISALLOWED" ||
        (typeof coverage === "string" && /blocked/i.test(coverage)),
      has_mobile_issues:
        inspection.mobileUsabilityResult?.verdict === "FAIL",
      raw: json,
    }
  } catch {
    return null
  }
}

/* ── Daily metric ingestion ───────────────────────────────────────── */

/**
 * One day's worth of search-analytics for a property. Sums across all
 * queries / pages / countries / devices — one number per metric.
 *
 * Why aggregate (no dimensions): we only need site-level daily trends
 * for the metrics chart. Per-query breakdown lives in GSC's UI; we'd
 * have to paginate aggressively to mirror it here and the storage cost
 * jumps from O(days) to O(days × queries × pages × countries).
 *
 * `date` returned is the UTC calendar date the snapshot represents.
 */
export type GscDailyRow = {
  date: string // YYYY-MM-DD
  impressions: number
  clicks: number
  ctr: number
  position: number
}

/**
 * Fetch daily search-analytics for the last `daysBack` UTC days from
 * GSC's `searchanalytics.query` endpoint. The endpoint has a ~2-day
 * lag (GSC publishes "yesterday" no earlier than +18h) so callers
 * who pass `daysBack = 7` get back rows for `date` ∈ [today-9, today-2].
 *
 * Returns one row per day GSC has data for. Missing days (recent ones
 * still in lag) are simply absent — the caller upserts so partial fills
 * are idempotent on the next run.
 *
 * Throws on auth / network / 5xx. Caller wraps in try/catch + persists
 * an `ovo_submission_log` row with status="error".
 */
export async function fetchGscDailyMetrics(
  cfg: GscConfig,
  daysBack: number = 30,
): Promise<GscDailyRow[]> {
  const token = await getAccessToken(cfg)

  // ISO date helpers — GSC accepts YYYY-MM-DD inclusive bounds.
  const now = new Date()
  const endDate = new Date(now.getTime() - 2 * 24 * 60 * 60 * 1000)
  const startDate = new Date(now.getTime() - (daysBack + 2) * 24 * 60 * 60 * 1000)
  const toIso = (d: Date) => d.toISOString().slice(0, 10)

  const url = `${WEBMASTERS_BASE}/sites/${encodeURIComponent(
    cfg.site_url,
  )}/searchAnalytics/query`

  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      startDate: toIso(startDate),
      endDate: toIso(endDate),
      dimensions: ["date"],
      rowLimit: 1000,
      dataState: "all", // include final + fresh (partial) days
    }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  })
  if (!res.ok) {
    throw new Error(
      `gsc_search_analytics_${res.status}: ${await safeReadText(res)}`,
    )
  }
  const json = (await res.json()) as {
    rows?: Array<{
      keys: string[]
      clicks: number
      impressions: number
      ctr: number
      position: number
    }>
  }
  const rows = json.rows ?? []
  return rows.map((r) => ({
    date: r.keys[0],
    impressions: r.impressions,
    clicks: r.clicks,
    ctr: r.ctr,
    position: r.position,
  }))
}

/**
 * Fetch the GSC index-coverage summary for the property.
 *
 * Implementation note: GSC doesn't expose a clean "total indexed
 * pages" number via the public API as of late 2025 — the Index Coverage
 * report is GSC-UI-only. The closest proxy through the API is a
 * `searchAnalytics.query` with `dataState=all` over a 16-month window
 * filtered to pages with impressions; pages with zero impressions are
 * excluded. This is an under-estimate of true indexed-page count but
 * captures the "indexed AND surfaced" subset which is what actually
 * matters for traffic.
 *
 * Better alternatives we deliberately skip:
 *   - GSC URL Inspection API per-URL — too slow at scale
 *     (2000 req/day quota, 148 URLs would take a week to refresh)
 *   - Scraping the GSC UI — fragile + violates ToS
 *
 * Returns the count, or null when the call fails (caller surfaces
 * "indexed_pages: unavailable" rather than crashing the cron).
 */
export async function fetchGscIndexedSurfacedCount(
  cfg: GscConfig,
): Promise<number | null> {
  try {
    const token = await getAccessToken(cfg)
    const url = `${WEBMASTERS_BASE}/sites/${encodeURIComponent(
      cfg.site_url,
    )}/searchAnalytics/query`
    // 16-month window — GSC's full data horizon.
    const endDate = new Date()
    const startDate = new Date(endDate.getTime() - 480 * 24 * 60 * 60 * 1000)
    const toIso = (d: Date) => d.toISOString().slice(0, 10)
    const res = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        startDate: toIso(startDate),
        endDate: toIso(endDate),
        dimensions: ["page"],
        rowLimit: 25000,
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
    if (!res.ok) return null
    const json = (await res.json()) as { rows?: Array<{ keys: string[] }> }
    return (json.rows ?? []).length
  } catch {
    return null
  }
}

/* ── Dimension rollups + query history ────────────────────────────── */

/**
 * One row of a dimension-rollup snapshot. Returned by
 * `fetchGscDimensionRollup`. Order in the returned array matches GSC's
 * default ranking (clicks descending).
 */
export type GscDimensionRow = {
  dimension_value: string
  impressions: number
  clicks: number
  ctr: number
  position: number
}

/**
 * Top-N snapshot for a single GSC search-analytics dimension over a
 * rolling window. We use this for the "top queries / top pages / top
 * countries / top devices" tables in the OVO metrics tab.
 *
 * `dimension` is one of "query", "page", "country", "device" (GSC's
 * supported single-key dimensions for `searchAnalytics.query`).
 *
 * The endpoint counts each (dimension_value, date) cell once and sums
 * across dates — so a 28-day window with a query that ranked 1× per
 * day comes back as one row with `clicks = 28×daily`. We get back the
 * top `rowLimit` rows sorted by clicks descending automatically.
 *
 * Throws on auth / 5xx — caller wraps in try/catch and writes a
 * `ovo_submission_log` row for visibility.
 */
export async function fetchGscDimensionRollup(
  cfg: GscConfig,
  dimension: "query" | "page" | "country" | "device",
  windowDays: number = 28,
  rowLimit: number = 200,
): Promise<GscDimensionRow[]> {
  const token = await getAccessToken(cfg)

  // GSC has a 1-3 day lag on finalised data. Backing the window off
  // by 2 days keeps the rollup stable; the next day's run picks up
  // any fresh partials via `dataState: "all"`.
  const now = new Date()
  const endDate = new Date(now.getTime() - 2 * 24 * 60 * 60 * 1000)
  const startDate = new Date(
    now.getTime() - (windowDays + 2) * 24 * 60 * 60 * 1000,
  )
  const toIso = (d: Date) => d.toISOString().slice(0, 10)

  const url = `${WEBMASTERS_BASE}/sites/${encodeURIComponent(
    cfg.site_url,
  )}/searchAnalytics/query`

  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      startDate: toIso(startDate),
      endDate: toIso(endDate),
      dimensions: [dimension],
      rowLimit,
      dataState: "all",
    }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  })
  if (!res.ok) {
    throw new Error(
      `gsc_search_analytics_${dimension}_${res.status}: ${await safeReadText(res)}`,
    )
  }
  const json = (await res.json()) as {
    rows?: Array<{
      keys: string[]
      clicks: number
      impressions: number
      ctr: number
      position: number
    }>
  }
  const rows = json.rows ?? []
  return rows.map((r) => ({
    dimension_value: r.keys[0] ?? "",
    impressions: r.impressions,
    clicks: r.clicks,
    ctr: r.ctr,
    position: r.position,
  }))
}

/**
 * One row of per-(query, date) history. Returned by
 * `fetchGscQueryHistory`. The caller groups by query for the rank
 * trend chart.
 */
export type GscQueryHistoryRow = {
  query: string
  date: string // YYYY-MM-DD
  impressions: number
  clicks: number
  ctr: number
  position: number
}

/**
 * Per-(query, date) traffic + rank for the last `daysBack` UTC days.
 * Used by the OVO metrics tab to chart the rank trend of any tracked
 * query over time.
 *
 * Implementation: ONE GSC API call with `dimensions=["query","date"]`
 * and a high `rowLimit` (default 5000). GSC returns up to that many
 * rows sorted by clicks descending. Long-tail queries with one
 * impression get truncated — that's fine, they wouldn't have a useful
 * trend line anyway.
 *
 * Quota cost: 1 call/day regardless of how many queries we display.
 * Multiple calls (one per query) would be the alternative and would
 * burn quota linearly with the number of tracked queries.
 */
export async function fetchGscQueryHistory(
  cfg: GscConfig,
  daysBack: number = 30,
  rowLimit: number = 5000,
): Promise<GscQueryHistoryRow[]> {
  const token = await getAccessToken(cfg)

  const now = new Date()
  const endDate = new Date(now.getTime() - 2 * 24 * 60 * 60 * 1000)
  const startDate = new Date(now.getTime() - (daysBack + 2) * 24 * 60 * 60 * 1000)
  const toIso = (d: Date) => d.toISOString().slice(0, 10)

  const url = `${WEBMASTERS_BASE}/sites/${encodeURIComponent(
    cfg.site_url,
  )}/searchAnalytics/query`

  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      startDate: toIso(startDate),
      endDate: toIso(endDate),
      dimensions: ["query", "date"],
      rowLimit,
      dataState: "all",
    }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  })
  if (!res.ok) {
    throw new Error(
      `gsc_query_history_${res.status}: ${await safeReadText(res)}`,
    )
  }
  const json = (await res.json()) as {
    rows?: Array<{
      keys: string[]
      clicks: number
      impressions: number
      ctr: number
      position: number
    }>
  }
  const rows = json.rows ?? []
  return rows
    .map((r) => ({
      query: r.keys[0] ?? "",
      date: r.keys[1] ?? "",
      impressions: r.impressions,
      clicks: r.clicks,
      ctr: r.ctr,
      position: r.position,
    }))
    .filter((r) => r.query && r.date)
}

/* ── service-account JWT auth ─────────────────────────────────────── */

/**
 * Exchange a service-account JWT assertion for an OAuth access token.
 * Token TTL is 3600s — for simplicity we don't cache; submit-sitemap
 * is called on-demand or once daily, so the per-call token mint is
 * fine. If we ever bulk-inspect dozens of URLs we'll wrap with a
 * 50-minute in-memory cache.
 */
async function getAccessToken(cfg: GscConfig): Promise<string> {
  const now = Math.floor(Date.now() / 1000)
  const header = base64UrlJson({ alg: "RS256", typ: "JWT" })
  const claims = base64UrlJson({
    iss: cfg.service_account_email,
    scope: SCOPE,
    aud: TOKEN_URL,
    iat: now,
    exp: now + 3600,
  })
  const signingInput = `${header}.${claims}`
  const signer = createSign("RSA-SHA256")
  signer.update(signingInput)
  signer.end()
  const signature = signer.sign(cfg.private_key)
  const jwt = `${signingInput}.${base64UrlBuf(signature)}`

  const params = new URLSearchParams({
    grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
    assertion: jwt,
  })

  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: params.toString(),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  })
  if (!res.ok) {
    throw new Error(`gsc_token_${res.status}: ${await safeReadText(res)}`)
  }
  const json = (await res.json()) as { access_token?: string }
  if (!json.access_token) {
    throw new Error("gsc_token_no_access_token")
  }
  return json.access_token
}

function base64UrlJson(obj: unknown): string {
  return base64UrlBuf(Buffer.from(JSON.stringify(obj), "utf8"))
}

function base64UrlBuf(buf: Buffer): string {
  return buf
    .toString("base64")
    .replace(/=+$/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
}

async function safeReadText(res: Response): Promise<string> {
  try {
    return (await res.text()).slice(0, 500)
  } catch {
    return `http_${res.status}`
  }
}
