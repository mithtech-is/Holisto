import { model } from "@medusajs/framework/utils"

/**
 * One row per push event to a discovery surface (IndexNow / GSC /
 * Bing / FB). Used to give admins a "what got pushed when" audit
 * trail in the OVO Submit tab.
 *
 * Pruned by the service to the most-recent 200 rows on every insert
 * — keeps the table small without a separate cron.
 *
 * Why a separate table instead of a JSON column on `ovo_setting`:
 *   1. Easier query patterns ("last 20 successes", "errors today")
 *      without filter-in-JSON dance.
 *   2. No risk of bloating the singleton row's JSON columns.
 *   3. Matches the audit-log pattern used elsewhere in the codebase
 *      (one row = one event).
 */
export const OvoSubmissionLog = model.define("ovo_submission_log", {
  id: model.id().primaryKey(),

  /** Discovery surface. One of: "indexnow" | "gsc" | "bing". */
  destination: model.text(),

  /** What was attempted. One of: "submit-urls" | "submit-sitemap" |
   *  "inspect-url". */
  action: model.text(),

  /** The target — sitemap URL, single inspected URL, or the host
   *  on IndexNow bulk URL submissions. */
  target: model.text(),

  /** How many URLs were in this payload (1 for sitemap/inspect, N
   *  for IndexNow batches). */
  url_count: model.number().default(0),

  /** "success" | "error" | "skipped". `skipped` means the destination
   *  wasn't configured (env var missing) and the operator should see
   *  a friendly setup hint rather than an error toast. */
  status: model.text(),

  /** HTTP status code from the upstream API, when one was received. */
  http_status: model.number().nullable(),

  /** First 500 chars of the upstream error body, when status != ok.
   *  Truncated to avoid persisting accidental PII / oversized HTML. */
  error_message: model.text().nullable(),

  /** Wall-clock duration of the upstream call. Surfaced in the
   *  admin UI to spot slow / flapping endpoints. */
  duration_ms: model.number().default(0),

  /** Audit — which admin triggered this push (null for cron-driven
   *  fan-outs from /admin/ovo save). */
  triggered_by_user_id: model.text().nullable(),
})
