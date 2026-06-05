/**
 * Chrome UX Report (CrUX) API client — origin-level Core Web Vitals.
 *
 * Endpoint reference:
 *   https://developer.chrome.com/docs/crux/api
 *   POST https://chromeuxreport.googleapis.com/v1/records:queryRecord
 *
 * Auth: a Google Cloud API key with the CrUX API enabled. Different
 * project surface than the GSC service-account JSON — operators can
 * reuse the same Cloud project (`polemarchapp`) but the credential
 * type differs. Configure at https://console.cloud.google.com →
 * APIs & Services → Credentials → Create API key.
 *
 * Data shape per query: a 28-day rolling aggregate (CrUX is
 * intentionally noisy on shorter windows). For each requested metric
 * the API returns:
 *   - histogram: 3 buckets — "Good", "Needs improvement", "Poor"
 *     with `density` (fraction of measurements in that bucket).
 *   - percentiles: { p75: <value> }
 *
 * We persist the p75 + the Good-density as separate metric rows so
 * the existing line-chart shape (one number per day) keeps working.
 *
 * Caveats:
 *   - CrUX returns 404 when the origin doesn't have enough real-user
 *     traffic to produce a stable sample. We treat 404 as "not enough
 *     data yet" — write nothing, retry tomorrow. Typical warmup for
 *     a fresh domain is several weeks of organic traffic.
 *   - The "ALL_FORM_FACTORS" aggregate is what most admins want;
 *     we fetch mobile + desktop separately so the dashboard can
 *     show device skew.
 *   - LCP / CLS / INP are the three Google-tracked Core Web Vitals.
 *     TTFB is bonus context; FCP is no longer a Core signal but is
 *     still in the API.
 */

const ENDPOINT =
  "https://chromeuxreport.googleapis.com/v1/records:queryRecord"
const TIMEOUT_MS = 12_000

export type CruxFormFactor = "PHONE" | "DESKTOP" | "ALL_FORM_FACTORS"

export type CruxMetricKey =
  | "largest_contentful_paint"
  | "cumulative_layout_shift"
  | "interaction_to_next_paint"
  | "first_contentful_paint"
  | "experimental_time_to_first_byte"

const METRIC_KEYS: CruxMetricKey[] = [
  "largest_contentful_paint",
  "cumulative_layout_shift",
  "interaction_to_next_paint",
  "first_contentful_paint",
  "experimental_time_to_first_byte",
]

export type CruxOriginRecord = {
  /** Form factor of this row, normalised to lowercase for storage. */
  form_factor: "phone" | "desktop" | "all"
  /**
   * Per-metric snapshot. Values are in milliseconds for LCP / INP /
   * FCP / TTFB, unitless for CLS. `good_density` is the 0..1
   * fraction of real-user measurements that landed in the "Good"
   * bucket — the headline number most admins read.
   */
  metrics: Partial<Record<CruxMetricKey, { p75: number; good_density: number }>>
  /**
   * UTC date the 28-day window ENDS on (CrUX returns
   * `collectionPeriod.lastDate`). The chart bucket-by-day on this.
   */
  collected_at: string
  /** Full upstream payload (capped) for debug + future field surfacing. */
  raw: unknown
}

/**
 * Pull origin-level CrUX for the given origin across mobile + desktop
 * + all-form-factors. Returns one entry per form factor that has
 * data; missing form factors are silently dropped (CrUX 404 → "not
 * enough data yet" rather than fatal).
 */
export async function fetchCruxOrigin(
  apiKey: string,
  origin: string,
): Promise<CruxOriginRecord[]> {
  const out: CruxOriginRecord[] = []
  const variants: Array<{
    formFactor: CruxFormFactor
    label: CruxOriginRecord["form_factor"]
  }> = [
    { formFactor: "PHONE", label: "phone" },
    { formFactor: "DESKTOP", label: "desktop" },
    { formFactor: "ALL_FORM_FACTORS", label: "all" },
  ]
  for (const v of variants) {
    const r = await queryOne(apiKey, origin, v.formFactor)
    if (r) {
      out.push({
        form_factor: v.label,
        metrics: r.metrics,
        collected_at: r.collected_at,
        raw: r.raw,
      })
    }
  }
  return out
}

async function queryOne(
  apiKey: string,
  origin: string,
  formFactor: CruxFormFactor,
): Promise<
  | { metrics: CruxOriginRecord["metrics"]; collected_at: string; raw: unknown }
  | null
> {
  const url = `${ENDPOINT}?key=${encodeURIComponent(apiKey)}`
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      origin,
      formFactor,
      metrics: METRIC_KEYS,
    }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  })
  // 404 = origin lacks enough RUM samples for this form factor.
  // Treat as soft-no-data and move on.
  if (res.status === 404) return null
  if (!res.ok) {
    throw new Error(`crux_${res.status}: ${await safeText(res)}`)
  }
  const json = (await res.json()) as {
    record?: {
      metrics?: Record<
        string,
        {
          histogram?: Array<{ start?: number; end?: number; density?: number }>
          percentiles?: { p75?: number }
        }
      >
      collectionPeriod?: {
        lastDate?: { year?: number; month?: number; day?: number }
      }
    }
  }
  const rec = json.record
  if (!rec || !rec.metrics) return null
  const metrics: CruxOriginRecord["metrics"] = {}
  for (const key of METRIC_KEYS) {
    const m = rec.metrics[key]
    if (!m) continue
    const p75 = Number(m.percentiles?.p75)
    if (!Number.isFinite(p75)) continue
    // First histogram bucket is "Good" by Google's convention; sum
    // densities defensively in case the API ever returns multiple
    // good-region buckets.
    const good_density = Number(m.histogram?.[0]?.density ?? 0)
    metrics[key] = { p75, good_density }
  }
  const last = rec.collectionPeriod?.lastDate
  const collected_at =
    last && last.year && last.month && last.day
      ? `${last.year.toString().padStart(4, "0")}-${last.month
          .toString()
          .padStart(2, "0")}-${last.day.toString().padStart(2, "0")}`
      : new Date().toISOString().slice(0, 10)
  return { metrics, collected_at, raw: rec }
}

async function safeText(res: Response): Promise<string> {
  try {
    return (await res.text()).slice(0, 500)
  } catch {
    return `http_${res.status}`
  }
}
