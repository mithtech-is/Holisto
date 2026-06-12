import { model } from "@medusajs/framework/utils"

/**
 * Per-URL index-status snapshot from Google's URL Inspection API.
 *
 * Two questions the rest of OVO can't authoritatively answer:
 *   1. Has Google actually indexed this URL? (search-analytics only
 *      tells us "URL had at least 1 impression in the window", which
 *      undercounts brand-new URLs.)
 *   2. If not, *why* — discovered? crawled? excluded? blocked?
 *
 * Google's URL Inspection API answers both. Quota: 2000 inspections /
 * property / day — enough for a daily walk over our 150-URL sitemap
 * with 12x headroom.
 *
 * Why a separate table from `ovo_seo_audit`:
 *   - The audit table is replaced-per-URL on every audit run (latest
 *     snapshot only). URL-Inspection has its own daily cadence + we
 *     want to track *changes* (newly indexed / newly deindexed).
 *   - Different retention: audit = current state, url-index = 30-day
 *     rolling history so we can chart "indexed coverage over time".
 *
 * The full GSC response payload is preserved in `raw_response` for
 * debugging unexpected verdicts.
 */
export const OvoSeoUrlIndex = model.define("ovo_seo_url_index", {
  id: model.id().primaryKey(),

  /** The URL we asked Google about (canonical form). */
  url: model.text().index(),

  /** When this inspection was performed. */
  inspected_at: model.dateTime().index(),

  /**
   * Google's top-level verdict for the URL:
   *   "PASS"          — indexed and eligible for Search
   *   "PARTIAL"       — indexed but some signals missing
   *   "FAIL"          — has an error blocking indexing
   *   "NEUTRAL"       — no decisive signal
   *   "VERDICT_UNSPECIFIED" — fallback
   */
  verdict: model.text(),

  /** Coverage state — the line you read in GSC's UI:
   *  "Submitted and indexed", "Crawled - currently not indexed",
   *  "Discovered - currently not indexed", "Blocked by robots.txt",
   *  etc. Critical for the "why isn't this ranking?" question. */
  coverage_state: model.text().nullable(),

  /** Last time Googlebot crawled the URL (ISO string). */
  last_crawl_time: model.text().nullable(),

  /** Page fetch outcome on Googlebot's last visit:
   *  "SUCCESSFUL" / "SOFT_404" / "REDIRECT_ERROR" / "ACCESS_DENIED" / … */
  page_fetch_state: model.text().nullable(),

  /** Google's robots.txt verdict for this URL. */
  robots_txt_state: model.text().nullable(),

  /** Index verdict — same vocabulary as the top-level one but
   *  specifically about the indexing pipeline. */
  indexing_state: model.text().nullable(),

  /** Mobile-usability summary (verdict + issue list when failing). */
  mobile_usability_verdict: model.text().nullable(),

  /** Rich-results verdict when the URL emits structured data. */
  rich_results_verdict: model.text().nullable(),

  /** Canonical URL Google has chosen for this URL (may differ from
   *  the one we asked about — common with parameterised URLs). */
  google_canonical: model.text().nullable(),

  /** Boolean shortcuts derived from the verdicts above. Stored so the
   *  admin tab can filter/sort without re-parsing the verdict strings. */
  is_indexed: model.boolean().default(false),
  is_blocked_by_robots: model.boolean().default(false),
  has_mobile_issues: model.boolean().default(false),

  /** Full GSC response for debugging unexpected verdicts. */
  raw_response: model.json().nullable(),
})
