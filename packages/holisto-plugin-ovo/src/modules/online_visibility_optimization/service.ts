// @ts-nocheck
import { MedusaService } from "@medusajs/framework/utils"
import { OvoSetting } from "./models/ovo-setting"
import { OvoOverride } from "./models/ovo-override"
import { OvoSubmissionLog } from "./models/ovo-submission-log"
import { OvoSeoMetric } from "./models/ovo-seo-metric"
import { OvoSeoDimensionRollup } from "./models/ovo-seo-dimension-rollup"
import { OvoSeoQueryHistory } from "./models/ovo-seo-query-history"
import { OvoSeoAudit } from "./models/ovo-seo-audit"
import { OvoSeoAuditRun } from "./models/ovo-seo-audit-run"
import { OvoSeoAuditHistory } from "./models/ovo-seo-audit-history"
import { OvoSeoKeywordTarget } from "./models/ovo-seo-keyword-target"
import { OvoSeoKeywordGroup } from "./models/ovo-seo-keyword-group"
import { OvoSeoKeywordPerfSnapshot } from "./models/ovo-seo-keyword-perf-snapshot"
import { OvoSeoUrlIndex } from "./models/ovo-seo-url-index"
import { OvoAiPrompt } from "./models/ovo-ai-prompt"
import { OvoAiCitation } from "./models/ovo-ai-citation"
import { DEFAULT_OVO, DEMO_OVO } from "./seed/default-ovo"
import { isDemoMode, setModuleOptions } from "./lib/options"
import { resolveDefaultSiteUrl } from "./lib/site"
export { resolveDefaultSiteUrl }
import {
  normalizeKeyword,
  tryNormalizeKeyword,
  KeywordNormalisationError,
} from "./lib/keyword-normalizer"
import {
  classifyIntent,
  type SearchIntent,
} from "./lib/intent-classifier"
import { pushUrlsToIndexNow } from "./lib/indexnow"
import {
  inspectUrlOnGsc,
  parseGscConfig,
  submitSitemapToGsc,
  fetchGscDailyMetrics,
  fetchGscIndexedSurfacedCount,
  fetchGscDimensionRollup,
  fetchGscQueryHistory,
  fetchGscUrlIndex,
} from "./lib/gsc"
import {
  fetchBingWeeklyMetrics,
  fetchBingCrawlSummary,
  parseBingConfig,
  submitSitemapToBing,
} from "./lib/bing"
// SpaceSerp rank-tracker removed (Migration20260515220000) — provider
// went silent in 2025; see the migration file for the timeline.
import {
  encryptString,
  decryptString,
  last4,
} from "./lib/crypto"
import {
  fetchAllSitemapUrls,
  fetchAllSitemapEntries,
} from "./lib/sitemap-fetcher"
import { suggestImageAltsForPage } from "./lib/image-alt-suggester"
import { auditUrl, type AuditResult } from "./lib/seo-auditor"
import { askOpenAI } from "./lib/ai-citation/openai"
import { askAnthropic } from "./lib/ai-citation/anthropic"
import { askPerplexity } from "./lib/ai-citation/perplexity"
import { askGemini } from "./lib/ai-citation/gemini"
import { extractSignals } from "./lib/ai-citation/extract"
import type { BrandMatchConfig } from "./lib/ai-citation/types"
import type { AiAnswer, AiProvider } from "./lib/ai-citation/types"
import { DEFAULT_AI_PROMPTS, DEMO_AI_PROMPTS } from "./seed/default-ai-prompts"
import type {
  SubmissionDestination,
  SubmissionDestinationKey,
  SubmissionDestinationStats,
  SubmissionResult,
} from "./lib/types"

export type {
  SubmissionDestination,
  SubmissionDestinationKey,
  SubmissionDestinationStats,
  SubmissionResult,
  SubmissionAction,
  SubmissionStatus,
  SubmissionDayBucket,
} from "./lib/types"

/** Entity types accepted in override CRUD. Loose-typed in the model
 *  for forward compatibility but validated at the service boundary.
 *
 *  - "product"          — keyed by Medusa Product id
 *  - "category"         — keyed by Medusa ProductCategory id
 *  - "page"             — keyed by storefront URL path (e.g. "/", "/pricing").
 *                         Lets admins layer FAQ + custom JSON-LD onto
 *                         marketing + knowledge pages that don't have a
 *                         Medusa entity.
 *
 *  Phase 2+ additions (host content engine). All keyed by the
 *  corresponding `pc_*` row id. The override surface is identical —
 *  same OvoOverride table, same admin UI — only the resolver in the
 *  storefront layer differs.
 *
 *  - "content_page"     — keyed by `pc_content_page.id`
 *  - "content_category" — keyed by `pc_content_category.id`
 *  - "comparison"       — keyed by `pc_comparison.id`
 *  - "valuation"        — keyed by `pc_valuation_page.id`
 *  - "tool"             — keyed by `pc_tool_page.id`
 */

export type OvoKeywordOpportunityType =
  | "losing_position"
  | "striking_distance"
  | "ctr_optimization"
  | "position_climbing"

export type OvoKeywordOpportunity = {
  target_id: string
  keyword: string
  keyword_group_id: string | null
  url: string | null
  opportunity_type: OvoKeywordOpportunityType
  current_position: number | null
  avg_position_14d: number | null
  impressions_14d: number
  clicks_14d: number
  ctr_14d: number
  impressions_slope: number
  position_delta_7d: number | null
  reason: string
}

export type OvoCannibalizationRow = {
  query: string
  normalized_query: string
  severity: "high" | "medium" | "low"
  primary_url: string | null
  primary_position: number | null
  primary_clicks: number
  primary_impressions: number
  competing_urls: Array<{
    url: string
    clicks: number
    impressions: number
    position: number
  }>
  total_impressions: number
  keyword_group_id: string | null
  tracked_target_id: string | null
}

export type OvoSitemapShardCount = {
  shard: string
  url: string
  count: number
  ok: boolean
  error?: string
}

export const OVO_ENTITY_TYPES = [
  "product",
  "category",
  "page",
  "content_page",
  "content_category",
  "comparison",
  "valuation",
  "tool",
] as const
export type OvoEntityType = (typeof OVO_ENTITY_TYPES)[number]

/**
 * Admin-facing snapshot of external-API credential state. Never carries
 * plaintext values — only `configured` (any source), `source` (which
 * one), and `last4` (last 4 chars of the resolved plaintext, for drift
 * detection).
 *
 * The `*_site_url` fields are NOT secrets and are returned as plaintext
 * since they need to be visible for the admin to verify they point at
 * the right property.
 */
export type ApiCredentialsView = {
  gsc_service_account_json: CredentialFieldSummary
  bing_api_key: CredentialFieldSummary
  openai_api_key: CredentialFieldSummary
  anthropic_api_key: CredentialFieldSummary
  perplexity_api_key: CredentialFieldSummary
  google_ai_api_key: CredentialFieldSummary
  /** Plaintext — these are not secrets. */
  gsc_site_url: string | null
  bing_site_url: string | null
  // Yandex Webmaster + CrUX are not bundled in this version; the admin UI
  // renders these sections, so the view always reports them as
  // not-configured (never undefined) to keep the UI from crashing.
  yandex_oauth_token: CredentialFieldSummary
  yandex_user_id: string | null
  yandex_host_id: string | null
  crux_api_key: CredentialFieldSummary
}

export type CredentialFieldSummary = {
  configured: boolean
  source: "db" | "env" | "none"
  last4: string | null
}

/**
 * Online Visibility Optimization (OVO) module service.
 *
 * Owns: a single `ovo_setting` row holding every channel toggle and the
 * structured copy that drives the storefront's visibility surfaces
 * (metadata, JSON-LD, robots.txt, sitemap shards, /llms.txt, …).
 *
 * Two read shapes:
 *   - `getSettingsView()` returns the full row for the admin UI.
 *   - `getPublicView()` returns the storefront-safe projection (drops
 *     `updated_by_user_id` and any internal-only fields).
 *
 * Lazy-creates the row with `DEFAULT_OVO` on first read so a fresh
 * install behaves byte-identically to the pre-OVO storefront.
 */
class OvoService extends MedusaService({
  OvoSetting,
  OvoOverride,
  OvoSubmissionLog,
  OvoSeoMetric,
  OvoSeoDimensionRollup,
  OvoSeoQueryHistory,
  OvoSeoAudit,
  OvoSeoAuditRun,
  OvoSeoAuditHistory,
  OvoSeoKeywordTarget,
  OvoSeoKeywordGroup,
  OvoSeoKeywordPerfSnapshot,
  OvoSeoUrlIndex,
  OvoAiPrompt,
  OvoAiCitation,
}) {
  /**
   * Capture the plugin/module options (e.g. `{ demo_mode, max_audit_urls,
   * ... }`) so option-driven behaviour works in addition to env vars.
   * Defensive: never let option plumbing break module construction.
   */
  constructor(...args: any[]) {
    super(args[0])
    try {
      setModuleOptions(args[1])
    } catch {
      /* options are optional — env vars still drive behaviour */
    }
  }

  static readonly SINGLETON_KEY = "default"

  /** Retention horizon for daily SEO metrics. Older rows are pruned by
   *  the daily cron after a fresh insert. 2 years keeps trend lines
   *  useful without unbounded growth. */
  static readonly SEO_METRIC_RETENTION_DAYS = 730

  /** Retention horizon for per-(query, date) history. 90 days catches
   *  short-cycle product / content launches; older rows age out via the
   *  daily prune. GSC's UI retains 16 months; if we need that depth we
   *  can lift this number without re-ingesting (just wait for the
   *  history to accumulate). */
  static readonly SEO_QUERY_HISTORY_RETENTION_DAYS = 90

  /** Hard cap on log rows kept in `ovo_submission_log`. Older rows
   *  are soft-deleted after every insert. Keeps the table small
   *  without a cron. */
  private static readonly SUBMISSION_LOG_MAX = 200

  // Fields that come back from the DB but should NEVER reach the
  // storefront. Keep this list narrow — adding fields here means the
  // admin UI sees them but the storefront does not.
  private static readonly PUBLIC_FIELD_BLACKLIST = new Set<string>([
    "updated_by_user_id",
    "deleted_at",
  ])

  /**
   * Load (and lazily create) the singleton settings row. Defaults
   * reproduce today's hardcoded storefront values — see
   * `seed/default-ovo.ts`.
   */
  async loadSetting(): Promise<any> {
    const existing = await this.listOvoSettings(
      { singleton_key: OvoService.SINGLETON_KEY },
      { take: 1 },
    )
    if (existing[0]) return existing[0]
    // The auto-generated create type narrows jsonb columns to
    // `Record<string, unknown>`, which doesn't accept arrays (e.g. `faq`).
    // The DB stores arbitrary JSON; the cast preserves runtime correctness.
    return this.createOvoSettings({
      singleton_key: OvoService.SINGLETON_KEY,
      ...(isDemoMode() ? DEMO_OVO : DEFAULT_OVO),
    } as any)
  }

  /** Admin-facing view — full row. */
  async getSettingsView(): Promise<any> {
    return this.loadSetting()
  }

  /**
   * Storefront-facing projection. Drops blacklisted fields. Values are
   * still nullable — callers must fall back when a JSON column is null.
   */
  async getPublicView(): Promise<Record<string, unknown>> {
    const row = await this.loadSetting()
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(row)) {
      if (OvoService.PUBLIC_FIELD_BLACKLIST.has(k)) continue
      out[k] = v
    }
    return out
  }

  /**
   * Apply a partial settings patch. Any key omitted from `patch` is
   * left untouched — matches the singleton-settings
   * convention.
   */
  async saveSettings(
    patch: Record<string, unknown>,
    opts: { updated_by_user_id?: string | null } = {},
  ): Promise<any> {
    const row = await this.loadSetting()
    const data: Record<string, unknown> = { ...patch }
    if (opts.updated_by_user_id !== undefined) {
      data.updated_by_user_id = opts.updated_by_user_id
    }
    await this.updateOvoSettings({
      selector: { id: row.id },
      data,
    })
    return this.loadSetting()
  }

  // ─── Per-entity overrides ────────────────────────────────────────

  /**
   * Look up the override row for a given entity. Returns null if no
   * override has been saved (the storefront then falls through to the
   * site-wide defaults).
   */
  async getOverride(
    entity_type: OvoEntityType,
    entity_id: string,
  ): Promise<any | null> {
    if (!OVO_ENTITY_TYPES.includes(entity_type)) {
      throw new Error(`unsupported entity_type: ${entity_type}`)
    }
    if (!entity_id) return null
    const rows = await this.listOvoOverrides(
      { entity_type, entity_id },
      { take: 1 },
    )
    return rows[0] ?? null
  }

  /**
   * Upsert an override row. `patch` may contain any subset of override
   * fields; missing keys are left at their existing value (or default
   * if the row is being created).
   *
   * Pass an empty object to clear the override (sets every field back
   * to null/default).
   */
  async saveOverride(
    entity_type: OvoEntityType,
    entity_id: string,
    patch: Record<string, unknown>,
    opts: { updated_by_user_id?: string | null } = {},
  ): Promise<any> {
    if (!OVO_ENTITY_TYPES.includes(entity_type)) {
      throw new Error(`unsupported entity_type: ${entity_type}`)
    }
    if (!entity_id) throw new Error("entity_id is required")

    const data: Record<string, unknown> = { ...patch }
    if (opts.updated_by_user_id !== undefined) {
      data.updated_by_user_id = opts.updated_by_user_id
    }

    const existing = await this.getOverride(entity_type, entity_id)
    if (existing) {
      await this.updateOvoOverrides({
        selector: { id: existing.id },
        data,
      })
    } else {
      await this.createOvoOverrides({
        entity_type,
        entity_id,
        ...data,
      } as any)
    }
    return this.getOverride(entity_type, entity_id)
  }

  /**
   * List every override row of a given entity type. Used by the OVO
   * admin "Page overrides" tab to enumerate path-keyed overrides.
   * Sorted by `entity_id` for stable display.
   */
  async listOverridesOfType(
    entity_type: OvoEntityType,
  ): Promise<any[]> {
    if (!OVO_ENTITY_TYPES.includes(entity_type)) {
      throw new Error(`unsupported entity_type: ${entity_type}`)
    }
    const rows = await this.listOvoOverrides(
      { entity_type },
      { take: 500 },
    )
    return [...rows].sort((a: any, b: any) =>
      String(a.entity_id).localeCompare(String(b.entity_id)),
    )
  }

  /**
   * Soft-delete the override row. Storefront falls back to defaults
   * after the next ISR window (or instantly via the cache-bust
   * webhook).
   */
  async clearOverride(
    entity_type: OvoEntityType,
    entity_id: string,
  ): Promise<void> {
    const existing = await this.getOverride(entity_type, entity_id)
    if (existing) {
      await this.deleteOvoOverrides([existing.id])
    }
  }

  /**
   * Storefront-safe override projection. Same blacklist as the
   * settings view; returns null if no override exists for the entity.
   */
  async getOverridePublicView(
    entity_type: OvoEntityType,
    entity_id: string,
  ): Promise<Record<string, unknown> | null> {
    const row = await this.getOverride(entity_type, entity_id)
    if (!row) return null
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(row)) {
      if (OvoService.PUBLIC_FIELD_BLACKLIST.has(k)) continue
      out[k] = v
    }
    return out
  }

  // ─── Push to discovery surfaces ──────────────────────────────────

  /**
   * Snapshot of which destinations are wired up. The admin Submit
   * tab calls this on mount to show "GSC: configured / not configured"
   * status without actually firing a request.
   *
   * "Configured" === the env vars exist. Whether they're *valid* is
   * only knowable by attempting a push, which the admin can do via
   * the button.
   */
  async getSubmissionStatus(): Promise<{
    indexnow: { configured: boolean; host: string | null }
    gsc: { configured: boolean; site_url: string | null }
    bing: { configured: boolean; site_url: string | null }
    sitemap_index_url: string
  }> {
    const siteUrl = (
      process.env.NEXT_PUBLIC_SITE_URL ||
      process.env.STOREFRONT_URL ||
      resolveDefaultSiteUrl()
    ).replace(/\/$/, "")

    let host: string | null = null
    try {
      host = new URL(siteUrl).host
    } catch {
      /* ignore */
    }

    // Honor DB-stored credentials when computing the Ready/Not-configured
    // badge for GSC + Bing so the Submit tab flips green as soon as the
    // operator pastes a key in the admin Integrations section — no
    // restart needed.
    const creds = await this.getApiCredentials().catch(() => ({
      gsc_service_account_json: null,
      bing_api_key: null,
    }))

    return {
      indexnow: {
        configured: Boolean(process.env.INDEXNOW_KEY),
        host,
      },
      gsc: {
        configured: Boolean(
          creds.gsc_service_account_json &&
            ((process.env.OVO_GSC_PROPERTY || process.env.GSC_SITE_URL) || siteUrl),
        ),
        site_url: (process.env.OVO_GSC_PROPERTY || process.env.GSC_SITE_URL) ?? `${siteUrl}/`,
      },
      bing: {
        configured: Boolean(
          creds.bing_api_key && ((process.env.OVO_BING_SITE_URL || process.env.BING_SITE_URL) || siteUrl),
        ),
        site_url: (process.env.OVO_BING_SITE_URL || process.env.BING_SITE_URL) ?? siteUrl,
      },
      sitemap_index_url: `${siteUrl}/sitemap.xml`,
    }
  }

  /**
   * Push a URL list to IndexNow (Bing + Yandex). When `urls` is
   * omitted, pulls every URL from the live sitemap and pushes them
   * all — the "submit everything now" admin button calls this shape.
   */
  async pushToIndexNow(
    urls: string[] | null,
    opts: { triggered_by_user_id?: string | null } = {},
  ): Promise<SubmissionResult> {
    const key = process.env.INDEXNOW_KEY
    const status = await this.getSubmissionStatus()
    if (!key || !status.indexnow.host) {
      const skipped: SubmissionResult = {
        destination: "indexnow",
        action: "submit-urls",
        target: status.indexnow.host ?? "unknown-host",
        url_count: 0,
        status: "skipped",
        http_status: null,
        error_message: "indexnow_not_configured",
        duration_ms: 0,
      }
      await this.persistLog(skipped, opts.triggered_by_user_id)
      return skipped
    }

    const siteUrl = `https://${status.indexnow.host}`

    let urlList: string[]
    if (urls && urls.length > 0) {
      urlList = urls
    } else {
      const fetched = await fetchAllSitemapUrls(status.sitemap_index_url)
      urlList = fetched.urls
    }

    const result = await pushUrlsToIndexNow(
      {
        key,
        host: status.indexnow.host,
        keyLocation: `${siteUrl}/indexnow.txt`,
      },
      urlList,
    )
    await this.persistLog(result, opts.triggered_by_user_id)
    return result
  }

  /**
   * Submit (or refresh) the sitemap to Google Search Console.
   */
  async pushSitemapToGsc(
    opts: { feedpath?: string; triggered_by_user_id?: string | null } = {},
  ): Promise<SubmissionResult> {
    const status = await this.getSubmissionStatus()
    const creds = await this.getApiCredentials()
    const cfg = parseGscConfig(
      creds.gsc_service_account_json ?? undefined,
      status.gsc.site_url,
    )
    if (!cfg) {
      const skipped: SubmissionResult = {
        destination: "gsc",
        action: "submit-sitemap",
        target: opts.feedpath ?? status.sitemap_index_url,
        url_count: 1,
        status: "skipped",
        http_status: null,
        error_message: "gsc_not_configured",
        duration_ms: 0,
      }
      await this.persistLog(skipped, opts.triggered_by_user_id)
      return skipped
    }

    const feedpath = opts.feedpath ?? status.sitemap_index_url
    const result = await submitSitemapToGsc(cfg, feedpath)
    await this.persistLog(result, opts.triggered_by_user_id)
    return result
  }

  /**
   * Ask GSC whether a single URL is indexed + why/why not. Useful
   * for "is the NSE product page indexed yet" spot-checks from the
   * admin without leaving the Medusa tab.
   */
  async inspectGscUrl(
    inspectionUrl: string,
    opts: { triggered_by_user_id?: string | null } = {},
  ): Promise<SubmissionResult & { coverage?: string | null }> {
    const status = await this.getSubmissionStatus()
    const creds = await this.getApiCredentials()
    const cfg = parseGscConfig(
      creds.gsc_service_account_json ?? undefined,
      status.gsc.site_url,
    )
    if (!cfg) {
      const skipped: SubmissionResult = {
        destination: "gsc",
        action: "inspect-url",
        target: inspectionUrl,
        url_count: 1,
        status: "skipped",
        http_status: null,
        error_message: "gsc_not_configured",
        duration_ms: 0,
      }
      await this.persistLog(skipped, opts.triggered_by_user_id)
      return skipped
    }

    const result = await inspectUrlOnGsc(cfg, inspectionUrl)
    await this.persistLog(result, opts.triggered_by_user_id)
    return result
  }

  /**
   * Submit the sitemap to Bing Webmaster Tools. IndexNow already
   * covers Bing for URL push, so this is sitemap-only.
   */
  async pushSitemapToBing(
    opts: { feedUrl?: string; triggered_by_user_id?: string | null } = {},
  ): Promise<SubmissionResult> {
    const status = await this.getSubmissionStatus()
    const creds = await this.getApiCredentials()
    const cfg = parseBingConfig(
      creds.bing_api_key ?? undefined,
      status.bing.site_url,
    )
    if (!cfg) {
      const skipped: SubmissionResult = {
        destination: "bing",
        action: "submit-sitemap",
        target: opts.feedUrl ?? status.sitemap_index_url,
        url_count: 1,
        status: "skipped",
        http_status: null,
        error_message: "bing_not_configured",
        duration_ms: 0,
      }
      await this.persistLog(skipped, opts.triggered_by_user_id)
      return skipped
    }

    const feedUrl = opts.feedUrl ?? status.sitemap_index_url
    const result = await submitSitemapToBing(cfg, feedUrl)
    await this.persistLog(result, opts.triggered_by_user_id)
    return result
  }

  /**
   * Fire IndexNow + GSC sitemap + Bing sitemap in parallel. Returns
   * one SubmissionResult per destination; failures don't short-circuit
   * the others.
   */
  async pushToAll(
    opts: { triggered_by_user_id?: string | null } = {},
  ): Promise<SubmissionResult[]> {
    const [indexNow, gsc, bing] = await Promise.all([
      this.pushToIndexNow(null, opts),
      this.pushSitemapToGsc(opts),
      this.pushSitemapToBing(opts),
    ])
    return [indexNow, gsc, bing]
  }

  /**
   * Recent submission events for the admin Submit tab. Newest first.
   * Soft-deleted rows are excluded automatically by the listOvoSubmissionLogs
   * helper.
   */
  async listSubmissionLog(
    opts: {
      limit?: number
      destination?: SubmissionDestination
      status?: "success" | "error" | "skipped"
      since?: Date
    } = {},
  ): Promise<any[]> {
    const take = Math.min(Math.max(opts.limit ?? 50, 1), 200)
    const filter: Record<string, unknown> = {}
    if (opts.destination && opts.destination !== "all") {
      filter.destination = opts.destination
    }
    if (opts.status) {
      filter.status = opts.status
    }
    if (opts.since instanceof Date) {
      filter.created_at = { $gte: opts.since }
    }
    const rows = await this.listOvoSubmissionLogs(filter, {
      take,
      order: { created_at: "DESC" },
    } as any)
    return rows
  }

  /**
   * Per-destination rollups for the Submit tab cards.
   *
   * Returns three sets of numbers per destination (indexnow / gsc / bing):
   *   - `last_success_at`       — when the last `status=success` event landed.
   *                               Null if no successes ever.
   *   - `success_rate_7d`       — successes / (successes + errors) over the
   *                               last 7 days. Null when no events landed.
   *   - `lifetime_urls_pushed`  — sum of `url_count` across all successful
   *                               events for this destination. Drives the
   *                               "we've fanned out X URLs" card.
   *   - `events_by_day`         — { date: 'YYYY-MM-DD', success: n, error: n,
   *                               skipped: n }[] — last 7 days, oldest
   *                               first. Empty days are still in the array
   *                               with zeros so the sparkline renders an
   *                               unbroken x-axis.
   *
   * Implementation: walks the full `ovo_submission_log` table (capped at
   * 200 rows by `SUBMISSION_LOG_MAX`, so the read is cheap). Doing this
   * in service code rather than SQL keeps the module-store abstraction
   * clean and the table small enough that perf is a non-issue.
   */
  async getSubmissionStats(): Promise<{
    indexnow: SubmissionDestinationStats
    gsc: SubmissionDestinationStats
    bing: SubmissionDestinationStats
  }> {
    const all = await this.listOvoSubmissionLogs({}, {
      take: 1000,
      order: { created_at: "DESC" },
    } as any)

    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)
    const dayBuckets: string[] = []
    {
      const today = new Date()
      today.setHours(0, 0, 0, 0)
      for (let i = 6; i >= 0; i--) {
        const d = new Date(today.getTime() - i * 24 * 60 * 60 * 1000)
        dayBuckets.push(d.toISOString().slice(0, 10))
      }
    }

    const init = (): SubmissionDestinationStats => ({
      last_success_at: null,
      success_rate_7d: null,
      lifetime_urls_pushed: 0,
      lifetime_event_count: 0,
      success_count_7d: 0,
      error_count_7d: 0,
      skipped_count_7d: 0,
      events_by_day: dayBuckets.map((date) => ({
        date,
        success: 0,
        error: 0,
        skipped: 0,
      })),
    })

    const stats: Record<SubmissionDestinationKey, SubmissionDestinationStats> = {
      indexnow: init(),
      gsc: init(),
      bing: init(),
    }

    for (const row of all as any[]) {
      const dest = row.destination as SubmissionDestinationKey | undefined
      if (!dest || !(dest in stats)) continue
      const s = stats[dest]
      s.lifetime_event_count += 1

      if (row.status === "success") {
        s.lifetime_urls_pushed += Number(row.url_count ?? 0)
        // Newest-first ordering means the first success we see is the
        // most recent.
        if (!s.last_success_at) {
          s.last_success_at = row.created_at instanceof Date
            ? row.created_at.toISOString()
            : (row.created_at as string)
        }
      }

      const createdAt = row.created_at instanceof Date
        ? row.created_at
        : new Date(row.created_at as string)
      if (createdAt >= sevenDaysAgo) {
        if (row.status === "success") s.success_count_7d += 1
        else if (row.status === "error") s.error_count_7d += 1
        else if (row.status === "skipped") s.skipped_count_7d += 1

        const dateKey = createdAt.toISOString().slice(0, 10)
        const bucket = s.events_by_day.find((b) => b.date === dateKey)
        if (bucket) {
          if (row.status === "success") bucket.success += 1
          else if (row.status === "error") bucket.error += 1
          else if (row.status === "skipped") bucket.skipped += 1
        }
      }
    }

    for (const dest of Object.keys(stats) as SubmissionDestinationKey[]) {
      const s = stats[dest]
      const denom = s.success_count_7d + s.error_count_7d
      s.success_rate_7d = denom > 0 ? s.success_count_7d / denom : null
    }

    return stats
  }

  /**
   * Insert a log row + prune older rows over the cap. Failures are
   * logged but never thrown — losing a log entry shouldn't fail a
   * push that already happened upstream.
   */
  private async persistLog(
    result: SubmissionResult,
    triggered_by_user_id: string | null | undefined,
  ): Promise<void> {
    try {
      await this.createOvoSubmissionLogs({
        destination: result.destination,
        action: result.action,
        target: result.target,
        url_count: result.url_count,
        status: result.status,
        http_status: result.http_status,
        error_message: result.error_message,
        duration_ms: result.duration_ms,
        triggered_by_user_id: triggered_by_user_id ?? null,
      } as any)
      // Cheap, occasional prune — listing 1 row past the cap means we
      // need to trim. Could be smarter (only run every N inserts) but
      // the table is small enough that this is fine.
      const overflow = await this.listOvoSubmissionLogs({}, {
        skip: OvoService.SUBMISSION_LOG_MAX,
        take: 50,
        order: { created_at: "DESC" },
      } as any)
      if (overflow.length > 0) {
        await this.deleteOvoSubmissionLogs(overflow.map((r: any) => r.id))
      }
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn("ovo: persistLog failed", err)
    }
  }

  // ─── SEO metric ingestion (Phase 2) ──────────────────────────────

  /**
   * Pull daily GSC search-analytics for the configured property, upsert
   * one `ovo_seo_metric` row per (date, metric). Idempotent — re-running
   * on the same day overwrites stale partial data.
   *
   * Soft-fails when `GOOGLE_GSC_SERVICE_ACCOUNT_JSON` is missing or
   * malformed — the cron logs a "skipped" entry and moves on.
   *
   * Daysback controls how far we look back. Default 30 — GSC's data
   * lag is 1-3 days so requesting `daysBack=30` populates ~28 days of
   * fresh + finalised metrics. The cron runs daily so back-fills land
   * naturally even if one day is missed.
   */
  async ingestGscDailyMetrics(
    opts: { daysBack?: number } = {},
  ): Promise<{ written: number; days: string[] }> {
    const creds = await this.getApiCredentials()
    const cfg = parseGscConfig(
      creds.gsc_service_account_json ?? undefined,
      (process.env.OVO_GSC_PROPERTY || process.env.GSC_SITE_URL),
    )
    if (!cfg) return { written: 0, days: [] }

    const rows = await fetchGscDailyMetrics(cfg, opts.daysBack ?? 30)
    const indexed = await fetchGscIndexedSurfacedCount(cfg)

    let written = 0
    const days: string[] = []
    for (const r of rows) {
      const dt = new Date(`${r.date}T00:00:00Z`)
      days.push(r.date)
      await this.upsertMetric("gsc", "impressions", dt, r.impressions, r)
      await this.upsertMetric("gsc", "clicks", dt, r.clicks, null)
      await this.upsertMetric("gsc", "ctr", dt, r.ctr, null)
      await this.upsertMetric("gsc", "avg_position", dt, r.position, null)
      written += 4
    }

    if (indexed !== null) {
      // Anchor `indexed_pages` to today (UTC) — it's a property-level
      // count, not a per-day metric.
      const today = new Date()
      today.setUTCHours(0, 0, 0, 0)
      await this.upsertMetric("gsc", "indexed_surfaced", today, indexed, null)
      written += 1
    }

    await this.pruneOldMetrics()
    return { written, days }
  }

  /**
   * Pull weekly query stats + daily crawl stats from Bing Webmaster.
   * Crawl stats are daily; query stats are weekly (Monday-keyed) —
   * the metrics chart labels each line by `engine + granularity`.
   */
  async ingestBingMetrics(): Promise<{ written: number }> {
    const creds = await this.getApiCredentials()
    const cfg = parseBingConfig(
      creds.bing_api_key ?? undefined,
      (process.env.OVO_BING_SITE_URL || process.env.BING_SITE_URL),
    )
    if (!cfg) return { written: 0 }

    let written = 0

    try {
      const weekly = await fetchBingWeeklyMetrics(cfg)
      for (const w of weekly) {
        const dt = new Date(`${w.date}T00:00:00Z`)
        await this.upsertMetric("bing", "impressions", dt, w.impressions, w)
        await this.upsertMetric("bing", "clicks", dt, w.clicks, null)
        await this.upsertMetric("bing", "ctr", dt, w.ctr, null)
        await this.upsertMetric("bing", "avg_position", dt, w.position, null)
        written += 4
      }
    } catch {
      /* swallow — caller logs */
    }

    try {
      const crawl = await fetchBingCrawlSummary(cfg)
      for (const c of crawl) {
        const dt = new Date(`${c.date}T00:00:00Z`)
        await this.upsertMetric("bing", "crawled_pages", dt, c.total_crawled, c)
        await this.upsertMetric("bing", "crawl_errors_4xx", dt, c.errors_4xx, null)
        await this.upsertMetric("bing", "crawl_errors_5xx", dt, c.errors_5xx, null)
        written += 3
      }
    } catch {
      /* swallow */
    }

    await this.pruneOldMetrics()
    return { written }
  }

  /**
   * Idempotent metric upsert. Looks up by (engine, metric_type, date)
   * unique index; updates `value` if present, inserts otherwise.
   *
   * `raw` is the upstream payload; only the first row of a per-day
   * batch carries it (caller's responsibility) to keep storage lean.
   */
  private async upsertMetric(
    engine: string,
    metric_type: string,
    date: Date,
    value: number,
    raw: unknown | null,
  ): Promise<void> {
    try {
      const [existing] = await this.listOvoSeoMetrics(
        { engine, metric_type, date },
        { take: 1 },
      )
      if (existing) {
        await this.updateOvoSeoMetrics({
          selector: { id: existing.id },
          data: { value, raw_response: raw ?? existing.raw_response },
        } as any)
      } else {
        await this.createOvoSeoMetrics({
          engine,
          metric_type,
          date,
          value,
          raw_response: raw,
        } as any)
      }
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn("ovo: upsertMetric failed", { engine, metric_type, date, err })
    }
  }

  /** Drop rows older than `SEO_METRIC_RETENTION_DAYS`. Runs after every
   *  ingest; cheap because we LIMIT 1000 and a daily ingest writes
   *  ~30 rows. */
  private async pruneOldMetrics(): Promise<void> {
    const horizon = new Date(
      Date.now() - OvoService.SEO_METRIC_RETENTION_DAYS * 24 * 60 * 60 * 1000,
    )
    try {
      const stale = await this.listOvoSeoMetrics(
        { date: { $lt: horizon } as any },
        { take: 1000 },
      )
      if (stale.length > 0) {
        await this.deleteOvoSeoMetrics(stale.map((r: any) => r.id))
      }
    } catch {
      /* non-fatal */
    }
  }

  /**
   * Read-side: chart query. Returns rows in ascending date order so
   * line charts can plot directly.
   */
  async listSeoMetrics(opts: {
    engine?: string
    metric_type?: string
    from?: Date
    to?: Date
    limit?: number
  } = {}): Promise<any[]> {
    const filter: Record<string, unknown> = {}
    if (opts.engine) filter.engine = opts.engine
    if (opts.metric_type) filter.metric_type = opts.metric_type
    if (opts.from || opts.to) {
      const range: Record<string, Date> = {}
      if (opts.from) range.$gte = opts.from
      if (opts.to) range.$lte = opts.to
      filter.date = range as any
    }
    return this.listOvoSeoMetrics(filter, {
      take: Math.min(opts.limit ?? 1000, 5000),
      order: { date: "ASC" },
    } as any)
  }

  // ─── Dimension rollups + per-query history (Phase 2 extension) ──

  /**
   * The four GSC search-analytics dimensions we snapshot daily. Kept
   * here (not as a generic string) so callers in the cron + admin
   * routes can iterate with type safety.
   */
  static readonly GSC_ROLLUP_DIMENSIONS = [
    "query",
    "page",
    "country",
    "device",
  ] as const

  /**
   * Daily top-N snapshot of one GSC dimension over a rolling window
   * (default 28 days). Replaces the prior snapshot for the same
   * (dimension_type, window_days) — the table is intentionally
   * single-snapshot to keep it bounded.
   *
   * Soft-skips when GSC credentials aren't configured.
   */
  async ingestGscDimensionRollup(
    dimension: "query" | "page" | "country" | "device",
    windowDays: number = 28,
    rowLimit: number = 200,
  ): Promise<{ written: number; dimension: string }> {
    const creds = await this.getApiCredentials()
    const cfg = parseGscConfig(
      creds.gsc_service_account_json ?? undefined,
      (process.env.OVO_GSC_PROPERTY || process.env.GSC_SITE_URL),
    )
    if (!cfg) return { written: 0, dimension }

    const rows = await fetchGscDimensionRollup(
      cfg,
      dimension,
      windowDays,
      rowLimit,
    )

    // Replace the prior snapshot in one shot. The unique index on
    // (engine, dimension_type, dimension_value, window_days) is
    // partial-on-deleted_at so soft-deleted ghosts don't collide with
    // fresh INSERTs.
    try {
      const stale = await this.listOvoSeoDimensionRollups(
        {
          engine: "gsc",
          dimension_type: dimension,
          window_days: windowDays,
        },
        { take: 1000 },
      )
      if (stale.length > 0) {
        await this.deleteOvoSeoDimensionRollups(stale.map((r: any) => r.id))
      }
    } catch {
      /* non-fatal — fall through to insert; unique index will catch dupes */
    }

    const capturedAt = new Date()
    let written = 0
    for (const r of rows) {
      try {
        await this.createOvoSeoDimensionRollups({
          engine: "gsc",
          dimension_type: dimension,
          dimension_value: r.dimension_value,
          window_days: windowDays,
          clicks: r.clicks,
          impressions: r.impressions,
          ctr: r.ctr,
          position: r.position,
          captured_at: capturedAt,
        } as any)
        written += 1
      } catch (err) {
        // eslint-disable-next-line no-console
        console.warn("ovo: dimension-rollup insert failed", {
          dimension,
          value: r.dimension_value,
          err,
        })
      }
    }

    return { written, dimension }
  }

  /**
   * Convenience: ingest all four GSC dimensions in one go. Used by the
   * daily cron + the manual `POST /admin/ovo/seo/ingest` route when
   * `engine=gsc` is passed.
   */
  async ingestAllGscDimensionRollups(
    windowDays: number = 28,
  ): Promise<{ written: number; per_dimension: Record<string, number> }> {
    let total = 0
    const per: Record<string, number> = {}
    for (const dim of OvoService.GSC_ROLLUP_DIMENSIONS) {
      try {
        const r = await this.ingestGscDimensionRollup(dim, windowDays)
        per[dim] = r.written
        total += r.written
      } catch (err) {
        per[dim] = 0
        // eslint-disable-next-line no-console
        console.warn("ovo: ingestGscDimensionRollup failed", { dim, err })
      }
    }
    return { written: total, per_dimension: per }
  }

  /**
   * Per-(query, date) traffic + rank ingest. One GSC API call covers
   * everything; we upsert each returned row keyed by
   * (engine, query, date).
   *
   * Soft-skips on missing credentials. Prunes rows older than
   * `SEO_QUERY_HISTORY_RETENTION_DAYS` after the upsert so the table
   * stays bounded.
   */
  async ingestGscQueryHistory(
    daysBack: number = 30,
    rowLimit: number = 5000,
  ): Promise<{ written: number; queries: number }> {
    const creds = await this.getApiCredentials()
    const cfg = parseGscConfig(
      creds.gsc_service_account_json ?? undefined,
      (process.env.OVO_GSC_PROPERTY || process.env.GSC_SITE_URL),
    )
    if (!cfg) return { written: 0, queries: 0 }

    const rows = await fetchGscQueryHistory(cfg, daysBack, rowLimit)

    const seenQueries = new Set<string>()
    let written = 0
    for (const r of rows) {
      const date = new Date(`${r.date}T00:00:00Z`)
      try {
        const [existing] = await this.listOvoSeoQueryHistories(
          { engine: "gsc", query: r.query, date },
          { take: 1 },
        )
        if (existing) {
          await this.updateOvoSeoQueryHistories({
            selector: { id: existing.id },
            data: {
              clicks: r.clicks,
              impressions: r.impressions,
              ctr: r.ctr,
              position: r.position,
            },
          } as any)
        } else {
          await this.createOvoSeoQueryHistories({
            engine: "gsc",
            query: r.query,
            date,
            clicks: r.clicks,
            impressions: r.impressions,
            ctr: r.ctr,
            position: r.position,
          } as any)
        }
        seenQueries.add(r.query)
        written += 1
      } catch (err) {
        // eslint-disable-next-line no-console
        console.warn("ovo: query-history upsert failed", {
          query: r.query,
          date: r.date,
          err,
        })
      }
    }

    await this.pruneOldQueryHistory()
    return { written, queries: seenQueries.size }
  }

  /** Drop history rows older than the retention window. */
  private async pruneOldQueryHistory(): Promise<void> {
    const horizon = new Date(
      Date.now() -
        OvoService.SEO_QUERY_HISTORY_RETENTION_DAYS * 24 * 60 * 60 * 1000,
    )
    try {
      const stale = await this.listOvoSeoQueryHistories(
        { date: { $lt: horizon } as any },
        { take: 5000 },
      )
      if (stale.length > 0) {
        await this.deleteOvoSeoQueryHistories(stale.map((r: any) => r.id))
      }
    } catch {
      /* non-fatal */
    }
  }

  /**
   * Read-side: top-N for a single dimension. Returns rows ordered by
   * clicks descending — same shape the admin "top queries" / "top
   * pages" tables consume.
   */
  async listSeoDimensionRollup(opts: {
    engine?: string
    dimension_type: "query" | "page" | "country" | "device"
    window_days?: number
    limit?: number
  }): Promise<any[]> {
    const filter: Record<string, unknown> = {
      engine: opts.engine ?? "gsc",
      dimension_type: opts.dimension_type,
    }
    if (typeof opts.window_days === "number") {
      filter.window_days = opts.window_days
    }
    return this.listOvoSeoDimensionRollups(filter, {
      take: Math.min(opts.limit ?? 200, 1000),
      order: { clicks: "DESC" },
    } as any)
  }

  // ─── Per-URL on-page SEO audit (Phase 5) ────────────────────────

  /** Concurrency cap when auditing URLs. 8 keeps the storefront/Caddy
   *  load light during a nightly run while finishing 150 URLs in
   *  ~30 seconds. */
  private static readonly SEO_AUDIT_CONCURRENCY = 8

  /**
   * Crawl every URL in the storefront sitemap-index, run the on-page
   * auditor against each, and persist the latest result per URL.
   *
   * Replaces (UPSERT-by-url) prior rows so the table holds only the
   * current snapshot. URLs that drop out of the sitemap (taxonomy
   * deletion, product archived) are also pruned in this pass so
   * `ovo_seo_audit` always mirrors the live URL set.
   */
  async runSeoAudit(opts: {
    limit?: number
    trigger?: "cron" | "manual" | "single_url"
  } = {}): Promise<{
    audited: number
    error_urls: number
    warn_urls: number
    skipped: number
    run_id: string | null
  }> {
    const runStartedAt = new Date()
    const t0 = Date.now()
    const siteUrl =
      process.env.NEXT_PUBLIC_SITE_URL ||
      process.env.STOREFRONT_URL ||
      resolveDefaultSiteUrl()
    const sitemapIndex = `${siteUrl.replace(/\/$/, "")}/sitemap.xml`

    const fetched = await fetchAllSitemapUrls(sitemapIndex)
    const candidateUrls = opts.limit
      ? fetched.urls.slice(0, opts.limit)
      : fetched.urls

    // Pre-load operator keyword targets once so we can fold them into
    // each per-URL audit without N+1 lookups.
    const targetsByUrl = await this.getKeywordTargetsByUrl()

    let auditedCount = 0
    let errorUrlCount = 0
    let warnUrlCount = 0
    const seenUrls = new Set<string>()
    const allFindings: Array<{ severity: string; code: string }> = []

    // Bounded concurrency: chunk the URLs into groups of N and Promise.all each.
    const chunk = OvoService.SEO_AUDIT_CONCURRENCY
    for (let i = 0; i < candidateUrls.length; i += chunk) {
      const batch = candidateUrls.slice(i, i + chunk)
      const results = await Promise.all(
        batch.map((u) => auditUrl(u, targetsByUrl.get(u) ?? [])),
      )
      for (const r of results) {
        await this.upsertAuditRow(r)
        seenUrls.add(r.url)
        auditedCount += 1
        const hasError = r.findings.some((f) => f.severity === "error")
        const hasWarn = r.findings.some((f) => f.severity === "warn")
        if (hasError) errorUrlCount += 1
        else if (hasWarn) warnUrlCount += 1
        for (const f of r.findings) {
          allFindings.push({ severity: f.severity, code: f.code })
        }
      }
    }

    // GC: drop rows for URLs that vanished from the sitemap.
    try {
      const all = await this.listOvoSeoAudits({}, { take: 5000 })
      const stale = all.filter((r: any) => !seenUrls.has(r.url))
      if (stale.length > 0) {
        await this.deleteOvoSeoAudits(stale.map((r: any) => r.id))
      }
    } catch {
      /* non-fatal */
    }

    // Persist the run summary for the trend chart. Failure is non-fatal
    // — the per-URL rows are the authoritative state.
    let runId: string | null = null
    try {
      const issuesByCode: Record<string, number> = {}
      for (const f of allFindings) {
        issuesByCode[f.code] = (issuesByCode[f.code] ?? 0) + 1
      }
      const run = await this.createOvoSeoAuditRuns({
        started_at: runStartedAt,
        duration_ms: Date.now() - t0,
        urls_total: candidateUrls.length,
        urls_error: errorUrlCount,
        urls_warn: warnUrlCount,
        urls_healthy: auditedCount - errorUrlCount - warnUrlCount,
        trigger: opts.trigger ?? "cron",
        issues_by_code: issuesByCode,
      } as any)
      runId =
        Array.isArray(run) && run[0]?.id
          ? run[0].id
          : (run as { id?: string })?.id ?? null
      await this.pruneOldAuditRuns()
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn("ovo: audit-run insert failed", err)
    }

    return {
      audited: auditedCount,
      error_urls: errorUrlCount,
      warn_urls: warnUrlCount,
      skipped: candidateUrls.length - auditedCount,
      run_id: runId,
    }
  }

  /**
   * Re-audit a single URL without rewalking the whole sitemap. Used by
   * the "I fixed it, recheck me" button on the Audit tab. Updates only
   * that URL's row in `ovo_seo_audit` — does NOT touch run history,
   * since a single-URL refresh isn't a representative sample of the
   * whole site.
   */
  async runSeoAuditForUrl(url: string): Promise<{
    url: string
    status_code: number
    findings: Array<{ severity: string; code: string; message: string }>
    has_error: boolean
    has_warn: boolean
    quality_score: number
  }> {
    const targets = await this.listKeywordTargets({ url })
    const keywords = targets.map((t: any) => t.keyword as string)
    const r = await auditUrl(url, keywords)
    await this.upsertAuditRow(r)
    const hasError = r.findings.some((f) => f.severity === "error")
    const hasWarn = r.findings.some((f) => f.severity === "warn")
    return {
      url: r.url,
      status_code: r.status_code,
      findings: r.findings,
      has_error: hasError,
      has_warn: hasWarn,
      quality_score: r.quality_score,
    }
  }

  /** Drop audit-run rows older than 365 days. */
  private async pruneOldAuditRuns(): Promise<void> {
    const horizon = new Date(Date.now() - 365 * 24 * 60 * 60 * 1000)
    try {
      const stale = await this.listOvoSeoAuditRuns(
        { started_at: { $lt: horizon } as any },
        { take: 1000 } as any,
      )
      if (stale.length > 0) {
        await this.deleteOvoSeoAuditRuns(stale.map((r: any) => r.id))
      }
    } catch {
      /* non-fatal */
    }
  }

  /* ── Keyword target CRUD (Phase 6 + Phase 1 expansion) ──────── */

  /** Default window used by dashboard charts when none specified. */
  static readonly KEYWORD_PERF_DEFAULT_WINDOW_DAYS = 28

  /** Snapshot retention. Mirrors `SEO_METRIC_RETENTION_DAYS` —
   *  per-target trends benefit from year-over-year overlays. */
  static readonly KEYWORD_PERF_RETENTION_DAYS = 730

  /** Hard cap on CSV bulk-import to prevent operator footguns. The
   *  `ovo_setting.keyword_tracking.bulk_import_cap` jsonb override can
   *  raise this at the singleton level if 5k turns out to be too low. */
  static readonly KEYWORD_TARGET_BULK_IMPORT_CAP = 5000

  /**
   * List keyword targets with Phase 1 filters. Backwards-compatible:
   * existing callers passing only `{url, keyword, limit}` keep working
   * because the new filter keys are optional.
   *
   * Filters supported:
   *   - `url`           exact match on `url` column (legacy)
   *   - `keyword`       exact match on `keyword` column (legacy)
   *   - `group_id`      filter to one keyword group (Phase 1)
   *   - `status`        "tracking" | "paused" | "won" | "lost" (Phase 1)
   *   - `tag`           single tag membership — uses jsonb @> check (Phase 1)
   *   - `q`             free-text search on `normalized_keyword`
   *                     (prefix match, Phase 1)
   *   - `is_active`     defaults true if omitted; pass null to disable
   *
   * Order: priority ASC, then keyword ASC. URL secondary because
   * keywords without a URL still need stable ordering.
   */
  async listKeywordTargets(opts: {
    url?: string
    keyword?: string
    group_id?: string | null
    status?: string
    tag?: string
    q?: string
    is_active?: boolean | null
    limit?: number
    offset?: number
  } = {}): Promise<any[]> {
    const filter: Record<string, unknown> = {}
    if (opts.url) filter.url = opts.url
    if (opts.keyword) filter.keyword = opts.keyword
    if (opts.group_id !== undefined) filter.keyword_group_id = opts.group_id
    if (opts.status) filter.status = opts.status
    if (opts.is_active !== null) {
      filter.is_active = opts.is_active === undefined ? true : opts.is_active
    }
    // `tag` and `q` aren't representable in the MikroORM filter shape —
    // we apply them as in-memory filters after fetching. This keeps the
    // service simple at low row counts; once Meilisearch lands `q` moves
    // to a real search call.
    const rows = await this.listOvoSeoKeywordTargets(filter, {
      take: Math.min(opts.limit ?? 500, 5000),
      skip: opts.offset ?? 0,
      order: { priority: "ASC", keyword: "ASC" },
    } as any)

    let out = rows as any[]
    if (opts.tag) {
      const needle = opts.tag.toLowerCase()
      out = out.filter((r) => {
        const t = r.tags
        if (!Array.isArray(t)) return false
        return t.some(
          (x) => typeof x === "string" && x.toLowerCase() === needle,
        )
      })
    }
    if (opts.q) {
      const needle = tryNormalizeKeyword(opts.q)
      if (needle) {
        out = out.filter(
          (r) =>
            typeof r.normalized_keyword === "string" &&
            r.normalized_keyword.startsWith(needle),
        )
      }
    }
    return out
  }

  /**
   * Pre-build a `Map<url, string[]>` of keyword targets so the audit
   * loop can fold them in without N+1 lookups. Lowercased keyword set
   * for the audit's case-insensitive match.
   *
   * Phase 1: rows with `url IS NULL` (queued-without-page keywords)
   * are skipped — there's no URL to audit them against.
   */
  async getKeywordTargetsByUrl(): Promise<Map<string, string[]>> {
    const targets = await this.listOvoSeoKeywordTargets(
      { is_active: true } as any,
      { take: 5000 } as any,
    )
    const m = new Map<string, string[]>()
    for (const t of targets) {
      const r = t as { url: string | null; keyword: string }
      if (!r.url) continue
      if (!m.has(r.url)) m.set(r.url, [])
      m.get(r.url)!.push(r.keyword)
    }
    return m
  }

  /**
   * Upsert a keyword target. Idempotent on `(normalized_keyword,
   * target_country, language)`. Normalises the keyword via
   * `lib/keyword-normalizer.ts` (NFKC + lowercase + collapse-ws +
   * zero-width-strip).
   *
   * Returns the full row. Throws `KeywordNormalisationError` if the
   * input keyword normalises to empty or exceeds 200 chars — callers
   * should map this to a 400 response.
   */
  async upsertKeywordTarget(
    patch: {
      keyword: string
      keyword_group_id?: string | null
      url?: string | null
      priority?: number
      notes?: string | null
      target_country?: string
      language?: string
      tags?: string[] | null
      target_position?: number | null
      search_volume_monthly?: number | null
      search_difficulty?: number | null
      status?: "tracking" | "paused" | "won" | "lost"
      is_active?: boolean
      /** Phase 8.D — manual override for the auto-classified intent.
       *  When omitted, the classifier re-runs on every upsert. When
       *  supplied, the operator's choice is preserved verbatim. */
      search_intent?: SearchIntent
    },
    _opts: { updated_by_user_id?: string } = {},
  ): Promise<any> {
    const normalized = normalizeKeyword(patch.keyword)
    const target_country = (patch.target_country ?? "IN").toUpperCase()
    const language = (patch.language ?? "en").toLowerCase()

    // Lookup by natural key.
    const existing = await this.listOvoSeoKeywordTargets(
      {
        normalized_keyword: normalized,
        target_country,
        language,
      } as any,
      { take: 1 } as any,
    )

    const data: Record<string, unknown> = {
      keyword: patch.keyword,
      normalized_keyword: normalized,
      target_country,
      language,
    }
    if (patch.keyword_group_id !== undefined)
      data.keyword_group_id = patch.keyword_group_id
    if (patch.url !== undefined) data.url = patch.url
    if (patch.priority !== undefined) data.priority = patch.priority
    if (patch.notes !== undefined) data.notes = patch.notes
    if (patch.tags !== undefined) data.tags = patch.tags
    if (patch.target_position !== undefined)
      data.target_position = patch.target_position
    if (patch.search_volume_monthly !== undefined)
      data.search_volume_monthly = patch.search_volume_monthly
    if (patch.search_difficulty !== undefined)
      data.search_difficulty = patch.search_difficulty
    if (patch.status !== undefined) data.status = patch.status
    if (patch.is_active !== undefined) data.is_active = patch.is_active

    // Search intent (Phase 8.D). Explicit operator override wins;
    // otherwise auto-classify from the keyword text.
    if (patch.search_intent !== undefined) {
      data.search_intent = patch.search_intent
    } else {
      data.search_intent = classifyIntent(patch.keyword).intent
    }

    if (existing[0]) {
      await this.updateOvoSeoKeywordTargets({
        selector: { id: (existing[0] as any).id },
        data,
      })
      const refreshed = await this.listOvoSeoKeywordTargets(
        { id: (existing[0] as any).id } as any,
        { take: 1 } as any,
      )
      return refreshed[0]
    }
    return this.createOvoSeoKeywordTargets(data as any)
  }

  /**
   * Bulk CSV upsert. Each row goes through `upsertKeywordTarget` so
   * normalisation + dedup behave identically to single-row creates.
   * Returns counts + per-row errors so the admin UI can surface a
   * preview-then-commit flow.
   */
  async bulkUpsertKeywordTargets(
    rows: Array<{
      keyword: string
      keyword_group_id?: string | null
      url?: string | null
      priority?: number
      notes?: string | null
      target_country?: string
      language?: string
      tags?: string[] | null
      target_position?: number | null
    }>,
    opts: { updated_by_user_id?: string } = {},
  ): Promise<{
    inserted: number
    updated: number
    errors: Array<{ index: number; keyword: string; error: string }>
  }> {
    if (rows.length > OvoService.KEYWORD_TARGET_BULK_IMPORT_CAP) {
      throw new Error(
        `bulk import exceeds cap (${OvoService.KEYWORD_TARGET_BULK_IMPORT_CAP})`,
      )
    }

    let inserted = 0
    let updated = 0
    const errors: Array<{ index: number; keyword: string; error: string }> =
      []

    for (let i = 0; i < rows.length; i++) {
      const r = rows[i]
      try {
        // Detect insert vs update by checking pre-existence.
        const normalized = normalizeKeyword(r.keyword)
        const pre = await this.listOvoSeoKeywordTargets(
          {
            normalized_keyword: normalized,
            target_country: (r.target_country ?? "IN").toUpperCase(),
            language: (r.language ?? "en").toLowerCase(),
          } as any,
          { take: 1 } as any,
        )
        await this.upsertKeywordTarget(r, opts)
        if (pre[0]) updated++
        else inserted++
      } catch (err: any) {
        const msg =
          err instanceof KeywordNormalisationError
            ? `${err.code}: ${err.message}`
            : err?.message ?? "unknown error"
        errors.push({ index: i, keyword: r.keyword, error: msg })
      }
    }

    return { inserted, updated, errors }
  }

  /**
   * Phase 8.D — funnel-stage mix across all active keyword targets.
   * Returns counts and percent share per intent. Drives the small
   * stacked-bar visualisation at the top of the Keywords tab so
   * admins see if their tracked terms are biased to one funnel
   * stage (a common content-strategy red flag).
   *
   * Only non-paused, active targets are counted — keeps the chart
   * a forward-looking view of the live programme rather than a
   * historical archive.
   */
  async getKeywordIntentMix(): Promise<{
    total: number
    by_intent: {
      informational: number
      navigational: number
      transactional: number
      commercial: number
    }
    pct: {
      informational: number
      navigational: number
      transactional: number
      commercial: number
    }
  }> {
    const rows = await (this as any).listOvoSeoKeywordTargets(
      { is_active: true, status: ["tracking", "won", "lost"] } as any,
      { take: 5000 } as any,
    )
    const by_intent = {
      informational: 0,
      navigational: 0,
      transactional: 0,
      commercial: 0,
    }
    for (const r of rows as Array<{ search_intent?: SearchIntent }>) {
      const k = r.search_intent ?? "informational"
      if (k in by_intent) by_intent[k] += 1
    }
    const total = by_intent.informational + by_intent.navigational +
      by_intent.transactional + by_intent.commercial
    const pct = {
      informational: total ? Math.round((by_intent.informational / total) * 100) : 0,
      navigational: total ? Math.round((by_intent.navigational / total) * 100) : 0,
      transactional: total ? Math.round((by_intent.transactional / total) * 100) : 0,
      commercial: total ? Math.round((by_intent.commercial / total) * 100) : 0,
    }
    return { total, by_intent, pct }
  }

  /**
   * One-shot backfill — recompute `search_intent` for every keyword
   * target using the current classifier. Useful right after the
   * Phase 8.D migration ships (default-filled rows get their actual
   * classification) and any time the classifier rules evolve.
   *
   * Operator-triggered via `POST /admin/ovo/seo/keywords/backfill-intent`;
   * not on a cron because classification is deterministic and stable
   * once a corpus stops growing.
   */
  async backfillKeywordIntent(): Promise<{
    updated: number
    by_intent: Record<SearchIntent, number>
  }> {
    const rows = await (this as any).listOvoSeoKeywordTargets(
      {} as any,
      { take: 10_000 } as any,
    )
    let updated = 0
    const by_intent: Record<SearchIntent, number> = {
      informational: 0,
      navigational: 0,
      transactional: 0,
      commercial: 0,
    }
    for (const r of rows as Array<{ id: string; keyword: string; search_intent?: SearchIntent }>) {
      const next = classifyIntent(r.keyword).intent
      by_intent[next] += 1
      if (r.search_intent !== next) {
        await (this as any).updateOvoSeoKeywordTargets({
          selector: { id: r.id },
          data: { search_intent: next },
        })
        updated += 1
      }
    }
    return { updated, by_intent }
  }

  /** Reassign one or more keyword targets to a different group (or
   *  ungrouped if `group_id` is null). No-ops on ids that don't exist. */
  async moveKeywordsToGroup(
    target_ids: string[],
    group_id: string | null,
  ): Promise<{ moved: number }> {
    if (target_ids.length === 0) return { moved: 0 }
    await this.updateOvoSeoKeywordTargets({
      selector: { id: target_ids } as any,
      data: { keyword_group_id: group_id } as any,
    })
    return { moved: target_ids.length }
  }

  /**
   * Join keyword targets with the latest GSC dimension-rollup data so
   * the admin "Keywords" tab can render position / clicks /
   * impressions / CTR per target without an extra round-trip.
   *
   * Phase 1: prefers the new `ovo_seo_keyword_perf_snapshot` table
   * when a snapshot exists for the target. Falls back to the legacy
   * dimension-rollup join when no snapshot exists yet (the daily
   * rollup hasn't run, or the keyword has never been impressioned).
   *
   * Output shape adds the new columns (group_id, status,
   * target_position, etc.) so the new admin tab can render them
   * inline.
   */
  async listKeywordTargetsWithPerformance(
    opts: {
      group_id?: string | null
      status?: string
      q?: string
      tag?: string
      limit?: number
      offset?: number
    } = {},
  ): Promise<
    Array<{
      id: string
      url: string | null
      keyword: string
      normalized_keyword: string
      keyword_group_id: string | null
      priority: number
      notes: string | null
      status: string
      target_position: number | null
      is_active: boolean
      tags: string[] | null
      clicks: number | null
      impressions: number | null
      ctr: number | null
      position: number | null
      captured_at: string | null
      source: "snapshot" | "rollup" | "none"
    }>
  > {
    const targets = await this.listKeywordTargets(opts)
    const ids = targets.map((t: any) => t.id)

    // Pull last-known snapshots in one query — order by date DESC,
    // take the most recent per target_id.
    const snapshots =
      ids.length === 0
        ? []
        : await this.listOvoSeoKeywordPerfSnapshots(
            { keyword_target_id: ids } as any,
            { take: 5000, order: { date: "DESC" } } as any,
          )
    const latestSnap = new Map<string, any>()
    for (const s of snapshots) {
      const k = (s as any).keyword_target_id as string
      if (!latestSnap.has(k)) latestSnap.set(k, s)
    }

    // Fallback rollup index (legacy path for targets without
    // snapshots yet).
    const rollups = await this.listOvoSeoDimensionRollups(
      { engine: "gsc", dimension_type: "query" } as any,
      { take: 2000 } as any,
    )
    const byKey = new Map<string, any>()
    for (const r of rollups) {
      const k = (
        (r as any).dimension_value as string | undefined
      )?.toLowerCase()
      if (!k) continue
      if (
        !byKey.has(k) ||
        new Date((r as any).captured_at) >
          new Date(byKey.get(k).captured_at)
      ) {
        byKey.set(k, r)
      }
    }

    return targets.map((t: any) => {
      const snap = latestSnap.get(t.id)
      if (snap) {
        return {
          id: t.id,
          url: t.url ?? null,
          keyword: t.keyword,
          normalized_keyword: t.normalized_keyword,
          keyword_group_id: t.keyword_group_id ?? null,
          priority: t.priority,
          notes: t.notes ?? null,
          status: t.status ?? "tracking",
          target_position: t.target_position ?? null,
          is_active: t.is_active ?? true,
          tags: Array.isArray(t.tags) ? t.tags : null,
          clicks: Number(snap.clicks ?? 0),
          impressions: Number(snap.impressions ?? 0),
          ctr: Number(snap.ctr ?? 0),
          position: snap.position == null ? null : Number(snap.position),
          captured_at: new Date(snap.captured_at).toISOString(),
          source: "snapshot" as const,
        }
      }
      const r = byKey.get(
        (t.normalized_keyword as string | undefined)?.toLowerCase() ??
          (t.keyword as string).toLowerCase(),
      )
      if (r) {
        return {
          id: t.id,
          url: t.url ?? null,
          keyword: t.keyword,
          normalized_keyword: t.normalized_keyword,
          keyword_group_id: t.keyword_group_id ?? null,
          priority: t.priority,
          notes: t.notes ?? null,
          status: t.status ?? "tracking",
          target_position: t.target_position ?? null,
          is_active: t.is_active ?? true,
          tags: Array.isArray(t.tags) ? t.tags : null,
          clicks: Number(r.clicks),
          impressions: Number(r.impressions),
          ctr: Number(r.ctr),
          position: r.position == null ? null : Number(r.position),
          captured_at: new Date(r.captured_at).toISOString(),
          source: "rollup" as const,
        }
      }
      return {
        id: t.id,
        url: t.url ?? null,
        keyword: t.keyword,
        normalized_keyword: t.normalized_keyword,
        keyword_group_id: t.keyword_group_id ?? null,
        priority: t.priority,
        notes: t.notes ?? null,
        status: t.status ?? "tracking",
        target_position: t.target_position ?? null,
        is_active: t.is_active ?? true,
        tags: Array.isArray(t.tags) ? t.tags : null,
        clicks: null,
        impressions: null,
        ctr: null,
        position: null,
        captured_at: null,
        source: "none" as const,
      }
    })
  }

  /* ── Keyword groups (Phase 1) ─────────────────────────────────── */

  /**
   * List keyword groups. Default order: priority ASC then sort_order
   * ASC then name ASC — admin sidebar wants pillar+brand groups at
   * the top.
   */
  async listKeywordGroups(
    opts: {
      funnel_stage?: "TOFU" | "MOFU" | "BOFU"
      is_pillar?: boolean
      parent_group_id?: string | null
    } = {},
  ): Promise<any[]> {
    const filter: Record<string, unknown> = {}
    if (opts.funnel_stage) filter.funnel_stage = opts.funnel_stage
    if (opts.is_pillar !== undefined) filter.is_pillar = opts.is_pillar
    if (opts.parent_group_id !== undefined)
      filter.parent_group_id = opts.parent_group_id
    return this.listOvoSeoKeywordGroups(filter, {
      take: 1000,
      order: {
        priority: "ASC",
        sort_order: "ASC",
        name: "ASC",
      },
    } as any)
  }

  /** Create or update a keyword group. Validates `slug` uniqueness
   *  among non-deleted rows (the DB partial-unique index enforces
   *  it; this throws a friendlier error). */
  async saveKeywordGroup(
    patch: {
      id?: string
      name: string
      slug: string
      description?: string | null
      color?: string | null
      icon?: string | null
      parent_group_id?: string | null
      priority?: number
      sort_order?: number
      intent?:
        | "transactional"
        | "informational"
        | "commercial"
        | "navigational"
        | "comparison"
        | null
      funnel_stage?: "TOFU" | "MOFU" | "BOFU" | null
      is_pillar?: boolean
      audit_weight?: number
    },
  ): Promise<any> {
    if (patch.id) {
      await this.updateOvoSeoKeywordGroups({
        selector: { id: patch.id },
        data: patch as any,
      })
      const refreshed = await this.listOvoSeoKeywordGroups(
        { id: patch.id } as any,
        { take: 1 } as any,
      )
      return refreshed[0]
    }
    // Collision check on slug (DB index also enforces; this gives a
    // friendlier 4xx instead of a 5xx).
    const dup = await this.listOvoSeoKeywordGroups(
      { slug: patch.slug } as any,
      { take: 1 } as any,
    )
    if (dup[0]) {
      throw new Error(`keyword group slug already exists: ${patch.slug}`)
    }
    return this.createOvoSeoKeywordGroups(patch as any)
  }

  /** Soft-delete a keyword group. Reassigns any child groups +
   *  member targets to "ungrouped" so they don't disappear from the
   *  admin UI. */
  async deleteKeywordGroup(id: string): Promise<void> {
    // Reparent direct child groups.
    await this.updateOvoSeoKeywordGroups({
      selector: { parent_group_id: id } as any,
      data: { parent_group_id: null } as any,
    })
    // Unassign member targets.
    await this.updateOvoSeoKeywordTargets({
      selector: { keyword_group_id: id } as any,
      data: { keyword_group_id: null } as any,
    })
    await this.deleteOvoSeoKeywordGroups([id] as any)
  }

  /* ── Keyword performance rollup (Phase 1) ─────────────────────── */

  /**
   * Roll up one day of GSC query history into per-target snapshots.
   * Called by `jobs/keyword-performance-rollup.ts` at 02:00 IST daily
   * with `date = yesterday at UTC midnight`.
   *
   * Matching strategy (v1): exact match on `normalized_keyword`. The
   * cron picks up the wider trigram-fuzzy matching in v2 once we
   * have enough variant-data to tune the similarity threshold.
   *
   * Side effects:
   *   - Inserts (or upserts) one `ovo_seo_keyword_perf_snapshot` row
   *     per matched (target, engine, day) tuple.
   *   - Auto-flips `KeywordTarget.status` when `target_position` is
   *     set: position ≤ target → "won"; status was "won" but position
   *     regressed by > `lost_regression_ranks` (default 3) → "lost".
   *   - Prunes snapshots older than `KEYWORD_PERF_RETENTION_DAYS`.
   */
  async rollupKeywordPerformance(
    date: Date,
  ): Promise<{
    snapshots_written: number
    targets_skipped: number
    status_flipped: number
  }> {
    const dayStart = new Date(
      Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()),
    )
    const dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000)

    const targets = await this.listOvoSeoKeywordTargets(
      { is_active: true } as any,
      { take: 5000 } as any,
    )
    if (targets.length === 0) {
      return { snapshots_written: 0, targets_skipped: 0, status_flipped: 0 }
    }

    // Pull all GSC query-history rows for the day. The rollup window
    // is one day, so the row count is bounded by GSC's per-day query
    // cardinality (a few thousand at most for a site our size).
    const dayRows = await this.listOvoSeoQueryHistories(
      {
        engine: "gsc",
        date: { $gte: dayStart, $lt: dayEnd },
      } as any,
      { take: 10_000 } as any,
    )

    // Index dayRows by normalised query for O(1) lookup per target.
    const byNorm = new Map<
      string,
      { clicks: number; impressions: number; position: number; query: string }
    >()
    for (const row of dayRows as any[]) {
      const n = tryNormalizeKeyword(row.query)
      if (!n) continue
      const existing = byNorm.get(n)
      if (!existing) {
        byNorm.set(n, {
          clicks: Number(row.clicks),
          impressions: Number(row.impressions),
          position: Number(row.position),
          query: row.query,
        })
      } else {
        // Multiple history rows shouldn't share the same normalised
        // query within a day (unique index), but if they do we sum
        // clicks/impressions and impression-weighted-average position.
        const totImp = existing.impressions + Number(row.impressions)
        const newPos =
          totImp > 0
            ? (existing.position * existing.impressions +
                Number(row.position) * Number(row.impressions)) /
              totImp
            : existing.position
        byNorm.set(n, {
          clicks: existing.clicks + Number(row.clicks),
          impressions: totImp,
          position: newPos,
          query: existing.query,
        })
      }
    }

    const cfg = await this.loadSetting()
    const tracking = (cfg.keyword_tracking ?? {}) as Record<string, any>
    const autoStatus = (tracking.auto_status_threshold ?? {}) as Record<
      string,
      any
    >
    const wonPositionMax = Number(autoStatus.won_position_max ?? 10)
    const lostRegressionRanks = Number(
      autoStatus.lost_regression_ranks ?? 3,
    )

    let snapshots_written = 0
    let targets_skipped = 0
    let status_flipped = 0

    for (const t of targets as any[]) {
      const norm = t.normalized_keyword as string | undefined
      if (!norm) {
        targets_skipped++
        continue
      }
      const match = byNorm.get(norm)
      if (!match) {
        targets_skipped++
        continue
      }

      const ctr =
        match.impressions > 0 ? match.clicks / match.impressions : 0

      // Upsert by natural key (target, engine, date).
      const existing = await this.listOvoSeoKeywordPerfSnapshots(
        {
          keyword_target_id: t.id,
          engine: "gsc",
          date: dayStart,
        } as any,
        { take: 1 } as any,
      )

      const payload = {
        keyword_target_id: t.id,
        engine: "gsc" as const,
        date: dayStart,
        clicks: match.clicks,
        impressions: match.impressions,
        ctr,
        position: match.position,
        indexed: match.impressions > 0,
        top_url: t.url ?? null,
        captured_at: new Date(),
      }

      if (existing[0]) {
        await this.updateOvoSeoKeywordPerfSnapshots({
          selector: { id: (existing[0] as any).id },
          data: payload as any,
        })
      } else {
        await this.createOvoSeoKeywordPerfSnapshots(payload as any)
      }
      snapshots_written++

      // Auto-flip status if target_position is set.
      if (t.target_position != null) {
        const pos = match.position
        if (pos <= t.target_position && t.status !== "won") {
          await this.updateOvoSeoKeywordTargets({
            selector: { id: t.id },
            data: { status: "won" } as any,
          })
          status_flipped++
        } else if (
          t.status === "won" &&
          pos > t.target_position + lostRegressionRanks
        ) {
          await this.updateOvoSeoKeywordTargets({
            selector: { id: t.id },
            data: { status: "lost" } as any,
          })
          status_flipped++
        }
      }
    }

    // Prune snapshots older than retention.
    const pruneBefore = new Date(
      Date.now() -
        OvoService.KEYWORD_PERF_RETENTION_DAYS * 24 * 60 * 60 * 1000,
    )
    await this.deleteOvoSeoKeywordPerfSnapshots({
      date: { $lt: pruneBefore },
    } as any)

    // Soft-unused — silence eslint warnings about the constant.
    void wonPositionMax

    return { snapshots_written, targets_skipped, status_flipped }
  }

  /**
   * Per-target trend data for the keyword detail drawer. Returns
   * one point per day for the window.
   */
  async getKeywordPerformance(
    target_id: string,
    window_days?: number,
  ): Promise<{
    series: Array<{
      date: string
      clicks: number
      impressions: number
      ctr: number
      position: number | null
      indexed: boolean
    }>
    latest: {
      date: string
      clicks: number
      impressions: number
      ctr: number
      position: number | null
    } | null
  }> {
    const days = Math.min(
      window_days ?? OvoService.KEYWORD_PERF_DEFAULT_WINDOW_DAYS,
      OvoService.KEYWORD_PERF_RETENTION_DAYS,
    )
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000)
    const rows = await this.listOvoSeoKeywordPerfSnapshots(
      {
        keyword_target_id: target_id,
        date: { $gte: since },
      } as any,
      { take: days + 7, order: { date: "ASC" } } as any,
    )
    const series = (rows as any[]).map((r) => ({
      date: new Date(r.date).toISOString().slice(0, 10),
      clicks: Number(r.clicks),
      impressions: Number(r.impressions),
      ctr: Number(r.ctr),
      position: r.position == null ? null : Number(r.position),
      indexed: !!r.indexed,
    }))
    const last = series[series.length - 1] ?? null
    return {
      series,
      latest: last
        ? {
            date: last.date,
            clicks: last.clicks,
            impressions: last.impressions,
            ctr: last.ctr,
            position: last.position,
          }
        : null,
    }
  }

  /**
   * Aggregated rollup for the Groups Performance dashboard. Joins
   * targets in a group with their snapshots, computes totals + trend
   * + volatility (variance of avg_position across days).
   */
  async getGroupPerformanceSummary(
    group_id: string,
    window_days?: number,
  ): Promise<{
    group_id: string
    window_days: number
    targets_tracked: number
    targets_won: number
    clicks_total: number
    impressions_total: number
    ctr_avg: number
    avg_position: number | null
    volatility: number | null
    trend: Array<{
      date: string
      clicks: number
      impressions: number
      avg_position: number | null
    }>
  }> {
    const days = Math.min(
      window_days ?? OvoService.KEYWORD_PERF_DEFAULT_WINDOW_DAYS,
      OvoService.KEYWORD_PERF_RETENTION_DAYS,
    )
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000)

    const targets = await this.listOvoSeoKeywordTargets(
      { keyword_group_id: group_id, is_active: true } as any,
      { take: 5000 } as any,
    )
    const targets_tracked = targets.length
    const targets_won = (targets as any[]).filter(
      (t) => t.status === "won",
    ).length
    if (targets_tracked === 0) {
      return {
        group_id,
        window_days: days,
        targets_tracked: 0,
        targets_won: 0,
        clicks_total: 0,
        impressions_total: 0,
        ctr_avg: 0,
        avg_position: null,
        volatility: null,
        trend: [],
      }
    }

    const ids = (targets as any[]).map((t) => t.id)
    const snapshots = await this.listOvoSeoKeywordPerfSnapshots(
      {
        keyword_target_id: ids,
        date: { $gte: since },
      } as any,
      { take: 20_000, order: { date: "ASC" } } as any,
    )

    let clicks_total = 0
    let impressions_total = 0
    const byDay = new Map<
      string,
      {
        clicks: number
        impressions: number
        pos_weighted_sum: number
        pos_weight: number
      }
    >()
    for (const s of snapshots as any[]) {
      clicks_total += Number(s.clicks)
      impressions_total += Number(s.impressions)
      const day = new Date(s.date).toISOString().slice(0, 10)
      const bucket = byDay.get(day) ?? {
        clicks: 0,
        impressions: 0,
        pos_weighted_sum: 0,
        pos_weight: 0,
      }
      bucket.clicks += Number(s.clicks)
      bucket.impressions += Number(s.impressions)
      if (s.position != null && Number(s.impressions) > 0) {
        bucket.pos_weighted_sum +=
          Number(s.position) * Number(s.impressions)
        bucket.pos_weight += Number(s.impressions)
      }
      byDay.set(day, bucket)
    }

    const trend = Array.from(byDay.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, b]) => ({
        date,
        clicks: b.clicks,
        impressions: b.impressions,
        avg_position:
          b.pos_weight > 0 ? b.pos_weighted_sum / b.pos_weight : null,
      }))

    const ctr_avg =
      impressions_total > 0 ? clicks_total / impressions_total : 0

    // Overall avg_position — impression-weighted across the window.
    let posSum = 0
    let posWeight = 0
    for (const b of byDay.values()) {
      posSum += b.pos_weighted_sum
      posWeight += b.pos_weight
    }
    const avg_position = posWeight > 0 ? posSum / posWeight : null

    // Volatility — sample variance of per-day avg_position
    // (positions only; days with no impressions skipped).
    const pos_days = trend
      .map((d) => d.avg_position)
      .filter((p): p is number => p != null)
    let volatility: number | null = null
    if (pos_days.length > 1) {
      const mean = pos_days.reduce((a, b) => a + b, 0) / pos_days.length
      const ssq = pos_days.reduce((a, b) => a + (b - mean) ** 2, 0)
      volatility = ssq / (pos_days.length - 1)
    }

    return {
      group_id,
      window_days: days,
      targets_tracked,
      targets_won,
      clicks_total,
      impressions_total,
      ctr_avg,
      avg_position,
      volatility,
      trend,
    }
  }

  /* ── Internal-link suggester (Phase 7.B) ────────────────────── */

  /**
   * Suggest internal source URLs to link FROM, so the operator can
   * resolve a `low_internal_links` finding (or fast-track a
   * "Discovered / not indexed" or "unknown to Google" URL into the
   * indexed set).
   *
   * Algorithm — Jaccard similarity between two URLs' "topic bags"
   * built from already-audited fields:
   *
   *   topic_bag = stems of (title + h1 + meta_description + jsonld_types)
   *
   * The audit data is the input — no fresh HTML fetch. Cheap to run on
   * every Audit-tab row expansion.
   *
   * Per candidate source URL we also report:
   *   - `similarity`: 0..1 Jaccard.
   *   - `shared_terms`: the actual stem overlap (so the operator can
   *     verify the suggestion isn't accidental, e.g. both pages
   *     happen to use the word "fund").
   *
   * Returns null if the target URL has no audit row yet.
   */
  async getInternalLinkSuggestions(
    targetUrl: string,
    limit = 8,
  ): Promise<{
    target: string
    suggestions: Array<{
      source_url: string
      title: string | null
      similarity: number
      shared_terms: string[]
    }>
  } | null> {
    const all = await this.listOvoSeoAudits({}, { take: 5000 } as any)
    const target = all.find((r: any) => r.url === targetUrl)
    if (!target) return null

    const targetBag = topicBag(target as any)
    if (targetBag.size === 0) {
      return { target: targetUrl, suggestions: [] }
    }

    const scored: Array<{
      source_url: string
      title: string | null
      similarity: number
      shared_terms: string[]
    }> = []
    for (const r of all) {
      const row = r as any
      if (row.url === targetUrl) continue
      // Exclude URLs that are themselves un-fetched / 4xx — linking
      // from a dead-end page doesn't help discoverability.
      if (row.status_code !== 0 && row.status_code >= 400) continue
      const bag = topicBag(row)
      if (bag.size === 0) continue
      const intersection: string[] = []
      for (const t of bag) {
        if (targetBag.has(t)) intersection.push(t)
      }
      if (intersection.length === 0) continue
      const union = new Set([...bag, ...targetBag])
      const similarity = intersection.length / union.size
      scored.push({
        source_url: row.url,
        title: row.title,
        similarity,
        shared_terms: intersection.slice(0, 10),
      })
    }
    scored.sort((a, b) => b.similarity - a.similarity)
    return {
      target: targetUrl,
      suggestions: scored.slice(0, limit),
    }
  }

  /* ── GSC URL Inspection batch (Phase 7.A) ───────────────────── */

  /** Daily cron-friendly URL Inspection retention. 30 days is enough
   *  to chart "indexed coverage over time" without bloating the DB. */
  static readonly URL_INDEX_RETENTION_DAYS = 30

  /** Concurrency cap for the URL Inspection call. GSC's per-property
   *  quota is 2000/day; the per-second rate limit is implicit but
   *  conservative. 4 concurrent calls × ~500ms each = ~150 URLs in
   *  ~20 seconds. Plenty of headroom on quota. */
  private static readonly URL_INDEX_CONCURRENCY = 4

  /**
   * Walk the live sitemap-index and ask GSC's URL Inspection API for
   * the authoritative index status of each URL. Persists one row per
   * (URL, run) into `ovo_seo_url_index`; the admin tab reads the
   * latest row per URL via descending-time index.
   *
   * Why this matters: GSC's search-analytics endpoint only reports
   * URLs that had ≥ 1 impression in the window — brand-new URLs and
   * URLs that haven't been served yet are invisible. URL Inspection
   * is the authoritative "did Google index this URL" answer. The
   * single most important signal for "why isn't this ranking?".
   *
   * Soft-fails when GSC creds are missing (returns zero-rows count).
   */
  async runUrlIndexInspection(opts: { limit?: number } = {}): Promise<{
    inspected: number
    indexed: number
    not_indexed: number
    failed: number
  }> {
    const creds = await this.getApiCredentials()
    const cfg = parseGscConfig(
      creds.gsc_service_account_json ?? undefined,
      (process.env.OVO_GSC_PROPERTY || process.env.GSC_SITE_URL),
    )
    if (!cfg) {
      return { inspected: 0, indexed: 0, not_indexed: 0, failed: 0 }
    }

    const siteUrl =
      process.env.NEXT_PUBLIC_SITE_URL ||
      process.env.STOREFRONT_URL ||
      resolveDefaultSiteUrl()
    const sitemapIndex = `${siteUrl.replace(/\/$/, "")}/sitemap.xml`
    const fetched = await fetchAllSitemapUrls(sitemapIndex)
    const urls = opts.limit ? fetched.urls.slice(0, opts.limit) : fetched.urls

    let indexed = 0
    let not_indexed = 0
    let failed = 0
    const inspectedAt = new Date()

    const chunk = OvoService.URL_INDEX_CONCURRENCY
    for (let i = 0; i < urls.length; i += chunk) {
      const batch = urls.slice(i, i + chunk)
      const results = await Promise.all(
        batch.map((u) => fetchGscUrlIndex(cfg, u)),
      )
      for (let j = 0; j < batch.length; j += 1) {
        const url = batch[j]
        const r = results[j]
        if (!r) {
          failed += 1
          await this.persistUrlIndex(url, inspectedAt, null)
          continue
        }
        if (r.is_indexed) indexed += 1
        else not_indexed += 1
        await this.persistUrlIndex(url, inspectedAt, r)
      }
    }

    await this.pruneOldUrlIndexRows()
    return {
      inspected: urls.length,
      indexed,
      not_indexed,
      failed,
    }
  }

  /**
   * Single-URL inspection. Used by the admin tab's "Inspect now"
   * button for fast feedback after fixing an indexing issue.
   */
  async inspectOneUrlIndex(url: string): Promise<{
    url: string
    indexed: boolean
    coverage: string | null
    verdict: string
  }> {
    const creds = await this.getApiCredentials()
    const cfg = parseGscConfig(
      creds.gsc_service_account_json ?? undefined,
      (process.env.OVO_GSC_PROPERTY || process.env.GSC_SITE_URL),
    )
    if (!cfg) {
      throw new Error("gsc_not_configured")
    }
    const r = await fetchGscUrlIndex(cfg, url)
    await this.persistUrlIndex(url, new Date(), r)
    return {
      url,
      indexed: r?.is_indexed ?? false,
      coverage: r?.coverage_state ?? null,
      verdict: r?.verdict ?? "VERDICT_UNSPECIFIED",
    }
  }

  /** Internal helper: write one inspection row. */
  private async persistUrlIndex(
    url: string,
    inspectedAt: Date,
    r: Awaited<ReturnType<typeof fetchGscUrlIndex>>,
  ): Promise<void> {
    try {
      // Medusa's generated method name is the LATIN plural
      // (`Indices`); its inferred TypeScript types claim the English
      // plural (`Indexes`). Calling `Indexes` builds clean but throws
      // "is not a function" at runtime. `as any` bypasses the
      // mis-inferred type until Medusa fixes the inflection.
      await (this as any).createOvoSeoUrlIndices({
        url,
        inspected_at: inspectedAt,
        verdict: r?.verdict ?? "FETCH_FAILED",
        coverage_state: r?.coverage_state ?? null,
        last_crawl_time: r?.last_crawl_time ?? null,
        page_fetch_state: r?.page_fetch_state ?? null,
        robots_txt_state: r?.robots_txt_state ?? null,
        indexing_state: r?.indexing_state ?? null,
        mobile_usability_verdict: r?.mobile_usability_verdict ?? null,
        rich_results_verdict: r?.rich_results_verdict ?? null,
        google_canonical: r?.google_canonical ?? null,
        is_indexed: r?.is_indexed ?? false,
        is_blocked_by_robots: r?.is_blocked_by_robots ?? false,
        has_mobile_issues: r?.has_mobile_issues ?? false,
        raw_response: r?.raw ?? null,
      } as any)
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn("ovo: persist URL Inspection row failed", { url, err })
    }
  }

  /** Drop URL-inspection rows older than retention horizon. */
  private async pruneOldUrlIndexRows(): Promise<void> {
    const horizon = new Date(
      Date.now() - OvoService.URL_INDEX_RETENTION_DAYS * 24 * 60 * 60 * 1000,
    )
    try {
      const stale = await (this as any).listOvoSeoUrlIndices(
        { inspected_at: { $lt: horizon } as any },
        { take: 5000 } as any,
      )
      if (stale.length > 0) {
        await (this as any).deleteOvoSeoUrlIndices(
          stale.map((r: any) => r.id),
        )
      }
    } catch {
      /* non-fatal */
    }
  }

  /**
   * Read-side: latest inspection per URL plus a top-level coverage
   * summary. Admin tab consumes this directly.
   *
   * Implementation: list rows ordered DESC by `inspected_at`, then
   * collapse to "first row per URL" in-memory. Cheap because the
   * total row count is bounded by URL_INDEX_RETENTION_DAYS × URL count.
   */
  /**
   * Crawl-freshness diff (Phase 8.A).
   *
   * For each URL in the sitemap, joins:
   *   - `<lastmod>` claimed by the sitemap (our authoritative "this is
   *     when the URL changed")
   *   - `last_crawl_time` reported by GSC URL Inspection (Googlebot's
   *     last visit)
   *   - `coverage_state` (Submitted/Indexed, Discovered/not indexed,
   *     URL unknown to Google, etc.)
   *
   * Surfaces TWO operationally-distinct categories of "stuck" URLs:
   *
   *   1. **stale_crawl** — `lastmod > last_crawl_time`. We've updated
   *      the page; Googlebot hasn't seen the change yet. IndexNow ping
   *      is the right action.
   *
   *   2. **never_indexed** — coverage_state ∈ ("URL unknown to Google",
   *      "Discovered - currently not indexed"). Needs internal-link
   *      discovery (Phase 7.B) + IndexNow ping.
   *
   * The admin tab uses both buckets to bulk-trigger IndexNow.
   *
   * Pure compute — no extra storage. Both source datasets refresh
   * daily via existing crons (audit, URL Inspection).
   */
  async getCrawlFreshness(): Promise<{
    rows: Array<{
      url: string
      lastmod: string | null
      last_crawl_time: string | null
      coverage_state: string | null
      is_indexed: boolean
      stale_crawl: boolean
      never_indexed: boolean
      gap_days: number | null
    }>
    summary: {
      total: number
      stale_crawl: number
      never_indexed: number
      both: number
      // Number of rows the operator would benefit from IndexNow-pinging
      // (union of the two buckets). The admin button uses this.
      actionable: number
    }
  }> {
    const siteUrl =
      process.env.NEXT_PUBLIC_SITE_URL ||
      process.env.STOREFRONT_URL ||
      resolveDefaultSiteUrl()
    const sitemapIndex = `${siteUrl.replace(/\/$/, "")}/sitemap.xml`
    const fetched = await fetchAllSitemapEntries(sitemapIndex)

    // Index inspection rows by URL for the join.
    const latest = await (this as any).listOvoSeoUrlIndices(
      {},
      { take: 5000, order: { inspected_at: "DESC" } } as any,
    )
    const byUrl = new Map<string, any>()
    for (const r of latest) {
      const u = (r as any).url as string
      if (!byUrl.has(u)) byUrl.set(u, r)
    }

    const NEVER_INDEXED_COVERAGES = new Set([
      "URL is unknown to Google",
      "Discovered - currently not indexed",
    ])

    let stale = 0
    let never = 0
    let both = 0
    const rows = fetched.entries.map((e) => {
      const insp = byUrl.get(e.url)
      const coverage = (insp?.coverage_state ?? null) as string | null
      const is_indexed = !!insp?.is_indexed
      const last_crawl_time = (insp?.last_crawl_time ?? null) as
        | string
        | null

      // Stale-crawl detection: only meaningful when BOTH timestamps
      // exist. If sitemap doesn't emit lastmod (most product pages),
      // we can't say anything — leave stale_crawl = false.
      let stale_crawl = false
      let gap_days: number | null = null
      if (e.lastmod && last_crawl_time) {
        const lastmodT = Date.parse(e.lastmod)
        const lastCrawlT = Date.parse(last_crawl_time)
        if (Number.isFinite(lastmodT) && Number.isFinite(lastCrawlT)) {
          gap_days = Math.round(
            (lastmodT - lastCrawlT) / (24 * 60 * 60 * 1000),
          )
          stale_crawl = gap_days > 0
        }
      }
      const never_indexed =
        !!coverage && NEVER_INDEXED_COVERAGES.has(coverage)

      if (stale_crawl) stale += 1
      if (never_indexed) never += 1
      if (stale_crawl && never_indexed) both += 1

      return {
        url: e.url,
        lastmod: e.lastmod,
        last_crawl_time,
        coverage_state: coverage,
        is_indexed,
        stale_crawl,
        never_indexed,
        gap_days,
      }
    })

    return {
      rows,
      summary: {
        total: rows.length,
        stale_crawl: stale,
        never_indexed: never,
        both,
        actionable: stale + never - both,
      },
    }
  }

  async listUrlIndexLatest(): Promise<{
    rows: any[]
    summary: {
      total: number
      indexed: number
      not_indexed: number
      blocked: number
      last_inspected_at: string | null
    }
  }> {
    const all = await (this as any).listOvoSeoUrlIndices(
      {},
      {
        take: 5000,
        order: { inspected_at: "DESC" },
      } as any,
    )
    const seen = new Set<string>()
    const latest: any[] = []
    for (const r of all) {
      const u = (r as any).url as string
      if (seen.has(u)) continue
      seen.add(u)
      latest.push(r)
    }
    let indexed = 0
    let not_indexed = 0
    let blocked = 0
    let lastAt: number = 0
    for (const r of latest) {
      if ((r as any).is_indexed) indexed += 1
      else not_indexed += 1
      if ((r as any).is_blocked_by_robots) blocked += 1
      const t = new Date((r as any).inspected_at).getTime()
      if (Number.isFinite(t) && t > lastAt) lastAt = t
    }
    return {
      rows: latest,
      summary: {
        total: latest.length,
        indexed,
        not_indexed,
        blocked,
        last_inspected_at: lastAt > 0 ? new Date(lastAt).toISOString() : null,
      },
    }
  }

  /* ── Per-URL audit history (Phase 7.C) ─────────────────────── */

  /** Retention horizon for per-URL audit-history rows. 30 days lets
   *  the Audit tab chart "this URL's quality_score over the last
   *  month" without unbounded growth. */
  static readonly AUDIT_HISTORY_RETENTION_DAYS = 30

  /**
   * Snapshot the per-URL audit signals into `ovo_seo_audit_history`
   * BEFORE the live `ovo_seo_audit` row is overwritten. This is what
   * lets the operator see "this URL regressed from 95 to 70 yesterday".
   */
  private async snapshotAuditHistory(r: AuditResult): Promise<void> {
    try {
      // Compose a compact issue-code summary (code -> count) so the
      // diff view can show "+1 title_long, -1 keyword_missing_in_body".
      const codeCounts: Record<string, number> = {}
      for (const f of r.findings) {
        codeCounts[f.code] = (codeCounts[f.code] ?? 0) + 1
      }
      const errorCount = r.findings.filter((f) => f.severity === "error").length
      const warnCount = r.findings.filter((f) => f.severity === "warn").length
      await (this as any).createOvoSeoAuditHistories({
        url: r.url,
        captured_at: new Date(),
        quality_score: r.quality_score,
        issue_count: r.findings.length,
        error_count: errorCount,
        warn_count: warnCount,
        issue_codes: codeCounts,
      })
      // Bounded prune — drop history older than retention.
      const horizon = new Date(
        Date.now() -
          OvoService.AUDIT_HISTORY_RETENTION_DAYS * 24 * 60 * 60 * 1000,
      )
      const stale = await (this as any).listOvoSeoAuditHistories(
        { captured_at: { $lt: horizon } as any },
        { take: 5000 } as any,
      )
      if (stale.length > 0) {
        await (this as any).deleteOvoSeoAuditHistories(
          stale.map((s: any) => s.id),
        )
      }
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn("ovo: snapshotAuditHistory failed", {
        url: r.url,
        err,
      })
    }
  }

  /**
   * Read-side: per-URL audit history in ascending-time order. Powers
   * the per-URL trend chart on the Audit tab's expanded row. Default
   * limit covers ~30 days of daily snapshots.
   */
  async listAuditHistoryForUrl(
    url: string,
    limit = 60,
  ): Promise<any[]> {
    const rows = await (this as any).listOvoSeoAuditHistories(
      { url },
      {
        take: Math.min(limit, 365),
        order: { captured_at: "ASC" },
      } as any,
    )
    return rows
  }

  /**
   * Read-side: URLs that regressed in the last `windowHours`. Compares
   * each URL's most-recent snapshot against the median of the prior
   * snapshots in the window. A drop of `minDelta` or more in
   * quality_score flags as a regression.
   *
   * Default thresholds: 168 h (1 week) window, min 10-point drop.
   * Returns rows sorted by largest drop first.
   */
  async getRegressionAlerts(opts: {
    window_hours?: number
    min_delta?: number
    limit?: number
  } = {}): Promise<
    Array<{
      url: string
      current_score: number
      previous_score: number
      delta: number
      current_issues: number
      previous_issues: number
      captured_at: string
    }>
  > {
    const windowHours = opts.window_hours ?? 168
    const minDelta = opts.min_delta ?? 10
    const limit = opts.limit ?? 100
    const since = new Date(Date.now() - windowHours * 60 * 60 * 1000)

    const rows = await (this as any).listOvoSeoAuditHistories(
      { captured_at: { $gte: since } as any },
      {
        take: 5000,
        order: { captured_at: "DESC" },
      } as any,
    )

    // Group by URL, keep most-recent + the one before.
    const byUrl = new Map<string, any[]>()
    for (const r of rows) {
      const u = (r as any).url as string
      if (!byUrl.has(u)) byUrl.set(u, [])
      byUrl.get(u)!.push(r)
    }

    const regressions: Array<{
      url: string
      current_score: number
      previous_score: number
      delta: number
      current_issues: number
      previous_issues: number
      captured_at: string
    }> = []
    for (const [u, list] of byUrl.entries()) {
      if (list.length < 2) continue
      const current = list[0] as any
      const previous = list[list.length - 1] as any
      const curScore = Number(current.quality_score ?? 100)
      const prevScore = Number(previous.quality_score ?? 100)
      const delta = curScore - prevScore
      if (delta <= -minDelta) {
        regressions.push({
          url: u,
          current_score: curScore,
          previous_score: prevScore,
          delta,
          current_issues: Number(current.issue_count ?? 0),
          previous_issues: Number(previous.issue_count ?? 0),
          captured_at: new Date(current.captured_at).toISOString(),
        })
      }
    }
    regressions.sort((a, b) => a.delta - b.delta)
    return regressions.slice(0, limit)
  }

  /**
   * Read-side: last N audit runs in descending-time order for the
   * Audit-tab's trend mini-chart. Default 30 runs ≈ 1 month at the
   * 01:30 UTC cron cadence.
   */
  async listSeoAuditRuns(limit = 30): Promise<any[]> {
    return this.listOvoSeoAuditRuns(
      {},
      {
        take: Math.min(limit, 365),
        order: { started_at: "DESC" },
      } as any,
    )
  }

  /**
   * UPSERT one audit row keyed by URL. The natural-unique index on
   * (url) makes "INSERT vs UPDATE" a clean lookup-then-branch — no
   * race conditions because the cron runs single-instance.
   */
  private async upsertAuditRow(r: AuditResult): Promise<void> {
    try {
      const [existing] = await this.listOvoSeoAudits(
        { url: r.url },
        { take: 1 },
      )
      // Snapshot the current state into history BEFORE overwriting the
      // live row. Failure is non-fatal — the live row matters more than
      // the per-URL trend chart.
      await this.snapshotAuditHistory(r)
      const payload = {
        url: r.url,
        audited_at: new Date(),
        status_code: r.status_code,
        response_time_ms: r.response_time_ms,
        title: r.title,
        title_length: r.title_length,
        meta_description: r.meta_description,
        meta_description_length: r.meta_description_length,
        canonical_url: r.canonical_url,
        canonical_ok: r.canonical_ok,
        h1_count: r.h1_count,
        h1_text: r.h1_text,
        h2_count: r.h2_count,
        h3_count: r.h3_count,
        image_count: r.image_count,
        image_missing_alt_count: r.image_missing_alt_count,
        images_missing_dim_count: r.images_missing_dim_count,
        jsonld_count: r.jsonld_count,
        jsonld_invalid_count: r.jsonld_invalid_count,
        jsonld_types: r.jsonld_types,
        word_count: r.word_count,
        has_og_title: r.has_og_title,
        has_og_image: r.has_og_image,
        has_twitter_card: r.has_twitter_card,
        is_https: r.is_https,
        has_viewport: r.has_viewport,
        has_lang: r.has_lang,
        robots_noindex: r.robots_noindex,
        response_bytes: r.response_bytes,
        external_script_count: r.external_script_count,
        internal_link_count: r.internal_link_count,
        external_link_count: r.external_link_count,
        quality_score: r.quality_score,
        target_keywords_match: r.target_keywords ?? null,
        issues: r.findings,
        raw_html_sample: r.html_sample,
      }
      if (existing) {
        await this.updateOvoSeoAudits({
          selector: { id: existing.id },
          data: payload,
        } as any)
      } else {
        await this.createOvoSeoAudits(payload as any)
      }
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn("ovo: upsertAuditRow failed", { url: r.url, err })
    }
  }

  /**
   * Read-side: list audit rows for the admin tab. Filters:
   *   - severity: "error" → only rows with at least one error finding;
   *               "warn"  → at least one warn (and possibly errors);
   *               "all"   → everything (default).
   *   - search: substring match on URL.
   */
  async listSeoAudit(opts: {
    severity?: "error" | "warn" | "all"
    search?: string
    limit?: number
  } = {}): Promise<any[]> {
    const rows = await this.listOvoSeoAudits(
      opts.search
        ? ({ url: { $ilike: `%${opts.search}%` } } as any)
        : {},
      { take: Math.min(opts.limit ?? 500, 2000) } as any,
    )
    if (!opts.severity || opts.severity === "all") return rows
    return rows.filter((r: any) => {
      const issues = Array.isArray(r.issues) ? r.issues : []
      if (opts.severity === "error") {
        return issues.some((f: any) => f.severity === "error")
      }
      return issues.length > 0
    })
  }

  /**
   * Convenience for the admin tab footer: rolled-up counts across all
   * URLs in the current audit snapshot.
   */
  async getSeoAuditSummary(): Promise<{
    total: number
    healthy: number
    warn: number
    error: number
    last_run_at: string | null
  }> {
    const rows = await this.listOvoSeoAudits({}, { take: 5000 } as any)
    let healthy = 0
    let warn = 0
    let error = 0
    let lastRunAt: number = 0
    for (const r of rows) {
      const issues = Array.isArray((r as any).issues)
        ? ((r as any).issues as Array<{ severity: string }>)
        : []
      const hasErr = issues.some((f) => f.severity === "error")
      const hasWarn = issues.some((f) => f.severity === "warn")
      if (hasErr) error += 1
      else if (hasWarn) warn += 1
      else healthy += 1
      const t = new Date((r as any).audited_at).getTime()
      if (Number.isFinite(t) && t > lastRunAt) lastRunAt = t
    }
    return {
      total: rows.length,
      healthy,
      warn,
      error,
      last_run_at: lastRunAt > 0 ? new Date(lastRunAt).toISOString() : null,
    }
  }

  /**
   * Read-side: per-query history. Used by the rank-trend chart on the
   * admin metrics tab. Returns rows ordered by ascending date so the
   * chart can plot directly.
   */
  async listSeoQueryHistory(opts: {
    engine?: string
    query?: string
    from?: Date
    to?: Date
    limit?: number
  } = {}): Promise<any[]> {
    const filter: Record<string, unknown> = {
      engine: opts.engine ?? "gsc",
    }
    if (opts.query) filter.query = opts.query
    if (opts.from || opts.to) {
      const range: Record<string, Date> = {}
      if (opts.from) range.$gte = opts.from
      if (opts.to) range.$lte = opts.to
      filter.date = range as any
    }
    return this.listOvoSeoQueryHistories(filter, {
      take: Math.min(opts.limit ?? 1000, 5000),
      order: { date: "ASC" },
    } as any)
  }

  // ─── API credentials (DB-backed, env fallback) ──────────────────

  /**
   * Resolve the two external-API credentials for ingestion. Lookup
   * order per credential:
   *
   *   1. Encrypted column on the OvoSetting singleton row.
   *   2. Process env var (`GOOGLE_GSC_SERVICE_ACCOUNT_JSON`,
   *      `BING_WEBMASTER_API_KEY`).
   *
   * Each value is the raw string the upstream caller expects — JSON
   * blob for GSC, simple key string for Bing. Returns null when
   * neither source has a value.
   *
   * The decryption is wrapped in try/catch so a corrupt blob doesn't
   * 500 the ingest cron — we fall back to the env var instead.
   */
  /**
   * Keyword opportunities derived from REAL stored keyword-performance
   * snapshots (`ovo_seo_keyword_perf_snapshot`, written by the daily
   * keyword roll-up). Classifies each active target into one of four
   * opportunity types. Returns [] when there are no snapshots yet, so
   * the Opportunities tab shows an honest empty state rather than
   * fabricated rows.
   */
  async detectKeywordOpportunities(
    opts: { window_days?: number; group_id?: string } = {},
  ): Promise<OvoKeywordOpportunity[]> {
    const windowDays = Math.max(7, Math.min(opts.window_days ?? 14, 730))
    const since = new Date()
    since.setUTCDate(since.getUTCDate() - windowDays)
    const sevenDaysAgo = new Date()
    sevenDaysAgo.setUTCDate(sevenDaysAgo.getUTCDate() - 7)

    const targetFilter: Record<string, unknown> = { is_active: true }
    if (opts.group_id) targetFilter.keyword_group_id = opts.group_id
    const targets = (await this.listOvoSeoKeywordTargets(
      targetFilter as any,
      { take: 5000 } as any,
    )) as any[]
    if (!targets || targets.length === 0) return []

    const out: OvoKeywordOpportunity[] = []
    for (const t of targets) {
      const snaps = (await (this as any).listOvoSeoKeywordPerfSnapshots(
        { keyword_target_id: t.id, date: { $gte: since } } as any,
        { take: 1000, order: { date: "ASC" } } as any,
      )) as any[]
      if (!snaps || snaps.length === 0) continue

      const impressions_14d = snaps.reduce(
        (a, s) => a + Number(s.impressions || 0),
        0,
      )
      const clicks_14d = snaps.reduce((a, s) => a + Number(s.clicks || 0), 0)
      const ctr_14d = impressions_14d > 0 ? clicks_14d / impressions_14d : 0
      const positioned = snaps.filter(
        (s) => typeof s.position === "number" && s.position > 0,
      )
      const avg_position_14d = positioned.length
        ? positioned.reduce((a, s) => a + Number(s.position), 0) /
          positioned.length
        : null
      const latest = snaps[snaps.length - 1]
      const current_position =
        typeof latest.position === "number" ? Number(latest.position) : null

      // position_delta_7d: prior (>=7d ago) position minus current.
      // Positive = improvement (rank number went down).
      let position_delta_7d: number | null = null
      const prior = [...snaps]
        .reverse()
        .find(
          (s) =>
            new Date(s.date) <= sevenDaysAgo && typeof s.position === "number",
        )
      if (prior && current_position != null) {
        position_delta_7d = Number(prior.position) - current_position
      }

      // impressions_slope: second-half avg impressions minus first-half.
      const mid = Math.floor(snaps.length / 2)
      const avgImp = (arr: any[]) =>
        arr.length
          ? arr.reduce((a, s) => a + Number(s.impressions || 0), 0) / arr.length
          : 0
      const impressions_slope =
        avgImp(snaps.slice(mid)) - avgImp(snaps.slice(0, Math.max(1, mid)))

      let opportunity_type: OvoKeywordOpportunityType | null = null
      let reason = ""
      if (position_delta_7d != null && position_delta_7d <= -3) {
        opportunity_type = "losing_position"
        reason = `Dropped ${Math.abs(position_delta_7d).toFixed(
          1,
        )} ranks in the last 7 days.`
      } else if (
        current_position != null &&
        current_position >= 11 &&
        current_position <= 20 &&
        impressions_slope >= 0
      ) {
        opportunity_type = "striking_distance"
        reason = `Ranking ${current_position.toFixed(
          1,
        )} (page 2) with steady/rising impressions — a push could reach page 1.`
      } else if (
        current_position != null &&
        current_position >= 4 &&
        current_position <= 20 &&
        impressions_14d >= 50 &&
        ctr_14d < 0.01
      ) {
        opportunity_type = "ctr_optimization"
        reason = `Rank ${current_position.toFixed(
          1,
        )} with ${impressions_14d} impressions but only ${(
          ctr_14d * 100
        ).toFixed(2)}% CTR — improve the title/description.`
      } else if (position_delta_7d != null && position_delta_7d >= 3) {
        opportunity_type = "position_climbing"
        reason = `Improved ${position_delta_7d.toFixed(
          1,
        )} ranks in the last 7 days — reinforce to keep momentum.`
      }
      if (!opportunity_type) continue

      out.push({
        target_id: t.id,
        keyword: t.keyword,
        keyword_group_id: t.keyword_group_id ?? null,
        url: t.url ?? null,
        opportunity_type,
        current_position,
        avg_position_14d,
        impressions_14d,
        clicks_14d,
        ctr_14d,
        impressions_slope,
        position_delta_7d,
        reason,
      })
    }

    const order: Record<OvoKeywordOpportunityType, number> = {
      losing_position: 0,
      striking_distance: 1,
      ctr_optimization: 2,
      position_climbing: 3,
    }
    out.sort(
      (a, b) =>
        order[a.opportunity_type] - order[b.opportunity_type] ||
        b.impressions_14d - a.impressions_14d,
    )
    return out
  }

  /**
   * Keyword cannibalisation detection.
   *
   * Real cannibalisation detection needs the 2-D GSC query×page
   * dimension (one query, multiple owned URLs ranking). This plugin's
   * GSC ingest stores single-dimension roll-ups only, so the pair data
   * isn't available — we return [] and the Cannibalisation tab shows its
   * honest "run GSC dimension sync" state rather than fabricated
   * findings. (Reserved for a future query_page ingest.)
   */
  async detectCannibalization(
    _opts: { window_days?: number; top_n?: number } = {},
  ): Promise<OvoCannibalizationRow[]> {
    const pairs = (await (this as any).listOvoSeoDimensionRollups(
      { dimension_type: "query_page" } as any,
      { take: 1 } as any,
    )) as any[]
    if (!pairs || pairs.length === 0) return []
    // Future: derive competing-URL groups from query_page pairs.
    return []
  }

  /**
   * Per-shard URL counts pulled live from the storefront sitemap. Best
   * effort and storefront-agnostic: tries `${site}/sitemap/<shard>.xml`
   * for each enabled shard and counts URLs. A shard that can't be
   * fetched (different layout, storefront down, no site URL) is reported
   * with `ok: false` so the SEO tab renders a "—" badge instead of
   * erroring.
   */
  async getSitemapShardCounts(): Promise<{
    shards: OvoSitemapShardCount[]
    total: number
    errors: string[]
  }> {
    const row = await this.loadSetting()
    const sitemapUrl = (row as any)?.robots?.sitemap_url as string | undefined
    let base = ""
    try {
      base = sitemapUrl
        ? new URL(sitemapUrl).origin
        : resolveDefaultSiteUrl().replace(/\/$/, "")
    } catch {
      base = resolveDefaultSiteUrl().replace(/\/$/, "")
    }
    if (!base) {
      return { shards: [], total: 0, errors: ["No site URL / sitemap configured"] }
    }
    const enabled = ((row as any)?.sitemap_shards ?? {}) as Record<
      string,
      boolean
    >
    const shardKeys = ["static", "products", "taxonomy", "knowledge"].filter(
      (k) => enabled[k] !== false,
    )
    const shards: OvoSitemapShardCount[] = []
    const errors: string[] = []
    let total = 0
    for (const shard of shardKeys) {
      const url = `${base}/sitemap/${shard}.xml`
      try {
        const fetched = await fetchAllSitemapUrls(url)
        const count = fetched.urls.length
        total += count
        shards.push({ shard, url, count, ok: true })
      } catch (err) {
        const msg = err instanceof Error ? err.message : "fetch_failed"
        errors.push(`${shard}: ${msg}`)
        shards.push({ shard, url, count: 0, ok: false, error: msg })
      }
    }
    return { shards, total, errors }
  }

  /**
   * CrUX / Core Web Vitals field-data ingestion is not bundled in this
   * plugin version. Honest no-op (returns zero, never fabricates CWV
   * numbers). See README "Known limitations".
   */
  async ingestCwvMetrics(): Promise<{ written: number }> {
    return { written: 0 }
  }

  /** Yandex Webmaster integration is not bundled in this plugin version
   *  — honest no-ops (no fabricated metrics). */
  async ingestYandexMetrics(): Promise<{ written: number }> {
    return { written: 0 }
  }
  async ingestYandexQueryRollup(): Promise<{ written: number }> {
    return { written: 0 }
  }
  async discoverAndCacheYandexIds(): Promise<{
    discovered: number
    cached: number
  }> {
    return { discovered: 0, cached: 0 }
  }
  async pushSitemapToYandex(
    _opts: {
      sitemap_url?: string
      triggered_by_user_id?: string | null
    } = {},
  ): Promise<{ ok: boolean; skipped: string }> {
    return { ok: false, skipped: "yandex_not_configured" }
  }

  async getApiCredentials(): Promise<{
    gsc_service_account_json: string | null
    bing_api_key: string | null
    openai_api_key: string | null
    anthropic_api_key: string | null
    perplexity_api_key: string | null
    google_ai_api_key: string | null
  }> {
    const row = await this.loadSetting()
    const dbDecrypt = (cipher: string | null | undefined): string | null => {
      if (!cipher) return null
      try {
        return decryptString(cipher)
      } catch {
        return null
      }
    }
    return {
      gsc_service_account_json:
        dbDecrypt((row as any)?.gsc_service_account_json_encrypted) ??
        (process.env.OVO_GSC_SERVICE_ACCOUNT_JSON || process.env.GOOGLE_GSC_SERVICE_ACCOUNT_JSON) ??
        null,
      bing_api_key:
        dbDecrypt((row as any)?.bing_webmaster_api_key_encrypted) ??
        (process.env.OVO_BING_API_KEY || process.env.BING_WEBMASTER_API_KEY) ??
        null,
      openai_api_key:
        dbDecrypt((row as any)?.openai_api_key_encrypted) ??
        (process.env.OVO_OPENAI_API_KEY || process.env.OPENAI_API_KEY) ??
        null,
      anthropic_api_key:
        dbDecrypt((row as any)?.anthropic_api_key_encrypted) ??
        (process.env.OVO_ANTHROPIC_API_KEY || process.env.ANTHROPIC_API_KEY) ??
        null,
      perplexity_api_key:
        dbDecrypt((row as any)?.perplexity_api_key_encrypted) ??
        (process.env.OVO_PERPLEXITY_API_KEY || process.env.PERPLEXITY_API_KEY) ??
        null,
      google_ai_api_key:
        dbDecrypt((row as any)?.google_ai_api_key_encrypted) ??
        (process.env.OVO_GEMINI_API_KEY || process.env.GOOGLE_AI_API_KEY) ??
        null,
    }
  }

  /**
   * Admin save. Accepts plaintext credential strings, encrypts each,
   * persists on the singleton OvoSetting row. Passing `null` clears
   * that column (forces env fallback). Omitting a field leaves the
   * existing value unchanged.
   *
   * Returns the post-save admin view (mask + last4 + configured-from
   * indicator).
   */
  async saveApiCredentials(input: {
    gsc_service_account_json?: string | null
    bing_api_key?: string | null
    openai_api_key?: string | null
    anthropic_api_key?: string | null
    perplexity_api_key?: string | null
    google_ai_api_key?: string | null
    updated_by_user_id?: string | null
  }): Promise<ApiCredentialsView> {
    const row = await this.loadSetting()
    if (!row) {
      throw new Error("ovo_setting_not_initialised")
    }
    const data: Record<string, unknown> = {}
    const setEncrypted = (
      key: string,
      val: string | null | undefined,
    ): void => {
      if (val === undefined) return
      data[key] = val === null ? null : encryptString(val)
    }
    setEncrypted(
      "gsc_service_account_json_encrypted",
      input.gsc_service_account_json,
    )
    setEncrypted("bing_webmaster_api_key_encrypted", input.bing_api_key)
    setEncrypted("openai_api_key_encrypted", input.openai_api_key)
    setEncrypted("anthropic_api_key_encrypted", input.anthropic_api_key)
    setEncrypted("perplexity_api_key_encrypted", input.perplexity_api_key)
    setEncrypted("google_ai_api_key_encrypted", input.google_ai_api_key)
    if (input.updated_by_user_id !== undefined) {
      data.updated_by_user_id = input.updated_by_user_id
    }
    await this.updateOvoSettings({
      selector: { id: row.id },
      data,
    } as any)
    return this.getApiCredentialsView()
  }

  /**
   * Admin-facing snapshot of credential state. Never includes the
   * plaintext value. For each credential reports:
   *
   *   - `configured`: true iff any source (DB or env) has a value.
   *   - `source`: "db" | "env" | "none". Lets admin UI render "saved
   *     in admin" vs "still using env var".
   *   - `last4`: last 4 chars of the resolved plaintext, when any.
   *     Lets admin spot drift ("we expected …8a3F but the live blob
   *     ends in …7d2C").
   */
  async getApiCredentialsView(): Promise<ApiCredentialsView> {
    const row = await this.loadSetting()
    const enc = {
      gsc: (row as any)?.gsc_service_account_json_encrypted as string | null,
      bing: (row as any)?.bing_webmaster_api_key_encrypted as string | null,
      openai: (row as any)?.openai_api_key_encrypted as string | null,
      anthropic: (row as any)?.anthropic_api_key_encrypted as string | null,
      perplexity: (row as any)?.perplexity_api_key_encrypted as string | null,
      google_ai: (row as any)?.google_ai_api_key_encrypted as string | null,
    }
    const dbPlain = (cipher: string | null | undefined): string | null => {
      if (!cipher) return null
      try {
        return decryptString(cipher)
      } catch {
        return null
      }
    }
    const summarise = (
      dbCipher: string | null | undefined,
      envValue: string | undefined,
    ): {
      configured: boolean
      source: "db" | "env" | "none"
      last4: string | null
    } => {
      const db = dbPlain(dbCipher)
      if (db) return { configured: true, source: "db", last4: last4(db) }
      if (envValue) return { configured: true, source: "env", last4: last4(envValue) }
      return { configured: false, source: "none", last4: null }
    }
    return {
      gsc_service_account_json: summarise(
        enc.gsc,
        (process.env.OVO_GSC_SERVICE_ACCOUNT_JSON || process.env.GOOGLE_GSC_SERVICE_ACCOUNT_JSON),
      ),
      bing_api_key: summarise(enc.bing, (process.env.OVO_BING_API_KEY || process.env.BING_WEBMASTER_API_KEY)),
      openai_api_key: summarise(enc.openai, (process.env.OVO_OPENAI_API_KEY || process.env.OPENAI_API_KEY)),
      anthropic_api_key: summarise(
        enc.anthropic,
        (process.env.OVO_ANTHROPIC_API_KEY || process.env.ANTHROPIC_API_KEY),
      ),
      perplexity_api_key: summarise(
        enc.perplexity,
        (process.env.OVO_PERPLEXITY_API_KEY || process.env.PERPLEXITY_API_KEY),
      ),
      google_ai_api_key: summarise(
        enc.google_ai,
        (process.env.OVO_GEMINI_API_KEY || process.env.GOOGLE_AI_API_KEY),
      ),
      gsc_site_url: (process.env.OVO_GSC_PROPERTY || process.env.GSC_SITE_URL) ?? null,
      bing_site_url: (process.env.OVO_BING_SITE_URL || process.env.BING_SITE_URL) ?? null,
      // Not bundled — always not-configured (keeps the admin UI safe).
      yandex_oauth_token: { configured: false, source: "none", last4: null },
      yandex_user_id: null,
      yandex_host_id: null,
      crux_api_key: { configured: false, source: "none", last4: null },
    }
  }

  // ─── AI citation tracker (Phase 4) ──────────────────────────────

  /** Cap how many AI citations stay in the DB. Cron prunes after each
   *  run. 90 days × ~120 rows/week ≈ 1.5k rows steady state. */
  static readonly AI_CITATION_RETENTION_DAYS = 90

  /**
   * Seed the prompt list with `DEFAULT_AI_PROMPTS` when the table is
   * empty. Idempotent — once a prompt exists (manual or seeded), we
   * never auto-add more. Operators control the list from here on.
   */
  async seedDefaultAiPromptsIfEmpty(): Promise<{ seeded: number }> {
    const existing = await this.listOvoAiPrompts({}, { take: 1 } as any)
    if (existing.length > 0) return { seeded: 0 }
    // Only seed example prompts in demo mode — a clean install stays
    // empty so the AI Citation tab shows its setup-required state.
    const promptSeeds = isDemoMode() ? DEMO_AI_PROMPTS : DEFAULT_AI_PROMPTS
    let seeded = 0
    for (const p of promptSeeds) {
      try {
        await this.createOvoAiPrompts({
          prompt: p.prompt,
          category: p.category,
          active: true,
          notes: p.notes ?? null,
        } as any)
        seeded += 1
      } catch (err) {
        // eslint-disable-next-line no-console
        console.warn("ovo: seed AI prompt failed", { p, err })
      }
    }
    return { seeded }
  }

  /** Read-side: list prompts (active first). */
  async listAiPrompts(opts: {
    active?: boolean
    limit?: number
    // `kind` distinguishes prompt purpose in newer callers. This model
    // only stores citation prompts, so the filter is accepted for API
    // compatibility and used to scope by `category` when provided.
    kind?: string
  } = {}): Promise<any[]> {
    const filter: Record<string, unknown> = {}
    if (opts.active !== undefined) filter.active = opts.active
    return this.listOvoAiPrompts(filter, {
      take: Math.min(opts.limit ?? 200, 500),
      order: { active: "DESC", created_at: "ASC" },
    } as any)
  }

  /** Run all active prompts against all configured providers and
   *  persist one `ovo_ai_citation` row per (prompt × provider).
   *
   *  Provider concurrency: prompts iterate sequentially (one prompt
   *  at a time) but providers within a prompt run in parallel — keeps
   *  rate-limit pressure low while still finishing in seconds.
   *
   *  Soft-fails per cell: a 429 from one provider doesn't kill the
   *  other three; we just write an empty citation row with the error
   *  visible in `answer`. */
  async runAiCitationsForAll(opts: { trigger?: string } = {}): Promise<{
    prompts: number
    citations: number
    errors: number
    duration_ms: number
  }> {
    const t0 = Date.now()
    const creds = await this.getApiCredentials()
    const prompts = await this.listAiPrompts({ active: true })
    let citations = 0
    let errors = 0
    for (const p of prompts) {
      const results = await this.runAiCitationsForPrompt(
        p as { id: string; prompt: string },
        creds,
      )
      citations += results.success
      errors += results.errors
    }
    // 90-day prune
    await this.pruneOldAiCitations()
    return {
      prompts: prompts.length,
      citations,
      errors,
      duration_ms: Date.now() - t0,
    }
  }

  /**
   * Run a single prompt across every configured provider. Used by the
   * "Run now" admin button (per-prompt) AND by `runAiCitationsForAll`
   * internally.
   */
  /**
   * Build the brand-matching config used by `extractSignals` from the
   * settings row. The brand name + aliases come from `brand`, and link
   * domains are derived from the configured GSC/Bing properties and the
   * sitemap URL. Everything is best-effort — when nothing is set the
   * extractor reports no brand match (honest, not fabricated).
   */
  async getBrandMatchConfig(): Promise<BrandMatchConfig> {
    const row = await this.loadSetting()
    const brand = ((row as any)?.brand ?? {}) as Record<string, unknown>
    const name = typeof brand.name === "string" ? brand.name.trim() : ""
    const aliases = Array.isArray(brand.alt_names)
      ? (brand.alt_names as unknown[]).filter(
          (a): a is string => typeof a === "string",
        )
      : []
    const competitors = Array.isArray((brand as any).competitors)
      ? ((brand as any).competitors as Array<{
          canonical: string
          aliases: string[]
        }>)
      : []

    const domains: string[] = []
    const pushDomain = (raw: unknown): void => {
      if (typeof raw !== "string" || !raw.trim()) return
      const host = raw
        .trim()
        .replace(/^sc-domain:/i, "")
        .replace(/^https?:\/\//i, "")
        .split("/")[0]
        .trim()
        .toLowerCase()
      if (host && !domains.includes(host)) domains.push(host)
    }
    pushDomain((row as any)?.gsc_site_url)
    pushDomain((row as any)?.bing_site_url)
    pushDomain((row as any)?.robots?.sitemap_url)
    pushDomain(resolveDefaultSiteUrl())

    return { name, aliases, domains, competitors }
  }

  async runAiCitationsForPrompt(
    prompt: { id: string; prompt: string },
    credsArg?: Awaited<ReturnType<OvoService["getApiCredentials"]>>,
  ): Promise<{ success: number; errors: number }> {
    const creds = credsArg ?? (await this.getApiCredentials())
    type Task = {
      provider: AiProvider
      run: () => Promise<AiAnswer>
    }
    const tasks: Task[] = []
    if (creds.openai_api_key) {
      tasks.push({
        provider: "openai",
        run: () => askOpenAI(creds.openai_api_key as string, prompt.prompt),
      })
    }
    if (creds.anthropic_api_key) {
      tasks.push({
        provider: "anthropic",
        run: () =>
          askAnthropic(creds.anthropic_api_key as string, prompt.prompt),
      })
    }
    if (creds.perplexity_api_key) {
      tasks.push({
        provider: "perplexity",
        run: () =>
          askPerplexity(creds.perplexity_api_key as string, prompt.prompt),
      })
    }
    if (creds.google_ai_api_key) {
      tasks.push({
        provider: "gemini",
        run: () => askGemini(creds.google_ai_api_key as string, prompt.prompt),
      })
    }
    if (tasks.length === 0) {
      return { success: 0, errors: 0 }
    }

    // Brand-matching config comes from settings so mention/citation
    // detection is meaningful per install (never hardcoded).
    const brand = await this.getBrandMatchConfig()
    const settled = await Promise.allSettled(tasks.map((t) => t.run()))
    let success = 0
    let errors = 0
    const capturedAt = new Date()
    for (let i = 0; i < settled.length; i += 1) {
      const r = settled[i]
      const task = tasks[i]
      if (r.status === "fulfilled") {
        const signals = extractSignals(r.value.answer, brand)
        await this.persistAiCitation(prompt, r.value, signals, capturedAt)
        success += 1
      } else {
        const errMsg = String(r.reason?.message ?? r.reason ?? "unknown_error")
        await this.persistAiCitation(
          prompt,
          {
            provider: task.provider,
            model_name: "error",
            answer: `[error] ${errMsg}`,
            latency_ms: 0,
            raw: { error: errMsg },
          },
          {
            mentions_brand: false,
            links_brand: false,
            competitor_mentions: [],
            sentiment: null,
            position: null,
          },
          capturedAt,
        )
        errors += 1
      }
    }
    return { success, errors }
  }

  /** Internal helper: write one citation row. */
  private async persistAiCitation(
    prompt: { id: string; prompt: string },
    answer: AiAnswer,
    signals: ReturnType<typeof extractSignals>,
    capturedAt: Date,
  ): Promise<void> {
    try {
      await this.createOvoAiCitations({
        prompt_id: prompt.id,
        prompt_text: prompt.prompt,
        provider: answer.provider,
        model_name: answer.model_name,
        answer: answer.answer,
        latency_ms: answer.latency_ms,
        mentions_brand: signals.mentions_brand,
        links_brand: signals.links_brand,
        competitor_mentions: signals.competitor_mentions,
        sentiment: signals.sentiment,
        position: signals.position,
        raw_response: answer.raw,
        captured_at: capturedAt,
      } as any)
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn("ovo: persist AI citation failed", {
        prompt_id: prompt.id,
        provider: answer.provider,
        err,
      })
    }
  }

  /** Drop citation rows older than the retention horizon. */
  private async pruneOldAiCitations(): Promise<void> {
    const horizon = new Date(
      Date.now() -
        OvoService.AI_CITATION_RETENTION_DAYS * 24 * 60 * 60 * 1000,
    )
    try {
      const stale = await this.listOvoAiCitations(
        { captured_at: { $lt: horizon } as any },
        { take: 5000 } as any,
      )
      if (stale.length > 0) {
        await this.deleteOvoAiCitations(stale.map((r: any) => r.id))
      }
    } catch {
      /* non-fatal */
    }
  }

  /**
   * Read-side: list citations, optionally filtered. Default order is
   * captured-at descending so the admin tab opens on the latest run.
   */
  /**
   * Phase 8.E — per-prompt time-series of AI-citation outcomes for
   * the trend chart on `/app/ovo?tab=ai-citations`.
   *
   * Bucketed by `captured_at` (the weekly run wall-clock). For each
   * bucket we count:
   *   - mentioned: rows where `mentions_brand = true`
   *   - linked:    rows where `links_brand = true`
   *   - missed:    rows where neither fired
   *   - by_provider: provider → { mentioned, linked, missed }
   *
   * The chart shows mention-rate over time per provider, so admins
   * can see "are we trending up on Perplexity but down on Gemini?".
   *
   * `bucket_size` is intentionally fixed at "weekly" because the
   * citation cron itself runs weekly — there's no sub-week data.
   * Default window is 12 weeks (90 days), matching the
   * `pruneOldAiCitations` retention so the chart never has gaps
   * caused by pruning.
   */
  async getAiCitationTrend(opts: {
    prompt_id: string
    window_weeks?: number
  }): Promise<{
    prompt_id: string
    prompt_text: string | null
    window_weeks: number
    buckets: Array<{
      bucket_start: string
      total: number
      mentioned: number
      linked: number
      missed: number
      avg_position: number | null
      sentiment: { positive: number; neutral: number; negative: number }
      by_provider: Record<
        string,
        { total: number; mentioned: number; linked: number; missed: number }
      >
    }>
  }> {
    const window_weeks = Math.max(1, Math.min(opts.window_weeks ?? 12, 52))
    const since = new Date()
    since.setUTCDate(since.getUTCDate() - window_weeks * 7)

    const rows = (await this.listOvoAiCitations(
      {
        prompt_id: opts.prompt_id,
        captured_at: { $gte: since } as any,
      } as any,
      { take: 5000, order: { captured_at: "ASC" } } as any,
    )) as Array<{
      provider: string
      captured_at: Date | string
      mentions_brand: boolean
      links_brand: boolean
      position: number | null
      sentiment: string | null
      prompt_text: string | null
    }>

    // Bucket by ISO week start (Monday). Keeps weekly cron runs that
    // happen to drift by a few hours from snapping into adjacent buckets.
    const bucketKey = (d: Date) => {
      const day = d.getUTCDay() // 0 = Sun, 1 = Mon, …
      const offset = (day + 6) % 7 // days since Monday
      const monday = new Date(d)
      monday.setUTCDate(d.getUTCDate() - offset)
      monday.setUTCHours(0, 0, 0, 0)
      return monday.toISOString()
    }

    type Bucket = {
      bucket_start: string
      total: number
      mentioned: number
      linked: number
      missed: number
      positions: number[]
      sentiment: { positive: number; neutral: number; negative: number }
      by_provider: Record<
        string,
        { total: number; mentioned: number; linked: number; missed: number }
      >
    }
    const map = new Map<string, Bucket>()

    let prompt_text: string | null = null

    for (const r of rows) {
      const d = r.captured_at instanceof Date
        ? r.captured_at
        : new Date(r.captured_at as string)
      const key = bucketKey(d)
      if (!map.has(key)) {
        map.set(key, {
          bucket_start: key,
          total: 0,
          mentioned: 0,
          linked: 0,
          missed: 0,
          positions: [],
          sentiment: { positive: 0, neutral: 0, negative: 0 },
          by_provider: {},
        })
      }
      const b = map.get(key)!
      b.total += 1
      const mentioned = !!r.mentions_brand
      const linked = !!r.links_brand
      if (mentioned) b.mentioned += 1
      if (linked) b.linked += 1
      if (!mentioned && !linked) b.missed += 1
      if (typeof r.position === "number" && r.position > 0) {
        b.positions.push(r.position)
      }
      const sk =
        r.sentiment === "positive" ||
        r.sentiment === "neutral" ||
        r.sentiment === "negative"
          ? r.sentiment
          : null
      if (sk) b.sentiment[sk] += 1

      const p = r.provider || "unknown"
      if (!b.by_provider[p]) {
        b.by_provider[p] = { total: 0, mentioned: 0, linked: 0, missed: 0 }
      }
      b.by_provider[p].total += 1
      if (mentioned) b.by_provider[p].mentioned += 1
      if (linked) b.by_provider[p].linked += 1
      if (!mentioned && !linked) b.by_provider[p].missed += 1

      if (!prompt_text && r.prompt_text) prompt_text = r.prompt_text
    }

    const buckets = Array.from(map.values())
      .sort((a, b) => a.bucket_start.localeCompare(b.bucket_start))
      .map((b) => ({
        bucket_start: b.bucket_start,
        total: b.total,
        mentioned: b.mentioned,
        linked: b.linked,
        missed: b.missed,
        avg_position: b.positions.length
          ? Math.round(
              (b.positions.reduce((s, x) => s + x, 0) / b.positions.length) * 10,
            ) / 10
          : null,
        sentiment: b.sentiment,
        by_provider: b.by_provider,
      }))

    return {
      prompt_id: opts.prompt_id,
      prompt_text,
      window_weeks,
      buckets,
    }
  }

  /**
   * Phase 8.F — alt-text suggestions for `<img>` tags on a page.
   *
   * Re-fetches the live HTML, picks every image missing an `alt`
   * attribute, calls Gemini Vision on each, and returns the
   * suggestions for the admin to copy. Stateless — nothing is
   * persisted, so re-running this on the same URL produces fresh
   * suggestions reflecting whatever's live now.
   *
   * Requires `google_ai_api_key` in the OVO credentials. Throws a
   * descriptive error when missing so the admin UI can prompt the
   * operator to set it.
   */
  async suggestImageAltsForPage(opts: {
    url: string
    limit?: number
  }): Promise<{
    url: string
    images_total: number
    images_missing_alt: number
    suggestions: Array<{
      image_url: string
      current_alt: string | null
      suggested_alt: string | null
      skipped_reason: string | null
      error?: string
    }>
    errors: string[]
  }> {
    const creds = await this.getApiCredentials()
    const apiKey = creds.google_ai_api_key
    if (!apiKey) {
      throw new Error(
        "google_ai_api_key not configured — add it on the General tab to use alt-text suggestions",
      )
    }
    return suggestImageAltsForPage(opts.url, apiKey, opts.limit)
  }

  async listAiCitations(opts: {
    prompt_id?: string
    provider?: AiProvider
    since?: Date
    limit?: number
  } = {}): Promise<any[]> {
    const filter: Record<string, unknown> = {}
    if (opts.prompt_id) filter.prompt_id = opts.prompt_id
    if (opts.provider) filter.provider = opts.provider
    if (opts.since) filter.captured_at = { $gte: opts.since } as any
    return this.listOvoAiCitations(filter, {
      take: Math.min(opts.limit ?? 500, 5000),
      order: { captured_at: "DESC" },
    } as any)
  }
}

/**
 * Build a Set of normalised topic-stems from an audit row. Used by
 * the internal-link suggester's Jaccard similarity scoring.
 *
 * Inputs: title + h1_text + meta_description + jsonld_types[]. We
 * lowercase, strip punctuation, split on whitespace, drop tokens
 * shorter than 3 chars, and remove a small English stopword list so
 * "the buying of shares" doesn't false-match every other page.
 *
 * Deliberately simple — no stemming library, no embeddings. The
 * resulting Set scales O(words) and the per-call cost is microseconds.
 */
const SUGGESTION_STOPWORDS = new Set([
  "the",
  "and",
  "for",
  "with",
  "from",
  "your",
  "you",
  "are",
  "this",
  "that",
  "what",
  "how",
  "buy",
  "page",
  "site",
  "all",
  "any",
  "our",
  "out",
  "more",
  "new",
  "one",
  "two",
  "three",
])

function topicBag(row: {
  title?: string | null
  h1_text?: string | null
  meta_description?: string | null
  jsonld_types?: string[] | null
}): Set<string> {
  const parts = [
    row.title ?? "",
    row.h1_text ?? "",
    row.meta_description ?? "",
    Array.isArray(row.jsonld_types) ? row.jsonld_types.join(" ") : "",
  ].join(" ")
  const out = new Set<string>()
  for (const raw of parts.toLowerCase().split(/[^a-z0-9]+/)) {
    if (raw.length < 3) continue
    if (SUGGESTION_STOPWORDS.has(raw)) continue
    out.add(raw)
  }
  return out
}

export default OvoService
