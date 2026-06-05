/**
 * Yandex Webmaster API v4 client (OVO Phase 11).
 *
 * Endpoint reference:
 *   https://yandex.com/dev/webmaster/doc/dg/concepts/about.html
 *
 * Auth model: a Yandex OAuth token (long-lived; an operator generates
 * one via https://oauth.yandex.com → register an app → authorise → copy
 * the resulting token). Yandex calls this an "OAuth token" but it
 * behaves like an API key — passed as `Authorization: OAuth <token>`.
 *
 * Two IDs the API requires on every per-site endpoint:
 *   - `user_id`  — the Yandex account that owns the verified site
 *   - `host_id`  — opaque per-site identifier (NOT the hostname)
 *
 * We auto-discover both via the bootstrap endpoints below and cache
 * them on the OvoSetting row. The site URL is matched against
 * `unicode_host_url` because Yandex stores hosts as
 * `https:polemarch.in:443` (no slashes between protocol and host).
 *
 * Important caveats vs GSC / Bing:
 *   - Yandex's metrics granularity is DAILY but the time range is
 *     limited per request: search-queries → 7-day window, hardware
 *     30-day max, indexing-history → 14 days. We fetch the maximum
 *     window each ingest and let the service-layer dedupe by date.
 *   - Yandex's "impressions" field is `impressions` (lowercase)
 *     in v4 — earlier API versions used `shows`. Stick to v4 here.
 *   - There's no "URL inspection" equivalent — Yandex publishes only
 *     bulk indexing counts, not per-URL coverage state.
 */

const BASE = "https://api.webmaster.yandex.net/v4"
const TIMEOUT_MS = 12_000

export type YandexConfig = {
  oauth_token: string
  user_id: string
  host_id: string
  /** Cosmetic / for logs only — not used by the API. */
  site_url: string
}

/**
 * Build a `YandexConfig` from the operator-saved fields. Returns
 * `null` when any required field is missing — callers should treat
 * this as "Yandex not configured" and skip silently rather than
 * raising.
 */
export function parseYandexConfig(
  token: string | undefined | null,
  userId: string | undefined | null,
  hostId: string | undefined | null,
  siteUrl: string | undefined | null,
): YandexConfig | null {
  if (!token || !userId || !hostId) return null
  return {
    oauth_token: token,
    user_id: userId,
    host_id: hostId,
    site_url: siteUrl ?? "",
  }
}

/* ── Discovery — resolve user_id + host_id from a fresh token ─────── */

/**
 * GET /v4/user — returns `{ user_id }` for the token's owning Yandex
 * account. Stable: the user_id never changes for a given account.
 */
export async function fetchYandexUserId(token: string): Promise<string> {
  const res = await fetch(`${BASE}/user`, {
    headers: authHeaders(token),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  })
  if (!res.ok) {
    throw new Error(`yandex_user_${res.status}: ${await safeText(res)}`)
  }
  const json = (await res.json()) as { user_id?: number | string }
  if (json.user_id === undefined || json.user_id === null) {
    throw new Error("yandex_user_missing_user_id")
  }
  return String(json.user_id)
}

/**
 * GET /v4/user/{user_id}/hosts → list verified properties. We match
 * against `unicode_host_url` (Yandex's canonical form) using a
 * tolerant comparison: strip trailing slash, lowercase host, match
 * either `https://polemarch.in/` or the `https:polemarch.in:443` form.
 *
 * Returns the host_id, or null when no match exists (operator
 * needs to verify the site in Yandex Webmaster first).
 */
export async function fetchYandexHostIdForUrl(
  token: string,
  userId: string,
  siteUrl: string,
): Promise<string | null> {
  const res = await fetch(`${BASE}/user/${encodeURIComponent(userId)}/hosts`, {
    headers: authHeaders(token),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  })
  if (!res.ok) {
    throw new Error(`yandex_hosts_${res.status}: ${await safeText(res)}`)
  }
  const json = (await res.json()) as {
    hosts?: Array<{ host_id?: string; unicode_host_url?: string; ascii_host_url?: string }>
  }
  const wanted = normaliseHostUrl(siteUrl)
  for (const h of json.hosts ?? []) {
    const a = normaliseHostUrl(h.unicode_host_url || "")
    const b = normaliseHostUrl(h.ascii_host_url || "")
    if ((a && a === wanted) || (b && b === wanted)) {
      return h.host_id ?? null
    }
  }
  return null
}

/* ── Daily metric ingestion ───────────────────────────────────────── */

export type YandexDailyRow = {
  /** YYYY-MM-DD (UTC). */
  date: string
  impressions: number
  clicks: number
  /** 0..1, derived from clicks / impressions. */
  ctr: number
  /** Average SERP position. Yandex returns this per-query so we
   *  weight by impressions and average. 0 when no impressions. */
  position: number
}

/**
 * Pull search-query stats from Yandex Webmaster. Yandex returns
 * queries with per-day breakdowns. We sum across queries to get
 * daily site-level totals matching the shape of GSC's daily rows.
 *
 * Endpoint: GET /v4/user/{user_id}/hosts/{host_id}/search-queries/popular
 *
 * Yandex limits the response window — we request the max (7 days,
 * "WEEK"), called repeatedly per ingest if a longer backfill is
 * needed. For now the daily cron just pulls the last week.
 */
export async function fetchYandexDailyMetrics(
  cfg: YandexConfig,
): Promise<YandexDailyRow[]> {
  const url =
    `${BASE}/user/${encodeURIComponent(cfg.user_id)}/hosts/` +
    `${encodeURIComponent(cfg.host_id)}/search-queries/popular?` +
    `order_by=TOTAL_SHOWS&query_indicator=TOTAL_SHOWS&` +
    `query_indicator=TOTAL_CLICKS&query_indicator=AVG_SHOW_POSITION&` +
    `query_indicator=AVG_CLICK_POSITION`
  const res = await fetch(url, {
    headers: authHeaders(cfg.oauth_token),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  })
  if (!res.ok) {
    throw new Error(
      `yandex_search_queries_${res.status}: ${await safeText(res)}`,
    )
  }
  const json = (await res.json()) as {
    queries?: Array<{
      indicators?: Record<string, number>
      /** Some endpoints return per-day series under `daily_dynamics`;
       *  the `popular` endpoint returns rolled-up indicators only.
       *  We use indicating-history for the time series below. */
    }>
  }

  // The `popular` endpoint returns rolled-up indicators (TOTAL_SHOWS /
  // TOTAL_CLICKS over the default window). For per-day time series
  // we need `indicators-history` instead — call that and merge.
  const history = await fetchYandexIndicatorsHistory(cfg)
  return history
}

/**
 * GET /v4/user/{user_id}/hosts/{host_id}/indicators-history →
 * site-level rolling time series for impressions, clicks, position.
 * Daily granularity, ~14-day window.
 */
async function fetchYandexIndicatorsHistory(
  cfg: YandexConfig,
): Promise<YandexDailyRow[]> {
  const today = new Date()
  const past = new Date(today.getTime() - 14 * 24 * 60 * 60 * 1000)
  const fmt = (d: Date) => d.toISOString().slice(0, 10)
  const url =
    `${BASE}/user/${encodeURIComponent(cfg.user_id)}/hosts/` +
    `${encodeURIComponent(cfg.host_id)}/search-queries/all-history?` +
    `query_indicator=TOTAL_SHOWS&query_indicator=TOTAL_CLICKS&` +
    `query_indicator=AVG_SHOW_POSITION&` +
    `date_from=${fmt(past)}&date_to=${fmt(today)}`
  const res = await fetch(url, {
    headers: authHeaders(cfg.oauth_token),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  })
  if (!res.ok) {
    // Some Yandex Webmaster accounts haven't accumulated enough data
    // yet (typical 1-2 week warmup window). Treat 4xx as empty rather
    // than fatal so the cron keeps running on other engines.
    if (res.status >= 400 && res.status < 500) return []
    throw new Error(
      `yandex_history_${res.status}: ${await safeText(res)}`,
    )
  }
  const json = (await res.json()) as {
    indicators?: Array<{
      indicator?: string
      history?: Array<{ date?: string; value?: number }>
    }>
  }

  const byDate = new Map<
    string,
    { shows: number; clicks: number; posSum: number; posN: number }
  >()
  for (const ind of json.indicators ?? []) {
    const name = ind.indicator
    for (const h of ind.history ?? []) {
      if (!h.date) continue
      const date = h.date.slice(0, 10)
      const slot = byDate.get(date) ?? {
        shows: 0,
        clicks: 0,
        posSum: 0,
        posN: 0,
      }
      const v = Number(h.value ?? 0)
      if (name === "TOTAL_SHOWS") slot.shows += v
      else if (name === "TOTAL_CLICKS") slot.clicks += v
      else if (name === "AVG_SHOW_POSITION" && v > 0) {
        slot.posSum += v
        slot.posN += 1
      }
      byDate.set(date, slot)
    }
  }
  return Array.from(byDate.entries())
    .map(([date, b]) => ({
      date,
      impressions: b.shows,
      clicks: b.clicks,
      ctr: b.shows > 0 ? b.clicks / b.shows : 0,
      position: b.posN > 0 ? b.posSum / b.posN : 0,
    }))
    .sort((a, b) => a.date.localeCompare(b.date))
}

/* ── Top-queries dimension rollup ─────────────────────────────────── */

export type YandexTopQueryRow = {
  query: string
  impressions: number
  clicks: number
  ctr: number
  position: number
}

/**
 * GET /v4/user/{user_id}/hosts/{host_id}/search-queries/popular →
 * Yandex's "top queries" rollup. Same conceptual shape as GSC's
 * dimension query rollup, mapped onto our existing
 * `ovo_seo_dimension_rollup` table with `engine="yandex"`.
 *
 * `order_by=TOTAL_SHOWS` so the most-impressed queries come first.
 * Yandex's default page size is 30, max ~500 — we ask for `limit`
 * (clamped to 500 by Yandex internally).
 */
export async function fetchYandexTopQueries(
  cfg: YandexConfig,
  limit: number = 200,
): Promise<YandexTopQueryRow[]> {
  const url =
    `${BASE}/user/${encodeURIComponent(cfg.user_id)}/hosts/` +
    `${encodeURIComponent(cfg.host_id)}/search-queries/popular?` +
    `order_by=TOTAL_SHOWS&` +
    `query_indicator=TOTAL_SHOWS&` +
    `query_indicator=TOTAL_CLICKS&` +
    `query_indicator=AVG_SHOW_POSITION&` +
    `limit=${encodeURIComponent(String(Math.min(limit, 500)))}`
  const res = await fetch(url, {
    headers: authHeaders(cfg.oauth_token),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  })
  if (!res.ok) {
    if (res.status >= 400 && res.status < 500) return []
    throw new Error(
      `yandex_top_queries_${res.status}: ${await safeText(res)}`,
    )
  }
  const json = (await res.json()) as {
    queries?: Array<{
      query_id?: string
      query_text?: string
      indicators?: Record<string, number>
    }>
  }
  const out: YandexTopQueryRow[] = []
  for (const q of json.queries ?? []) {
    const queryText = q.query_text || q.query_id || ""
    if (!queryText) continue
    const ind = q.indicators ?? {}
    const impressions = Number(ind["TOTAL_SHOWS"] ?? 0)
    const clicks = Number(ind["TOTAL_CLICKS"] ?? 0)
    const position = Number(ind["AVG_SHOW_POSITION"] ?? 0)
    out.push({
      query: queryText,
      impressions,
      clicks,
      ctr: impressions > 0 ? clicks / impressions : 0,
      position,
    })
  }
  return out
}

/* ── Indexing summary ─────────────────────────────────────────────── */

export type YandexIndexingSummary = {
  searchable_in_search: number
  excluded_pages: number
  downloaded_pages: number
}

/**
 * GET /v4/user/{user_id}/hosts/{host_id}/summary — current site
 * health snapshot. Coarse-grained but useful for the Indexability
 * tab's "Yandex says X URLs are in their index" stat.
 */
export async function fetchYandexIndexingSummary(
  cfg: YandexConfig,
): Promise<YandexIndexingSummary> {
  const url =
    `${BASE}/user/${encodeURIComponent(cfg.user_id)}/hosts/` +
    `${encodeURIComponent(cfg.host_id)}/summary`
  const res = await fetch(url, {
    headers: authHeaders(cfg.oauth_token),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  })
  if (!res.ok) {
    throw new Error(`yandex_summary_${res.status}: ${await safeText(res)}`)
  }
  const json = (await res.json()) as {
    searchable_in_search?: number
    excluded_pages?: number
    downloaded_pages?: number
  }
  return {
    searchable_in_search: Number(json.searchable_in_search ?? 0),
    excluded_pages: Number(json.excluded_pages ?? 0),
    downloaded_pages: Number(json.downloaded_pages ?? 0),
  }
}

/* ── Sitemap submission ───────────────────────────────────────────── */

/**
 * POST /v4/user/{user_id}/hosts/{host_id}/user-added-sitemaps —
 * registers a sitemap URL with Yandex. Yandex processing queue is
 * 1-2 weeks per their own admin docs. Idempotent on URL.
 */
export async function submitSitemapToYandex(
  cfg: YandexConfig,
  feedUrl: string,
): Promise<{
  ok: boolean
  http_status: number | null
  error: string | null
  duration_ms: number
}> {
  const startedAt = Date.now()
  try {
    const url =
      `${BASE}/user/${encodeURIComponent(cfg.user_id)}/hosts/` +
      `${encodeURIComponent(cfg.host_id)}/user-added-sitemaps`
    const res = await fetch(url, {
      method: "POST",
      headers: { ...authHeaders(cfg.oauth_token), "Content-Type": "application/json" },
      body: JSON.stringify({ url: feedUrl }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
    // Yandex returns 200 on first add, 409 when the sitemap is
    // already registered. Both are "ok" from the caller's POV.
    const ok = res.ok || res.status === 409
    return {
      ok,
      http_status: res.status,
      error: ok ? null : await safeText(res),
      duration_ms: Date.now() - startedAt,
    }
  } catch (err) {
    return {
      ok: false,
      http_status: null,
      error: (err as Error).message,
      duration_ms: Date.now() - startedAt,
    }
  }
}

/* ── Helpers ──────────────────────────────────────────────────────── */

function authHeaders(token: string): Record<string, string> {
  return { Authorization: `OAuth ${token}` }
}

async function safeText(res: Response): Promise<string> {
  try {
    return (await res.text()).slice(0, 500)
  } catch {
    return `http_${res.status}`
  }
}

/**
 * Normalise any of Yandex's host-URL forms (`https:polemarch.in:443`,
 * `https://polemarch.in/`, `https://polemarch.in`) to a single
 * comparable lowercased string. Yandex's API returns the `https:`-
 * with-port form; admin-saved values usually come in as standard URLs.
 */
function normaliseHostUrl(raw: string): string {
  if (!raw) return ""
  let s = raw.trim().toLowerCase()
  // Convert Yandex's `https:polemarch.in:443` → `https://polemarch.in`
  s = s.replace(/^https?:(?!\/\/)/, (m) => m + "//")
  // Drop default ports.
  s = s.replace(/:80(\/|$)/, "$1").replace(/:443(\/|$)/, "$1")
  // Strip trailing slash.
  s = s.replace(/\/+$/, "")
  return s
}
