/**
 * Shared TypeScript shapes for the OVO admin tabs. Mirror the
 * `ovo_setting` row shape — the API echoes back what's saved, so
 * tabs can reuse these types for both reads and writes.
 */

/**
 * fetchWithRetry — wraps the global fetch with one-shot retry on
 * HTTP 429 (rate-limited by the admin middleware) and 503 (transient
 * upstream). Respects `Retry-After` when the response sets one,
 * otherwise backs off `defaultDelayMs` (default 1500ms).
 *
 * Use this for any tab that fan-outs >5 parallel admin requests
 * (MetricsTab, GroupsPerfTab, AuditTab). For single-shot reads the
 * extra retry overhead is unnecessary; the plain global `fetch` is
 * fine.
 *
 * Throws on network errors and on non-2xx responses after the retry;
 * caller decides whether to toast or swallow.
 */
export async function fetchWithRetry(
  input: string | URL,
  init: RequestInit = {},
  opts: { defaultDelayMs?: number; maxRetries?: number } = {},
): Promise<Response> {
  const maxRetries = Math.max(0, Math.min(opts.maxRetries ?? 1, 3))
  const defaultDelay = opts.defaultDelayMs ?? 1500
  let attempt = 0
  while (true) {
    const res = await fetch(input, {
      credentials: "include",
      ...init,
    })
    if (
      attempt < maxRetries &&
      (res.status === 429 || res.status === 503)
    ) {
      // Read Retry-After (seconds) when present; fall back to
      // defaultDelay. Clamped at 5000ms to keep UI snappy.
      let delay = defaultDelay
      const ra = res.headers.get("Retry-After")
      if (ra) {
        const seconds = Number(ra)
        if (Number.isFinite(seconds) && seconds > 0) {
          delay = Math.min(seconds * 1000, 5000)
        }
      }
      attempt += 1
      await new Promise((resolve) => setTimeout(resolve, delay))
      continue
    }
    return res
  }
}

// The debounce hook lives in `useDebouncedValue.ts` next to this
// file — a plain `.ts` re-export here would force every tab to
// pull React even when they don't need the hook.

export type ContactPoint = {
  contact_type: string
  telephone?: string | null
  email?: string | null
  area_served?: string | null
  available_language?: string[]
  hours?: { days: string[]; opens: string; closes: string } | null
}

export type Founder = {
  name: string
  role: string
  bio: string
  photo_url: string
  linkedin_url: string
}

export type PressMention = {
  publication: string
  headline: string
  url: string
  /** ISO date string, e.g. "2026-05-14". Optional. */
  date?: string | null
  logo_url?: string | null
}

export type Brand = {
  name: string
  alt_names: string[]
  legal_name: string
  slogan: string
  description: string
  logo_url: string
  founding_year: string
  founding_place: string
  parent_org?: { name: string; url: string } | null
  contact_points: ContactPoint[]
  postal_address?: {
    street: string
    city: string
    region: string
    postal_code: string
    country: string
  } | null
  /** Named founders — emitted as Organization.founder Person nodes
   *  (KGO signal) and rendered in the homepage FounderStrip. */
  founders?: Founder[]
  /** "As seen in" press placements — homepage PressStrip and
   *  Organization.subjectOf when populated. */
  press_mentions?: PressMention[]
}

export type DefaultMeta = {
  title_default: string
  title_template: string
  description_fallback: string
  keywords: string[]
  og_image_url: string | null
  twitter_handle: string | null
  locale: string
}

export type RobotsConfig = {
  disallow_paths: string[]
  sitemap_url?: string | null
}

export type SitemapShards = {
  static: boolean
  products: boolean
  taxonomy: boolean
  knowledge: boolean
}

export type EntityConfig = {
  same_as: string[]
  knows_about: string[]
  services: Array<{ name: string; description?: string; url?: string }>
}

export type FaqEntry = { question: string; answer: string }

export type CitationsConfig = {
  author?: string | null
  reviewer?: string | null
  last_updated?: string | null
}

export type LlmsTxt = {
  short_md: string
  full_md: string
}

export type BotPolicy = {
  retrieval_bots: "allow" | "deny"
  training_bots: "allow" | "deny"
  scraper_bots: "allow" | "deny"
  overrides: Record<string, "allow" | "deny">
}

export type RetrievalConfig = {
  prefer_h2_breaks: boolean
  chunk_size_tokens: number
  emit_jsonl_export: boolean
}

export type GenerativeConfig = {
  question_intent_keywords: string[]
  summary_paragraph: string
  source_attribution_text: string
}

export type OvoSettingView = {
  id: string
  master_enabled: boolean
  seo_enabled: boolean
  geo_enabled: boolean
  aeo_enabled: boolean
  llmo_enabled: boolean
  eeo_enabled: boolean
  kgo_enabled: boolean
  reo_enabled: boolean
  sgeo_enabled: boolean
  brand: Brand | null
  default_meta: DefaultMeta | null
  robots: RobotsConfig | null
  sitemap_shards: SitemapShards | null
  entity: EntityConfig | null
  faq: FaqEntry[] | null
  default_product_faq: FaqEntry[] | null
  default_category_faq: FaqEntry[] | null
  citations: CitationsConfig | null
  llms_txt: LlmsTxt | null
  bot_policy: BotPolicy | null
  retrieval: RetrievalConfig | null
  generative: GenerativeConfig | null
}

export const OVO_ADMIN_API = "/admin/ovo"

export async function loadOvo(): Promise<OvoSettingView> {
  const r = await fetch(OVO_ADMIN_API, { credentials: "include" })
  if (!r.ok) {
    const e = (await r.json().catch(() => ({}))) as { message?: string }
    throw new Error(e.message || `Load failed (${r.status})`)
  }
  return (await r.json()) as OvoSettingView
}

export async function saveOvo(
  patch: Partial<OvoSettingView>,
): Promise<OvoSettingView> {
  const r = await fetch(OVO_ADMIN_API, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(patch),
  })
  if (!r.ok) {
    const e = (await r.json().catch(() => ({}))) as { message?: string }
    throw new Error(e.message || `Save failed (${r.status})`)
  }
  return (await r.json()) as OvoSettingView
}

// ─── Submissions (push to discovery surfaces) ─────────────────────

export type SubmissionDestination =
  | "indexnow"
  | "gsc"
  | "bing"
  | "yandex"
  | "all"

export type SubmissionResult = {
  destination: "indexnow" | "gsc" | "bing" | "yandex"
  action: "submit-urls" | "submit-sitemap" | "inspect-url"
  target: string
  url_count: number
  status: "success" | "error" | "skipped"
  http_status: number | null
  error_message: string | null
  duration_ms: number
  coverage?: string | null
}

export type SubmissionLogRow = SubmissionResult & {
  id: string
  triggered_by_user_id: string | null
  created_at: string
}

export type SubmissionStatus = {
  indexnow: { configured: boolean; host: string | null }
  gsc: { configured: boolean; site_url: string | null }
  bing: { configured: boolean; site_url: string | null }
  sitemap_index_url: string
}

const SUBMISSIONS_API = "/admin/ovo/submissions"

export async function loadSubmissionStatus(): Promise<SubmissionStatus> {
  const r = await fetch(`${SUBMISSIONS_API}/status`, { credentials: "include" })
  if (!r.ok) throw new Error(`Status load failed (${r.status})`)
  return (await r.json()) as SubmissionStatus
}

export async function loadSubmissionLog(opts: {
  destination?: SubmissionDestination
  status?: "success" | "error" | "skipped"
  limit?: number
} = {}): Promise<SubmissionLogRow[]> {
  const params = new URLSearchParams()
  if (opts.destination) params.set("destination", opts.destination)
  if (opts.status) params.set("status", opts.status)
  if (opts.limit) params.set("limit", String(opts.limit))
  const qs = params.toString()
  const r = await fetch(
    `${SUBMISSIONS_API}/log${qs ? `?${qs}` : ""}`,
    { credentials: "include" },
  )
  if (!r.ok) throw new Error(`Log load failed (${r.status})`)
  const json = (await r.json()) as { rows: SubmissionLogRow[] }
  return json.rows
}

export type SubmissionDayBucket = {
  date: string
  success: number
  error: number
  skipped: number
}

export type SubmissionDestinationStats = {
  last_success_at: string | null
  success_rate_7d: number | null
  lifetime_urls_pushed: number
  lifetime_event_count: number
  success_count_7d: number
  error_count_7d: number
  skipped_count_7d: number
  events_by_day: SubmissionDayBucket[]
}

export type SubmissionStatsResponse = {
  indexnow: SubmissionDestinationStats
  gsc: SubmissionDestinationStats
  bing: SubmissionDestinationStats
}

export async function loadSubmissionStats(): Promise<SubmissionStatsResponse> {
  const r = await fetch(`${SUBMISSIONS_API}/stats`, {
    credentials: "include",
  })
  if (!r.ok) throw new Error(`Stats load failed (${r.status})`)
  return (await r.json()) as SubmissionStatsResponse
}

// ─── External-API credentials (DB-backed, env fallback) ───────────

export type CredentialFieldSummary = {
  configured: boolean
  source: "db" | "env" | "none"
  last4: string | null
}

export type ApiCredentialsView = {
  gsc_service_account_json: CredentialFieldSummary
  bing_api_key: CredentialFieldSummary
  openai_api_key: CredentialFieldSummary
  anthropic_api_key: CredentialFieldSummary
  perplexity_api_key: CredentialFieldSummary
  google_ai_api_key: CredentialFieldSummary
  yandex_oauth_token: CredentialFieldSummary
  crux_api_key: CredentialFieldSummary
  /** Plaintext (not secret) — for the admin to verify the value the
   *  backend will pass to GSC / Bing. Read-only here; change via env. */
  gsc_site_url: string | null
  bing_site_url: string | null
  yandex_user_id: string | null
  yandex_host_id: string | null
}

const CREDENTIALS_API = "/admin/ovo/credentials"

export async function loadCredentials(): Promise<ApiCredentialsView> {
  const r = await fetch(CREDENTIALS_API, { credentials: "include" })
  if (!r.ok) {
    const e = (await r.json().catch(() => ({}))) as { message?: string }
    throw new Error(e.message || `Credentials load failed (${r.status})`)
  }
  return (await r.json()) as ApiCredentialsView
}

/**
 * Save credential patch. For each field:
 *   - omit → leave unchanged
 *   - pass string → encrypt + persist
 *   - pass null   → clear DB row (fall back to env)
 */
export async function saveCredentials(patch: {
  gsc_service_account_json?: string | null
  bing_api_key?: string | null
  openai_api_key?: string | null
  anthropic_api_key?: string | null
  perplexity_api_key?: string | null
  google_ai_api_key?: string | null
  yandex_oauth_token?: string | null
  yandex_user_id?: string | null
  yandex_host_id?: string | null
  crux_api_key?: string | null
}): Promise<ApiCredentialsView> {
  const r = await fetch(CREDENTIALS_API, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(patch),
  })
  if (!r.ok) {
    const e = (await r.json().catch(() => ({}))) as { message?: string }
    throw new Error(e.message || `Credentials save failed (${r.status})`)
  }
  return (await r.json()) as ApiCredentialsView
}

export async function pushSubmission(
  destination: SubmissionDestination,
  urls?: string[],
): Promise<SubmissionResult[]> {
  const r = await fetch(`${SUBMISSIONS_API}/push`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      destination,
      ...(urls && urls.length ? { urls } : {}),
    }),
  })
  if (!r.ok) {
    const e = (await r.json().catch(() => ({}))) as { message?: string }
    throw new Error(e.message || `Push failed (${r.status})`)
  }
  const json = (await r.json()) as { results: SubmissionResult[] }
  return json.results
}

export async function inspectGscUrl(url: string): Promise<SubmissionResult> {
  const r = await fetch(`${SUBMISSIONS_API}/inspect`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url }),
  })
  if (!r.ok) {
    const e = (await r.json().catch(() => ({}))) as { message?: string }
    throw new Error(e.message || `Inspect failed (${r.status})`)
  }
  const json = (await r.json()) as { result: SubmissionResult }
  return json.result
}

/* ── Keyword groups (shared) ─────────────────────────────────────────
   Used by KeywordsTab, GroupsPerfTab, OpportunitiesTab, and
   CannibalizationTab. Hoisted here so we keep ONE source of truth for
   the row shape + the GET endpoint — the four tabs had separately
   defined `loadGroups` helpers that drifted on the row shape (some
   typed only `{id,name}`, the perf tab typed the full row).
*/
export type KeywordFunnelStage = "TOFU" | "MOFU" | "BOFU"

export type KeywordGroup = {
  id: string
  name: string
  slug: string
  parent_group_id: string | null
  funnel_stage: KeywordFunnelStage | null
  is_pillar: boolean
  color: string | null
  priority: number
  sort_order: number
}

export async function loadKeywordGroups(): Promise<KeywordGroup[]> {
  const r = await fetch("/admin/ovo/keyword-groups", {
    credentials: "include",
  })
  if (!r.ok) {
    const e = (await r.json().catch(() => ({}))) as { message?: string }
    throw new Error(e.message || `Load groups failed (${r.status})`)
  }
  return ((await r.json()) as { rows: KeywordGroup[] }).rows
}
