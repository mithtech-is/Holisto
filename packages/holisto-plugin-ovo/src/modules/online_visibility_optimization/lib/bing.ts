/**
 * Bing Webmaster Tools push — sitemap submit + URL batch submit.
 *
 * IndexNow already covers Bing for URL push, so we only use the
 * `SubmitSitemap` endpoint here (IndexNow doesn't accept sitemaps).
 *
 * Auth is a simple API key passed as `apikey` query param. No OAuth.
 * Get the key at https://www.bing.com/webmasters/ → Settings →
 * API Access.
 *
 * Endpoint reference: https://learn.microsoft.com/en-us/bingwebmaster/
 */

import type { BingConfig, SubmissionResult } from "./types"

const BASE = "https://ssl.bing.com/webmaster/api.svc/json"
const TIMEOUT_MS = 8_000

export function parseBingConfig(
  apiKey: string | undefined,
  siteUrl: string | undefined,
): BingConfig | null {
  if (!apiKey || !siteUrl) return null
  return { api_key: apiKey, site_url: siteUrl }
}

export async function submitSitemapToBing(
  cfg: BingConfig,
  feedUrl: string,
): Promise<SubmissionResult> {
  const startedAt = Date.now()
  try {
    const url = `${BASE}/SubmitFeed?apikey=${encodeURIComponent(cfg.api_key)}`
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        siteUrl: cfg.site_url,
        feedUrl,
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
    return {
      destination: "bing",
      action: "submit-sitemap",
      target: feedUrl,
      url_count: 1,
      status: res.ok ? "success" : "error",
      http_status: res.status,
      error_message: res.ok ? null : await safeReadText(res),
      duration_ms: Date.now() - startedAt,
    }
  } catch (err) {
    return {
      destination: "bing",
      action: "submit-sitemap",
      target: feedUrl,
      url_count: 1,
      status: "error",
      http_status: null,
      error_message: (err as Error).message,
      duration_ms: Date.now() - startedAt,
    }
  }
}

/* ── Daily metric ingestion ───────────────────────────────────────── */

/**
 * Bing Webmaster's `GetQueryStats` returns up to 26 weeks of weekly
 * (not daily) aggregated query stats. We sum across queries to get
 * weekly site-level totals.
 *
 * Important caveats vs GSC:
 *   - Granularity is WEEKLY (Date is the Monday of the ISO week).
 *     We map each Bing row to that Monday's date when persisting.
 *   - No per-day breakdown via this endpoint. The metrics chart shows
 *     weekly points for Bing alongside daily lines from GSC — clearly
 *     labelled.
 *   - Bing's `AvgImpressionPosition` is 1-based like GSC's; we just
 *     pass it through. CTR is derived from clicks / impressions.
 */
export type BingWeeklyRow = {
  /** Monday of the ISO week, YYYY-MM-DD (UTC). */
  date: string
  impressions: number
  clicks: number
  /** 0..1 derived from clicks / impressions. */
  ctr: number
  /** Average SERP position from Bing's `AvgImpressionPosition`. */
  position: number
}

/**
 * Pull weekly query stats from Bing Webmaster. Each entry is summed
 * across all queries that drove impressions to the site that week.
 *
 * Endpoint: GET /GetQueryStats?siteUrl=...&apikey=...
 *
 * Bing's API has been stable for years but DOES drop fields silently
 * when no data exists. We coalesce missing fields to 0.
 */
export async function fetchBingWeeklyMetrics(
  cfg: BingConfig,
): Promise<BingWeeklyRow[]> {
  const url = `${BASE}/GetQueryStats?siteUrl=${encodeURIComponent(
    cfg.site_url,
  )}&apikey=${encodeURIComponent(cfg.api_key)}`
  const res = await fetch(url, {
    method: "GET",
    signal: AbortSignal.timeout(TIMEOUT_MS),
  })
  if (!res.ok) {
    throw new Error(`bing_query_stats_${res.status}: ${await safeReadText(res)}`)
  }
  const json = (await res.json()) as {
    d?: Array<{
      Date?: string
      Query?: string
      Impressions?: number
      Clicks?: number
      AvgImpressionPosition?: number
    }>
  }
  const raw = json.d ?? []

  const buckets = new Map<
    string,
    { impressions: number; clicks: number; positionSum: number; n: number }
  >()
  for (const r of raw) {
    const date = parseBingDate(r.Date)
    if (!date) continue
    const key = mondayOf(date).toISOString().slice(0, 10)
    const b = buckets.get(key) ?? {
      impressions: 0,
      clicks: 0,
      positionSum: 0,
      n: 0,
    }
    b.impressions += Number(r.Impressions ?? 0)
    b.clicks += Number(r.Clicks ?? 0)
    const pos = Number(r.AvgImpressionPosition ?? 0)
    if (pos > 0) {
      b.positionSum += pos
      b.n += 1
    }
    buckets.set(key, b)
  }

  return Array.from(buckets.entries())
    .map(([date, b]) => ({
      date,
      impressions: b.impressions,
      clicks: b.clicks,
      ctr: b.impressions > 0 ? b.clicks / b.impressions : 0,
      position: b.n > 0 ? b.positionSum / b.n : 0,
    }))
    .sort((a, b) => a.date.localeCompare(b.date))
}

/**
 * Crawl stats: Bing's `GetCrawlStats` returns daily crawl counts +
 * HTTP-status breakdown. Surfaces 4xx / 5xx error totals per day.
 */
export type BingCrawlSummary = {
  /** YYYY-MM-DD (UTC). */
  date: string
  total_crawled: number
  errors_4xx: number
  errors_5xx: number
}

export async function fetchBingCrawlSummary(
  cfg: BingConfig,
): Promise<BingCrawlSummary[]> {
  const url = `${BASE}/GetCrawlStats?siteUrl=${encodeURIComponent(
    cfg.site_url,
  )}&apikey=${encodeURIComponent(cfg.api_key)}`
  const res = await fetch(url, {
    method: "GET",
    signal: AbortSignal.timeout(TIMEOUT_MS),
  })
  if (!res.ok) {
    throw new Error(`bing_crawl_stats_${res.status}: ${await safeReadText(res)}`)
  }
  const json = (await res.json()) as {
    d?: Array<{
      Date?: string
      CrawledPages?: number
      HttpResponseCode4xxPages?: number
      HttpResponseCode5xxPages?: number
    }>
  }
  return (json.d ?? [])
    .map((r) => {
      const date = parseBingDate(r.Date)
      if (!date) return null
      return {
        date: date.toISOString().slice(0, 10),
        total_crawled: Number(r.CrawledPages ?? 0),
        errors_4xx: Number(r.HttpResponseCode4xxPages ?? 0),
        errors_5xx: Number(r.HttpResponseCode5xxPages ?? 0),
      }
    })
    .filter((r): r is BingCrawlSummary => r !== null)
    .sort((a, b) => a.date.localeCompare(b.date))
}

/** Bing returns timestamps as `/Date(1715126400000)/` strings. Parse
 *  the epoch ms safely; fall back to ISO parsing; return null on
 *  malformed input. */
function parseBingDate(raw: string | undefined): Date | null {
  if (!raw) return null
  const m = /\/Date\((\d+)\)\//.exec(raw)
  if (m) {
    const ms = Number(m[1])
    return Number.isFinite(ms) ? new Date(ms) : null
  }
  const d = new Date(raw)
  return Number.isFinite(d.getTime()) ? d : null
}

/** Monday of the ISO week containing `d`, in UTC. */
function mondayOf(d: Date): Date {
  const out = new Date(d.getTime())
  out.setUTCHours(0, 0, 0, 0)
  const dow = out.getUTCDay() // 0 = Sun, 1 = Mon, …
  const shift = dow === 0 ? -6 : 1 - dow
  out.setUTCDate(out.getUTCDate() + shift)
  return out
}

async function safeReadText(res: Response): Promise<string> {
  try {
    return (await res.text()).slice(0, 500)
  } catch {
    return `http_${res.status}`
  }
}
