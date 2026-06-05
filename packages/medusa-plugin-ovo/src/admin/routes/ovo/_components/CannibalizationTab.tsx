import React, { useCallback, useEffect, useMemo, useState } from "react"
import { Badge, Button, Heading, Select, Text, toast } from "@medusajs/ui"
import { ArrowUpRightOnBox, ChevronDown, ChevronRight } from "@medusajs/icons"
import { loadKeywordGroups, type KeywordGroup } from "./types"

/**
 * Cannibalization tab — `/app/ovo?tab=cannibalization`.
 *
 * Surfaces queries where two or more of our own URLs are competing in
 * the top-N for the same query. Cannibalisation dilutes the ranking
 * signal — Google rotates between the URLs and neither tops out.
 *
 * Data shape from `GET /admin/ovo/keyword-cannibalization`:
 *   { rows: [{
 *       query, normalized_query, severity,
 *       total_impressions, total_clicks,
 *       primary_url, primary_clicks, primary_impressions, primary_position,
 *       competing_urls: [{ url, clicks, impressions, position }],
 *       tracked_target_id, keyword_group_id
 *     }],
 *     by_severity: { high, medium, low },
 *     total }
 *
 * Severity tiers:
 *   - high   ≥ 3 competing URLs in top-N
 *   - medium 2 competing URLs in top-N AND ≥ 50 imp on the secondary
 *   - low    everything else flagged
 *
 * Phase 1: live computation, no persistence. Phase 4 will let admins
 * accept a primary-canonical recommendation that writes an
 * `ovo_override` on the losers.
 */

const WINDOW_OPTIONS = [
  { value: "7", label: "Last 7 days" },
  { value: "14", label: "Last 14 days" },
  { value: "28", label: "Last 28 days" },
  { value: "90", label: "Last 90 days" },
]

const TOP_N_OPTIONS = [
  { value: "5", label: "Top 5" },
  { value: "10", label: "Top 10" },
  { value: "20", label: "Top 20" },
]

type Severity = "high" | "medium" | "low"

type CompetingUrl = {
  url: string
  clicks: number
  impressions: number
  position: number
}

type CannibalRow = {
  query: string
  normalized_query: string
  severity: Severity
  total_impressions: number
  total_clicks: number
  primary_url: string
  primary_clicks: number
  primary_impressions: number
  primary_position: number
  competing_urls: CompetingUrl[]
  tracked_target_id: string | null
  keyword_group_id: string | null
}

type Response = {
  rows: CannibalRow[]
  by_severity: Partial<Record<Severity, number>>
  total: number
}

// KeywordGroup imported from ./types

const SEVERITY_TONE: Record<Severity, "red" | "orange" | "grey"> = {
  high: "red",
  medium: "orange",
  low: "grey",
}

const SEVERITY_DESCRIPTION: Record<Severity, string> = {
  high: "≥3 URLs competing in top-N — pick a canonical fast.",
  medium: "Two URLs in top-N with the loser collecting ≥50 impressions — likely diluting signal.",
  low: "Two URLs in top-N but loser has marginal volume — watch.",
}

async function loadCannibals(opts: {
  window_days: number
  top_n: number
}): Promise<Response> {
  const params = new URLSearchParams()
  params.set("window_days", String(opts.window_days))
  params.set("top_n", String(opts.top_n))
  const r = await fetch(
    `/admin/ovo/keyword-cannibalization?${params.toString()}`,
    { credentials: "include" },
  )
  if (!r.ok) {
    const e = (await r.json().catch(() => ({}))) as { message?: string }
    throw new Error(e.message || `Load failed (${r.status})`)
  }
  return (await r.json()) as Response
}

const cleanPath = (url: string): string => {
  try {
    const u = new URL(url)
    return u.pathname + u.search
  } catch {
    return url
  }
}

const SeverityTile: React.FC<{ severity: Severity; count: number }> = ({
  severity,
  count,
}) => (
  <div className="flex-1 rounded-md border border-ui-border-base p-4">
    <div className="flex items-center justify-between gap-2">
      <Text size="xsmall" className="text-ui-fg-muted">
        {severity[0].toUpperCase() + severity.slice(1)}
      </Text>
      <Badge color={SEVERITY_TONE[severity]} size="2xsmall">
        {count}
      </Badge>
    </div>
    <Text size="xsmall" className="mt-1 text-ui-fg-muted">
      {SEVERITY_DESCRIPTION[severity]}
    </Text>
  </div>
)

const CannibalizationTab: React.FC = () => {
  const [windowDays, setWindowDays] = useState<string>("14")
  const [topN, setTopN] = useState<string>("10")
  const [severityFilter, setSeverityFilter] = useState<string>("__all__")
  const [data, setData] = useState<Response | null>(null)
  const [groups, setGroups] = useState<KeywordGroup[]>([])
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [g, d] = await Promise.all([
        loadKeywordGroups(),
        loadCannibals({
          window_days: Number(windowDays),
          top_n: Number(topN),
        }),
      ])
      setGroups(g)
      setData(d)
    } catch (err) {
      setError((err as Error).message)
      toast.error("Load failed", { description: (err as Error).message })
    } finally {
      setLoading(false)
    }
  }, [windowDays, topN])

  useEffect(() => {
    refresh()
  }, [refresh])

  const groupNameById = useMemo(() => {
    const m = new Map<string, string>()
    for (const g of groups) m.set(g.id, g.name)
    return m
  }, [groups])

  const filteredRows = useMemo(() => {
    if (!data) return []
    if (severityFilter === "__all__") return data.rows
    return data.rows.filter((r) => r.severity === severityFilter)
  }, [data, severityFilter])

  const toggleExpand = useCallback((key: string) => {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }, [])

  const allSeverities: Severity[] = ["high", "medium", "low"]

  return (
    <section className="flex flex-col gap-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <Heading level="h2">Cannibalisation</Heading>
          <Text size="small" className="text-ui-fg-muted">
            Queries where two or more of our URLs compete in the top-N.
            Pick the strongest URL as canonical and demote the rest via
            OVO override (Phase 4 will offer a one-click action). Phase
            1 surfaces the findings only — manual fix via the Pages tab.
          </Text>
        </div>
        <div className="flex items-center gap-2">
          <Select value={topN} onValueChange={setTopN}>
            <Select.Trigger className="w-32">
              <Select.Value placeholder="Top N" />
            </Select.Trigger>
            <Select.Content>
              {TOP_N_OPTIONS.map((o) => (
                <Select.Item key={o.value} value={o.value}>
                  {o.label}
                </Select.Item>
              ))}
            </Select.Content>
          </Select>
          <Select value={windowDays} onValueChange={setWindowDays}>
            <Select.Trigger className="w-36">
              <Select.Value placeholder="Window" />
            </Select.Trigger>
            <Select.Content>
              {WINDOW_OPTIONS.map((o) => (
                <Select.Item key={o.value} value={o.value}>
                  {o.label}
                </Select.Item>
              ))}
            </Select.Content>
          </Select>
          <Button
            variant="transparent"
            size="small"
            onClick={refresh}
            disabled={loading}
          >
            {loading ? "Loading…" : "Refresh"}
          </Button>
        </div>
      </div>

      {error && (
        <div className="rounded-md border border-ui-tag-red-border bg-ui-tag-red-bg p-3">
          <Text size="small" className="text-ui-tag-red-text">
            {error}
          </Text>
        </div>
      )}

      {/* Severity tiles */}
      <div className="flex flex-wrap items-stretch gap-3">
        {allSeverities.map((s) => (
          <SeverityTile
            key={s}
            severity={s}
            count={data?.by_severity[s] ?? 0}
          />
        ))}
      </div>

      <div className="flex items-center gap-2">
        <Select value={severityFilter} onValueChange={setSeverityFilter}>
          <Select.Trigger className="w-44">
            <Select.Value placeholder="Severity" />
          </Select.Trigger>
          <Select.Content>
            <Select.Item value="__all__">All severities</Select.Item>
            {allSeverities.map((s) => (
              <Select.Item key={s} value={s}>
                {s}
              </Select.Item>
            ))}
          </Select.Content>
        </Select>
        <Text size="xsmall" className="text-ui-fg-muted">
          {data
            ? `${filteredRows.length} of ${data.total} cannibalisation findings`
            : ""}
        </Text>
      </div>

      <div className="overflow-hidden rounded-md border border-ui-border-base">
        <table className="w-full border-collapse text-left text-xs">
          <thead className="bg-ui-bg-subtle">
            <tr>
              <th className="px-3 py-2 font-semibold text-ui-fg-muted w-8"></th>
              <th className="px-3 py-2 font-semibold text-ui-fg-muted">
                Severity
              </th>
              <th className="px-3 py-2 font-semibold text-ui-fg-muted">
                Query
              </th>
              <th className="px-3 py-2 font-semibold text-ui-fg-muted">
                Primary URL
              </th>
              <th className="px-3 py-2 font-semibold text-ui-fg-muted text-right">
                Cur. rank
              </th>
              <th className="px-3 py-2 font-semibold text-ui-fg-muted text-right">
                # competitors
              </th>
              <th className="px-3 py-2 font-semibold text-ui-fg-muted text-right">
                Imp (window)
              </th>
              <th className="px-3 py-2 font-semibold text-ui-fg-muted">
                Group
              </th>
            </tr>
          </thead>
          <tbody>
            {filteredRows.length === 0 ? (
              <tr>
                <td
                  colSpan={8}
                  className="px-3 py-6 text-center text-ui-fg-muted"
                >
                  {loading
                    ? "Scanning history…"
                    : data && data.total === 0
                    ? "No cannibalisation detected. Either rankings are clean, or the query_page dimension rollup hasn't been ingested yet (check the Submit tab → ingest GSC dimensions)."
                    : "No findings match the filter."}
                </td>
              </tr>
            ) : (
              filteredRows.flatMap((r) => {
                const key = r.normalized_query
                const isOpen = expanded.has(key)
                const rowBase = (
                  <tr
                    key={key}
                    className="border-t border-ui-border-base cursor-pointer"
                    onClick={() => toggleExpand(key)}
                  >
                    <td className="px-3 py-2">
                      {isOpen ? (
                        <ChevronDown className="h-3 w-3" />
                      ) : (
                        <ChevronRight className="h-3 w-3" />
                      )}
                    </td>
                    <td className="px-3 py-2">
                      <Badge color={SEVERITY_TONE[r.severity]} size="2xsmall">
                        {r.severity}
                      </Badge>
                    </td>
                    <td className="px-3 py-2 font-mono text-ui-fg-base">
                      {r.query}
                    </td>
                    <td className="px-3 py-2">
                      <a
                        href={r.primary_url}
                        target="_blank"
                        rel="noreferrer"
                        onClick={(e) => e.stopPropagation()}
                        className="inline-flex items-center gap-1 text-ui-fg-base underline-offset-2 hover:underline"
                      >
                        <span className="font-mono">
                          {cleanPath(r.primary_url)}
                        </span>
                        <ArrowUpRightOnBox className="h-3 w-3" />
                      </a>
                    </td>
                    <td className="px-3 py-2 text-right font-mono">
                      #{r.primary_position.toFixed(1)}
                    </td>
                    <td className="px-3 py-2 text-right font-mono">
                      {r.competing_urls.length}
                    </td>
                    <td className="px-3 py-2 text-right font-mono">
                      {r.total_impressions.toLocaleString()}
                    </td>
                    <td className="px-3 py-2">
                      {r.keyword_group_id ? (
                        <Badge color="grey" size="2xsmall">
                          {groupNameById.get(r.keyword_group_id) ?? "(?)"}
                        </Badge>
                      ) : (
                        <Text size="xsmall" className="text-ui-fg-muted">
                          —
                        </Text>
                      )}
                    </td>
                  </tr>
                )
                if (!isOpen) return [rowBase]
                const expansion = (
                  <tr key={key + ":expanded"} className="bg-ui-bg-subtle">
                    <td className="px-3 py-3" colSpan={8}>
                      <div className="flex flex-col gap-2">
                        <Text size="xsmall" weight="plus">
                          Primary + competitors
                        </Text>
                        <table className="w-full border-collapse text-left text-xs">
                          <thead>
                            <tr>
                              <th className="px-2 py-1 font-semibold text-ui-fg-muted">
                                Role
                              </th>
                              <th className="px-2 py-1 font-semibold text-ui-fg-muted">
                                URL
                              </th>
                              <th className="px-2 py-1 font-semibold text-ui-fg-muted text-right">
                                Rank
                              </th>
                              <th className="px-2 py-1 font-semibold text-ui-fg-muted text-right">
                                Clicks
                              </th>
                              <th className="px-2 py-1 font-semibold text-ui-fg-muted text-right">
                                Impressions
                              </th>
                            </tr>
                          </thead>
                          <tbody>
                            <tr className="border-t border-ui-border-base">
                              <td className="px-2 py-1">
                                <Badge color="green" size="2xsmall">
                                  primary
                                </Badge>
                              </td>
                              <td className="px-2 py-1">
                                <a
                                  href={r.primary_url}
                                  target="_blank"
                                  rel="noreferrer"
                                  className="font-mono text-ui-fg-base underline-offset-2 hover:underline"
                                >
                                  {cleanPath(r.primary_url)}
                                </a>
                              </td>
                              <td className="px-2 py-1 text-right font-mono">
                                #{r.primary_position.toFixed(1)}
                              </td>
                              <td className="px-2 py-1 text-right font-mono">
                                {r.primary_clicks.toLocaleString()}
                              </td>
                              <td className="px-2 py-1 text-right font-mono">
                                {r.primary_impressions.toLocaleString()}
                              </td>
                            </tr>
                            {r.competing_urls.map((c) => (
                              <tr
                                key={c.url}
                                className="border-t border-ui-border-base"
                              >
                                <td className="px-2 py-1">
                                  <Badge color="red" size="2xsmall">
                                    competitor
                                  </Badge>
                                </td>
                                <td className="px-2 py-1">
                                  <a
                                    href={c.url}
                                    target="_blank"
                                    rel="noreferrer"
                                    className="font-mono text-ui-fg-base underline-offset-2 hover:underline"
                                  >
                                    {cleanPath(c.url)}
                                  </a>
                                </td>
                                <td className="px-2 py-1 text-right font-mono">
                                  #{c.position.toFixed(1)}
                                </td>
                                <td className="px-2 py-1 text-right font-mono">
                                  {c.clicks.toLocaleString()}
                                </td>
                                <td className="px-2 py-1 text-right font-mono">
                                  {c.impressions.toLocaleString()}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                        {r.tracked_target_id && (
                          <Text size="xsmall" className="text-ui-fg-muted">
                            This query is also tracked as a keyword target
                            (id {r.tracked_target_id}). Resolving this
                            cannibal should bump the target's rank
                            stability.
                          </Text>
                        )}
                      </div>
                    </td>
                  </tr>
                )
                return [rowBase, expansion]
              })
            )}
          </tbody>
        </table>
      </div>

      <Text size="xsmall" className="text-ui-fg-muted">
        Sourced from the GSC <code className="font-mono">query_page</code>{" "}
        dimension rollup × per-day query history. If the table is empty
        you may not have the query_page rollup ingested yet — the
        single-query rollup alone can't detect multi-URL conflicts.
      </Text>
    </section>
  )
}

export default CannibalizationTab
