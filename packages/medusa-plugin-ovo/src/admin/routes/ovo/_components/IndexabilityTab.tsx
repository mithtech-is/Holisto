import React, { useCallback, useEffect, useMemo, useState } from "react"
import {
  Badge,
  Button,
  Heading,
  Input,
  Text,
  toast,
} from "@medusajs/ui"
import { ArrowPathMini, ArrowUpRightOnBox } from "@medusajs/icons"

/**
 * Indexability tab — `/app/ovo?tab=indexability`.
 *
 * Answers the question "is this URL actually in Google's index, and
 * if not, why?" — using GSC's URL Inspection API (the authoritative
 * source, not inferred from search-analytics).
 *
 * Layout:
 *   1. Header + "Run inspection now" button + summary chips
 *      (indexed / not indexed / blocked / last run).
 *   2. Per-URL table with coverage state + verdict badges. Sortable
 *      + filterable. Click a row to expand with the full inspection
 *      payload (page fetch state, robots state, rich-results verdict,
 *      Google's chosen canonical, last crawl time).
 *
 * Cron: 08:00 UTC daily, walks the sitemap, persists into
 * `ovo_seo_url_index` (30-day retention).
 */

type UrlIndexRow = {
  id: string
  url: string
  inspected_at: string
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
}

type Summary = {
  total: number
  indexed: number
  not_indexed: number
  blocked: number
  last_inspected_at: string | null
}

const URL_INDEX_API = "/admin/ovo/seo/url-index"

async function loadUrlIndex(): Promise<{ rows: UrlIndexRow[]; summary: Summary }> {
  const r = await fetch(URL_INDEX_API, { credentials: "include" })
  if (!r.ok) {
    const e = (await r.json().catch(() => ({}))) as { message?: string }
    throw new Error(e.message || `URL Inspection load failed (${r.status})`)
  }
  return (await r.json()) as { rows: UrlIndexRow[]; summary: Summary }
}

async function runFullInspection(): Promise<{
  inspected: number
  indexed: number
  not_indexed: number
  failed: number
}> {
  const r = await fetch(URL_INDEX_API, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: "{}",
  })
  if (!r.ok) {
    const e = (await r.json().catch(() => ({}))) as { message?: string }
    throw new Error(e.message || `Run failed (${r.status})`)
  }
  return (await r.json()) as {
    inspected: number
    indexed: number
    not_indexed: number
    failed: number
  }
}

async function runOneInspection(url: string): Promise<{
  url: string
  indexed: boolean
  coverage: string | null
  verdict: string
}> {
  const r = await fetch(URL_INDEX_API, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url }),
  })
  if (!r.ok) {
    const e = (await r.json().catch(() => ({}))) as { message?: string }
    throw new Error(e.message || `Inspect failed (${r.status})`)
  }
  return (await r.json()) as {
    url: string
    indexed: boolean
    coverage: string | null
    verdict: string
  }
}

const cleanPath = (url: string): string => {
  try {
    const u = new URL(url)
    return u.pathname + u.search
  } catch {
    return url
  }
}

const formatRelative = (iso: string | null): string => {
  if (!iso) return "—"
  const t = new Date(iso).getTime()
  if (!Number.isFinite(t)) return "—"
  const diff = Math.max(0, Date.now() - t)
  const m = Math.round(diff / 60000)
  if (m < 60) return `${m}m ago`
  const h = Math.round(m / 60)
  if (h < 24) return `${h}h ago`
  const d = Math.round(h / 24)
  return `${d}d ago`
}

/* ── sub-components ───────────────────────────────────────────────── */

const SummaryCard: React.FC<{
  label: string
  value: number
  tone: "green" | "red" | "orange" | "grey"
  total?: number
}> = ({ label, value, tone, total }) => {
  const pct = total != null && total > 0 ? Math.round((value / total) * 100) : null
  return (
    <div className="flex-1 rounded-md border border-ui-border-base p-4">
      <Text size="xsmall" className="text-ui-fg-muted">
        {label}
      </Text>
      <div className="mt-1 flex items-baseline gap-2">
        <Heading level="h3" className="font-mono">
          {value}
        </Heading>
        {pct != null && (
          <Badge color={tone === "grey" ? "grey" : tone} size="2xsmall">
            {pct}%
          </Badge>
        )}
      </div>
    </div>
  )
}

const CoverageBadge: React.FC<{ row: UrlIndexRow }> = ({ row }) => {
  let tone: "green" | "red" | "orange" | "grey" = "grey"
  let label = row.coverage_state ?? row.verdict
  if (row.is_blocked_by_robots) {
    tone = "red"
    label = "Blocked by robots"
  } else if (row.is_indexed) {
    tone = "green"
  } else if (row.verdict === "FETCH_FAILED") {
    tone = "orange"
    label = "Inspection failed"
  } else if (row.verdict === "FAIL") {
    tone = "red"
  } else if (
    typeof row.coverage_state === "string" &&
    /discovered|crawled/i.test(row.coverage_state)
  ) {
    tone = "orange"
  }
  return (
    <Badge color={tone === "grey" ? "grey" : tone} size="2xsmall">
      {label}
    </Badge>
  )
}

const ExpandedDetails: React.FC<{
  row: UrlIndexRow
  onReinspect: (url: string) => Promise<void>
  isReinspecting: boolean
}> = ({ row, onReinspect, isReinspecting }) => {
  return (
    <div className="flex flex-col gap-3 rounded-md bg-ui-bg-subtle p-3 text-xs">
      <div className="flex flex-wrap items-center gap-2">
        <Button
          variant="primary"
          size="small"
          onClick={() => onReinspect(row.url)}
          isLoading={isReinspecting}
          disabled={isReinspecting}
        >
          <ArrowPathMini className="mr-1 h-3 w-3" />
          Inspect now
        </Button>
        <a
          href={row.url}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1 rounded-md border border-ui-border-base bg-ui-bg-base px-3 py-1.5 text-ui-fg-base hover:bg-ui-bg-base-hover"
        >
          <ArrowUpRightOnBox className="h-3 w-3" />
          Open page
        </a>
        <a
          href={`https://search.google.com/search-console/inspect?id=${encodeURIComponent(row.url)}`}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1 rounded-md border border-ui-border-base bg-ui-bg-base px-3 py-1.5 text-ui-fg-base hover:bg-ui-bg-base-hover"
        >
          <ArrowUpRightOnBox className="h-3 w-3" />
          Open in GSC
        </a>
      </div>
      <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
        <KV label="Verdict" value={row.verdict} />
        <KV label="Coverage state" value={row.coverage_state} />
        <KV label="Indexing state" value={row.indexing_state} />
        <KV label="Page fetch state" value={row.page_fetch_state} />
        <KV label="Robots.txt state" value={row.robots_txt_state} />
        <KV label="Mobile usability" value={row.mobile_usability_verdict} />
        <KV label="Rich results" value={row.rich_results_verdict} />
        <KV label="Google's chosen canonical" value={row.google_canonical} />
        <KV
          label="Last crawl time"
          value={row.last_crawl_time}
          extra={row.last_crawl_time ? formatRelative(row.last_crawl_time) : undefined}
        />
        <KV
          label="Last inspected"
          value={new Date(row.inspected_at).toLocaleString()}
          extra={formatRelative(row.inspected_at)}
        />
      </div>
    </div>
  )
}

const KV: React.FC<{
  label: string
  value: string | null
  extra?: string
}> = ({ label, value, extra }) => (
  <div className="flex flex-col rounded-md border border-ui-border-base bg-ui-bg-base px-3 py-2">
    <div className="flex items-baseline justify-between gap-2">
      <Text size="xsmall" className="text-ui-fg-muted">
        {label}
      </Text>
      {extra && (
        <Text size="xsmall" className="font-mono text-ui-fg-muted">
          {extra}
        </Text>
      )}
    </div>
    <Text size="xsmall" className="break-words font-mono text-ui-fg-base">
      {value ?? "—"}
    </Text>
  </div>
)

/* ── main ─────────────────────────────────────────────────────────── */

type FilterKey = "all" | "indexed" | "not_indexed" | "blocked"

const IndexabilityTab: React.FC = () => {
  const [rows, setRows] = useState<UrlIndexRow[]>([])
  const [summary, setSummary] = useState<Summary | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [running, setRunning] = useState(false)
  const [reinspecting, setReinspecting] = useState<string>("")
  const [filter, setFilter] = useState<FilterKey>("all")
  const [search, setSearch] = useState("")
  const [expanded, setExpanded] = useState<string>("")

  const refresh = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const r = await loadUrlIndex()
      setRows(r.rows)
      setSummary(r.summary)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    refresh()
  }, [refresh])

  const onRunAll = useCallback(async () => {
    setRunning(true)
    try {
      const r = await runFullInspection()
      toast.success("Inspection complete", {
        description: `${r.inspected} URLs · ${r.indexed} indexed · ${r.not_indexed} not indexed · ${r.failed} failed`,
      })
      await refresh()
    } catch (err) {
      toast.error("Run failed", { description: (err as Error).message })
    } finally {
      setRunning(false)
    }
  }, [refresh])

  const onReinspect = useCallback(
    async (url: string) => {
      setReinspecting(url)
      try {
        const r = await runOneInspection(url)
        toast[r.indexed ? "success" : "info"](
          r.indexed ? "Indexed ✓" : "Still not indexed",
          { description: r.coverage ?? r.verdict },
        )
        await refresh()
      } catch (err) {
        toast.error("Inspect failed", {
          description: (err as Error).message,
        })
      } finally {
        setReinspecting("")
      }
    },
    [refresh],
  )

  const filteredRows = useMemo(() => {
    return rows.filter((r) => {
      if (filter === "indexed" && !r.is_indexed) return false
      if (filter === "not_indexed" && r.is_indexed) return false
      if (filter === "blocked" && !r.is_blocked_by_robots) return false
      if (search.trim() && !r.url.toLowerCase().includes(search.toLowerCase()))
        return false
      return true
    })
  }, [rows, filter, search])

  return (
    <section className="flex flex-col gap-6">
      {/* Header */}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <Heading level="h2">Indexability</Heading>
          <Text size="small" className="text-ui-fg-muted">
            Authoritative "is this URL in Google's index?" answer for
            every URL in the sitemap, via GSC's URL Inspection API
            (the same data GSC's UI shows, but rolled up). Cron runs
            daily at 08:00 UTC.
            {summary?.last_inspected_at && (
              <>
                {" "}Last run{" "}
                <span className="font-mono">
                  {formatRelative(summary.last_inspected_at)}
                </span>
                .
              </>
            )}
          </Text>
        </div>
        <Button onClick={onRunAll} isLoading={running} disabled={running}>
          {running ? "Inspecting…" : "Run inspection now"}
        </Button>
      </div>

      {error && (
        <div className="rounded-md border border-ui-tag-red-border bg-ui-tag-red-bg p-3">
          <Text size="small" className="text-ui-tag-red-text">
            {error}
          </Text>
        </div>
      )}

      {/* Summary */}
      {summary && summary.total > 0 && (
        <div className="flex flex-wrap items-stretch gap-3">
          <SummaryCard
            label="Indexed"
            value={summary.indexed}
            tone="green"
            total={summary.total}
          />
          <SummaryCard
            label="Not indexed"
            value={summary.not_indexed}
            tone="red"
            total={summary.total}
          />
          <SummaryCard
            label="Blocked by robots"
            value={summary.blocked}
            tone="orange"
            total={summary.total}
          />
          <SummaryCard
            label="Total inspected"
            value={summary.total}
            tone="grey"
          />
        </div>
      )}

      {/* Empty state */}
      {summary?.total === 0 && (
        <div className="rounded-md border border-dashed border-ui-border-base p-8 text-center">
          <Text size="small" className="text-ui-fg-muted">
            No inspections recorded yet. Click{" "}
            <span className="font-semibold">Run inspection now</span> to
            ask Google about every URL in the sitemap. Takes ~30 seconds
            for ~150 URLs.
          </Text>
        </div>
      )}

      {/* Stale-crawl + never-indexed action panel (Phase 8.A) */}
      {(summary?.total ?? 0) > 0 && <CrawlFreshnessPanel />}

      {/* Filters */}
      {(summary?.total ?? 0) > 0 && (
        <div className="flex flex-wrap items-center gap-2 border-t border-ui-border-base pt-3">
          <Text size="xsmall" className="text-ui-fg-muted">
            Show:
          </Text>
          {(
            ["all", "indexed", "not_indexed", "blocked"] as FilterKey[]
          ).map((f) => (
            <Button
              key={f}
              variant={filter === f ? "primary" : "secondary"}
              size="small"
              onClick={() => setFilter(f)}
            >
              {f === "all"
                ? "All"
                : f === "indexed"
                  ? "Indexed"
                  : f === "not_indexed"
                    ? "Not indexed"
                    : "Blocked"}
            </Button>
          ))}
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Filter URLs..."
            className="ml-auto max-w-xs"
          />
          <Button variant="transparent" size="small" onClick={refresh} disabled={loading}>
            {loading ? "Loading…" : "Refresh"}
          </Button>
        </div>
      )}

      {/* Table */}
      {filteredRows.length > 0 && (
        <div className="overflow-hidden rounded-md border border-ui-border-base">
          <table className="w-full border-collapse text-left text-xs">
            <thead className="bg-ui-bg-subtle">
              <tr>
                <th className="px-3 py-2 font-semibold text-ui-fg-muted">URL</th>
                <th className="px-3 py-2 font-semibold text-ui-fg-muted">
                  Coverage
                </th>
                <th className="px-3 py-2 font-semibold text-ui-fg-muted">
                  Page fetch
                </th>
                <th className="px-3 py-2 font-semibold text-ui-fg-muted">
                  Last crawl
                </th>
                <th className="px-3 py-2 font-semibold text-ui-fg-muted">
                  Inspected
                </th>
              </tr>
            </thead>
            <tbody>
              {filteredRows.map((r) => {
                const isExpanded = expanded === r.id
                return (
                  <React.Fragment key={r.id}>
                    <tr
                      className="cursor-pointer border-t border-ui-border-base hover:bg-ui-bg-base-hover"
                      onClick={() => setExpanded(isExpanded ? "" : r.id)}
                    >
                      <td className="px-3 py-2">
                        <a
                          href={r.url}
                          target="_blank"
                          rel="noreferrer"
                          className="font-mono text-ui-fg-base underline-offset-2 hover:underline"
                          onClick={(e) => e.stopPropagation()}
                        >
                          {cleanPath(r.url)}
                        </a>
                      </td>
                      <td className="px-3 py-2">
                        <CoverageBadge row={r} />
                      </td>
                      <td className="px-3 py-2 font-mono text-ui-fg-base">
                        {r.page_fetch_state ?? "—"}
                      </td>
                      <td className="px-3 py-2 font-mono text-ui-fg-base">
                        {formatRelative(r.last_crawl_time)}
                      </td>
                      <td className="px-3 py-2 font-mono text-ui-fg-muted">
                        {formatRelative(r.inspected_at)}
                      </td>
                    </tr>
                    {isExpanded && (
                      <tr className="border-t border-ui-border-base bg-ui-bg-subtle">
                        <td colSpan={5} className="px-3 py-3">
                          <ExpandedDetails
                            row={r}
                            onReinspect={onReinspect}
                            isReinspecting={reinspecting === r.url}
                          />
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}

/* ── Crawl freshness + bulk IndexNow push (Phase 8.A) ─────────── */

type FreshnessRow = {
  url: string
  lastmod: string | null
  last_crawl_time: string | null
  coverage_state: string | null
  is_indexed: boolean
  stale_crawl: boolean
  never_indexed: boolean
  gap_days: number | null
}
type FreshnessSummary = {
  total: number
  stale_crawl: number
  never_indexed: number
  both: number
  actionable: number
}

/**
 * Joins sitemap `<lastmod>` with URL Inspection `last_crawl_time` and
 * surfaces two operationally-distinct buckets:
 *
 *   • "Never indexed" — Google's coverage_state says it hasn't been
 *     indexed yet (unknown to Google OR discovered/not indexed).
 *
 *   • "Stale crawl" — we've updated the page (sitemap lastmod is
 *     newer than Googlebot's last visit), so the indexed copy is
 *     out of date.
 *
 * Bulk-push button hits the existing
 * `POST /admin/ovo/submissions/push { destination: "indexnow", urls }`
 * endpoint — IndexNow tells Bing + Yandex within ~10 minutes (Google
 * doesn't participate but receives the same lastmod via the next
 * sitemap crawl).
 *
 * Hidden when there are no actionable URLs (no point in showing the
 * panel if nothing is stale).
 */
const CrawlFreshnessPanel: React.FC = () => {
  const [rows, setRows] = useState<FreshnessRow[]>([])
  const [summary, setSummary] = useState<FreshnessSummary | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [pushing, setPushing] = useState(false)
  const [bucket, setBucket] = useState<"never_indexed" | "stale_crawl">(
    "never_indexed",
  )

  const refresh = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const r = await fetch("/admin/ovo/seo/crawl-freshness", {
        credentials: "include",
      })
      if (!r.ok) {
        const e = (await r.json().catch(() => ({}))) as {
          message?: string
        }
        throw new Error(e.message || `Freshness load failed (${r.status})`)
      }
      const json = (await r.json()) as {
        rows: FreshnessRow[]
        summary: FreshnessSummary
      }
      setRows(json.rows)
      setSummary(json.summary)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    refresh()
  }, [refresh])

  const visibleRows = useMemo(() => {
    return rows.filter((r) =>
      bucket === "never_indexed" ? r.never_indexed : r.stale_crawl,
    )
  }, [rows, bucket])

  const onPushAll = useCallback(async () => {
    if (visibleRows.length === 0) return
    if (
      !confirm(
        `Push ${visibleRows.length} URL(s) to IndexNow (Bing + Yandex)?`,
      )
    )
      return
    setPushing(true)
    try {
      const r = await fetch("/admin/ovo/submissions/push", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          destination: "indexnow",
          urls: visibleRows.map((row) => row.url),
        }),
      })
      if (!r.ok) {
        const e = (await r.json().catch(() => ({}))) as {
          message?: string
        }
        throw new Error(e.message || `Push failed (${r.status})`)
      }
      toast.success("IndexNow push submitted", {
        description: `${visibleRows.length} URL(s) sent to Bing + Yandex. Re-run URL Inspection in ~15 minutes to see verdict changes.`,
      })
      await refresh()
    } catch (err) {
      toast.error("Push failed", { description: (err as Error).message })
    } finally {
      setPushing(false)
    }
  }, [visibleRows, refresh])

  if (loading) return null
  if (error) {
    return (
      <div className="rounded-md border border-ui-tag-red-border bg-ui-tag-red-bg p-3">
        <Text size="xsmall" className="text-ui-tag-red-text">
          {error}
        </Text>
      </div>
    )
  }
  if (!summary || summary.actionable === 0) {
    return (
      <div className="rounded-md border border-dashed border-ui-tag-green-border bg-ui-tag-green-bg p-3 text-center">
        <Text size="xsmall" className="text-ui-tag-green-text">
          Crawl freshness: nothing actionable. Every sitemapped URL is
          either indexed and up-to-date, or already pending Google's
          natural recrawl cycle.
        </Text>
      </div>
    )
  }

  return (
    <div className="rounded-md border border-ui-tag-orange-border bg-ui-tag-orange-bg p-3">
      <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
        <Text size="xsmall" weight="plus" className="text-ui-tag-orange-text">
          Crawl freshness — {summary.actionable} URL
          {summary.actionable === 1 ? "" : "s"} can be nudged via IndexNow
        </Text>
        <div className="flex items-center gap-2">
          <Button
            variant={bucket === "never_indexed" ? "primary" : "secondary"}
            size="small"
            onClick={() => setBucket("never_indexed")}
          >
            Never indexed ({summary.never_indexed})
          </Button>
          <Button
            variant={bucket === "stale_crawl" ? "primary" : "secondary"}
            size="small"
            onClick={() => setBucket("stale_crawl")}
          >
            Stale crawl ({summary.stale_crawl})
          </Button>
        </div>
      </div>
      <Text size="xsmall" className="text-ui-fg-muted">
        {bucket === "never_indexed"
          ? "Google has either never crawled these URLs (coverage = unknown) or crawled and chose not to index (coverage = discovered/not indexed). IndexNow tells Bing + Yandex immediately; for Google use GSC's Request Indexing on the most important URLs."
          : "These URLs were updated (sitemap lastmod) after Googlebot's last crawl. IndexNow nudges Bing + Yandex; Google will recrawl on its own cycle but the nudge can hasten it."}
      </Text>
      {visibleRows.length > 0 && (
        <div className="mt-3 overflow-x-auto">
          <table className="w-full text-[11px]">
            <thead className="text-ui-fg-muted">
              <tr>
                <th className="px-2 py-1 text-left">URL</th>
                <th className="px-2 py-1 text-left">Coverage</th>
                <th className="px-2 py-1 text-left">Last sitemap update</th>
                <th className="px-2 py-1 text-left">Last crawled</th>
                {bucket === "stale_crawl" && (
                  <th className="px-2 py-1 text-right">Gap (days)</th>
                )}
              </tr>
            </thead>
            <tbody>
              {visibleRows.slice(0, 30).map((r) => {
                const path = (() => {
                  try {
                    const u = new URL(r.url)
                    return u.pathname + u.search
                  } catch {
                    return r.url
                  }
                })()
                return (
                  <tr
                    key={r.url}
                    className="border-t border-ui-tag-orange-border"
                  >
                    <td className="px-2 py-1">
                      <a
                        href={r.url}
                        target="_blank"
                        rel="noreferrer"
                        className="font-mono text-ui-fg-base hover:underline"
                      >
                        {path}
                      </a>
                    </td>
                    <td className="px-2 py-1 text-ui-fg-base">
                      {r.coverage_state ?? "—"}
                    </td>
                    <td className="px-2 py-1 font-mono text-ui-fg-muted">
                      {r.lastmod ? r.lastmod.slice(0, 10) : "—"}
                    </td>
                    <td className="px-2 py-1 font-mono text-ui-fg-muted">
                      {r.last_crawl_time
                        ? r.last_crawl_time.slice(0, 10)
                        : "—"}
                    </td>
                    {bucket === "stale_crawl" && (
                      <td className="px-2 py-1 text-right font-mono">
                        {r.gap_days != null ? `+${r.gap_days}d` : "—"}
                      </td>
                    )}
                  </tr>
                )
              })}
            </tbody>
          </table>
          {visibleRows.length > 30 && (
            <Text size="xsmall" className="mt-1 text-ui-fg-muted">
              … {visibleRows.length - 30} more. Push affects ALL{" "}
              {visibleRows.length} URLs.
            </Text>
          )}
        </div>
      )}
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Button
          onClick={onPushAll}
          isLoading={pushing}
          disabled={pushing || visibleRows.length === 0}
          size="small"
        >
          {pushing
            ? "Pushing…"
            : `Push ${visibleRows.length} URL${visibleRows.length === 1 ? "" : "s"} to IndexNow`}
        </Button>
        <Button
          variant="transparent"
          size="small"
          onClick={refresh}
          disabled={loading}
        >
          Refresh
        </Button>
      </div>
    </div>
  )
}

export default IndexabilityTab
