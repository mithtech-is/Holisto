/**
 * Shared types for the submission sub-system. Pure types — no
 * imports — so they can be shared between the lib functions, the
 * service, the API routes, and (via re-export from `service.ts`)
 * the admin UI.
 */

export type SubmissionDestination =
  | "indexnow"
  | "gsc"
  | "bing"
  | "yandex"
  | "all"

export type SubmissionAction =
  | "submit-urls"
  | "submit-sitemap"
  | "inspect-url"

export type SubmissionStatus = "success" | "error" | "skipped"

export type SubmissionResult = {
  destination: Exclude<SubmissionDestination, "all">
  action: SubmissionAction
  target: string
  url_count: number
  status: SubmissionStatus
  http_status: number | null
  error_message: string | null
  duration_ms: number
}

export type IndexNowConfig = {
  key: string
  host: string
  keyLocation: string
}

export type GscConfig = {
  service_account_email: string
  private_key: string
  /** Property as registered in GSC. Usually `https://<host>/`. */
  site_url: string
}

export type BingConfig = {
  api_key: string
  site_url: string
}

/** Keys we report stats for. `all` is a query-time alias and is
 *  intentionally excluded from the stats output. */
export type SubmissionDestinationKey = Exclude<SubmissionDestination, "all">

export type SubmissionDayBucket = {
  /** YYYY-MM-DD in UTC. The cron / push events use UTC for created_at so
   *  bucketing by UTC date avoids straddling the IST/UTC boundary. */
  date: string
  success: number
  error: number
  skipped: number
}

export type SubmissionDestinationStats = {
  /** ISO 8601 of the most recent `status=success` row, null if none. */
  last_success_at: string | null
  /** successes / (successes + errors) over the last 7 days. Null when
   *  no events landed (denominator zero). */
  success_rate_7d: number | null
  /** Sum of `url_count` across every successful event, lifetime. */
  lifetime_urls_pushed: number
  /** Total events of any status, lifetime. */
  lifetime_event_count: number
  /** Per-status counts over the last 7 days. */
  success_count_7d: number
  error_count_7d: number
  skipped_count_7d: number
  /** Last 7 calendar days, oldest first. Empty days carry zeros so a
   *  sparkline gets an unbroken x-axis. */
  events_by_day: SubmissionDayBucket[]
}
