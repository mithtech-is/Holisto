import React, { useCallback, useEffect, useMemo, useState } from "react"
import { Badge, Button, Heading, Select, Text, toast } from "@medusajs/ui"
import { ArrowUpRightOnBox } from "@medusajs/icons"
import { loadKeywordGroups, type KeywordGroup } from "./types"

/**
 * Opportunities tab — `/app/ovo?tab=opportunities`.
 *
 * Surfaces actionable ranking gaps detected by the live opportunity
 * scan over the last N days of per-target snapshot history (see
 * `OvoService.detectKeywordOpportunities`). Four detection types:
 *
 *   - `losing_position`   position dropped >3 ranks in 7 days — urgent
 *   - `striking_distance` position 11–15 with rising impressions — push
 *   - `ctr_optimization`  rank 4–20, growing imp, <1% CTR — title/desc
 *   - `position_climbing` improved >3 ranks in 7 days — boost candidate
 *
 * The cron at 22:30 UTC (04:00 IST) logs daily summaries; this tab
 * recomputes live on every load so admins can play with the window
 * without waiting on cron rebuilds.
 *
 * Filters: window_days (7–180), group_id (optional).
 */

const WINDOW_OPTIONS = [
  { value: "7", label: "Last 7 days" },
  { value: "14", label: "Last 14 days" },
  { value: "28", label: "Last 28 days" },
  { value: "90", label: "Last 90 days" },
]

type OpportunityType =
  | "losing_position"
  | "striking_distance"
  | "ctr_optimization"
  | "position_climbing"

type Opportunity = {
  target_id: string
  keyword: string
  keyword_group_id: string | null
  url: string | null
  opportunity_type: OpportunityType
  current_position: number | null
  avg_position_14d: number | null
  impressions_14d: number
  clicks_14d: number
  ctr_14d: number
  impressions_slope: number
  position_delta_7d: number | null
  reason: string
}

type OpportunitiesResponse = {
  rows: Opportunity[]
  by_type: Partial<Record<OpportunityType, number>>
  total: number
}

const TYPE_LABEL: Record<OpportunityType, string> = {
  losing_position: "Losing position",
  striking_distance: "Striking distance",
  ctr_optimization: "CTR optimisation",
  position_climbing: "Position climbing",
}

const TYPE_TONE: Record<OpportunityType, "red" | "orange" | "blue" | "green"> = {
  losing_position: "red",
  striking_distance: "orange",
  ctr_optimization: "blue",
  position_climbing: "green",
}

const TYPE_DESCRIPTION: Record<OpportunityType, string> = {
  losing_position:
    "Position dropped >3 ranks in 7 days. Investigate competitor move or content drift.",
  striking_distance:
    "Rank 11–15 with rising impressions. A small content push or internal links can pull onto page 1.",
  ctr_optimization:
    "Rank 4–20, impressions trending up, CTR < 1%. Title/description rewrite candidate.",
  position_climbing:
    "Position improved >3 ranks in 7 days. Reinforce with more internal links + supplementary content.",
}

async function loadOpportunities(opts: {
  window_days: number
  group_id?: string
}): Promise<OpportunitiesResponse> {
  const params = new URLSearchParams()
  params.set("window_days", String(opts.window_days))
  if (opts.group_id) params.set("group_id", opts.group_id)
  const r = await fetch(
    `/admin/ovo/keyword-opportunities?${params.toString()}`,
    { credentials: "include" },
  )
  if (!r.ok) {
    const e = (await r.json().catch(() => ({}))) as { message?: string }
    throw new Error(e.message || `Load failed (${r.status})`)
  }
  return (await r.json()) as OpportunitiesResponse
}

const cleanPath = (url: string | null): string => {
  if (!url) return "unassigned"
  try {
    const u = new URL(url)
    return u.pathname + u.search
  } catch {
    return url
  }
}

const TypeTile: React.FC<{
  type: OpportunityType
  count: number
}> = ({ type, count }) => (
  <div className="flex-1 rounded-md border border-ui-border-base p-4">
    <div className="flex items-center justify-between gap-2">
      <Text size="xsmall" className="text-ui-fg-muted">
        {TYPE_LABEL[type]}
      </Text>
      <Badge color={TYPE_TONE[type]} size="2xsmall">
        {count}
      </Badge>
    </div>
    <Text size="xsmall" className="mt-1 text-ui-fg-muted">
      {TYPE_DESCRIPTION[type]}
    </Text>
  </div>
)

const PositionDeltaCell: React.FC<{ delta: number | null }> = ({ delta }) => {
  if (delta == null) {
    return (
      <Text size="xsmall" className="text-ui-fg-muted">
        —
      </Text>
    )
  }
  if (delta < 0) {
    return (
      <Badge color="green" size="2xsmall">
        <span className="font-mono">↑{Math.abs(delta).toFixed(1)}</span>
      </Badge>
    )
  }
  if (delta > 0) {
    return (
      <Badge color="red" size="2xsmall">
        <span className="font-mono">↓{delta.toFixed(1)}</span>
      </Badge>
    )
  }
  return (
    <Text size="xsmall" className="text-ui-fg-muted">
      flat
    </Text>
  )
}

const OpportunitiesTab: React.FC = () => {
  const [windowDays, setWindowDays] = useState<string>("14")
  const [groupFilter, setGroupFilter] = useState<string>("__all__")
  const [typeFilter, setTypeFilter] = useState<string>("__all__")
  const [groups, setGroups] = useState<KeywordGroup[]>([])
  const [data, setData] = useState<OpportunitiesResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [g, d] = await Promise.all([
        loadKeywordGroups(),
        loadOpportunities({
          window_days: Number(windowDays),
          group_id: groupFilter === "__all__" ? undefined : groupFilter,
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
  }, [windowDays, groupFilter])

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
    if (typeFilter === "__all__") return data.rows
    return data.rows.filter((r) => r.opportunity_type === typeFilter)
  }, [data, typeFilter])

  const allTypes: OpportunityType[] = [
    "losing_position",
    "striking_distance",
    "ctr_optimization",
    "position_climbing",
  ]

  return (
    <section className="flex flex-col gap-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <Heading level="h2">Opportunities</Heading>
          <Text size="small" className="text-ui-fg-muted">
            Live scan of the per-target snapshot history. Action-oriented
            findings ordered urgent-first
            (<code className="font-mono text-xs">losing_position</code> →
            striking distance → CTR → climbing). Persist nothing in
            Phase 1 — this recomputes on every load. The daily cron at
            04:00 IST logs a summary for ops.
          </Text>
        </div>
        <div className="flex items-center gap-2">
          <Select value={groupFilter} onValueChange={setGroupFilter}>
            <Select.Trigger className="w-44">
              <Select.Value placeholder="Group" />
            </Select.Trigger>
            <Select.Content>
              <Select.Item value="__all__">All groups</Select.Item>
              {groups.map((g) => (
                <Select.Item key={g.id} value={g.id}>
                  {g.name}
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

      {/* Type tiles */}
      <div className="flex flex-wrap items-stretch gap-3">
        {allTypes.map((t) => (
          <TypeTile key={t} type={t} count={data?.by_type[t] ?? 0} />
        ))}
      </div>

      <div className="flex items-center gap-2">
        <Select value={typeFilter} onValueChange={setTypeFilter}>
          <Select.Trigger className="w-56">
            <Select.Value placeholder="Type" />
          </Select.Trigger>
          <Select.Content>
            <Select.Item value="__all__">All types</Select.Item>
            {allTypes.map((t) => (
              <Select.Item key={t} value={t}>
                {TYPE_LABEL[t]}
              </Select.Item>
            ))}
          </Select.Content>
        </Select>
        <Text size="xsmall" className="text-ui-fg-muted">
          {data ? `${filteredRows.length} of ${data.total} opportunities` : ""}
        </Text>
      </div>

      <div className="overflow-hidden rounded-md border border-ui-border-base">
        <table className="w-full border-collapse text-left text-xs">
          <thead className="bg-ui-bg-subtle">
            <tr>
              <th className="px-3 py-2 font-semibold text-ui-fg-muted">
                Type
              </th>
              <th className="px-3 py-2 font-semibold text-ui-fg-muted">
                Keyword
              </th>
              <th className="px-3 py-2 font-semibold text-ui-fg-muted">
                Group
              </th>
              <th className="px-3 py-2 font-semibold text-ui-fg-muted">
                URL
              </th>
              <th className="px-3 py-2 font-semibold text-ui-fg-muted text-right">
                Cur. rank
              </th>
              <th className="px-3 py-2 font-semibold text-ui-fg-muted text-right">
                7d Δ
              </th>
              <th className="px-3 py-2 font-semibold text-ui-fg-muted text-right">
                Imp (14d)
              </th>
              <th className="px-3 py-2 font-semibold text-ui-fg-muted text-right">
                CTR (14d)
              </th>
              <th className="px-3 py-2 font-semibold text-ui-fg-muted">
                Reason
              </th>
            </tr>
          </thead>
          <tbody>
            {filteredRows.length === 0 ? (
              <tr>
                <td
                  colSpan={9}
                  className="px-3 py-6 text-center text-ui-fg-muted"
                >
                  {loading
                    ? "Scanning history…"
                    : data && data.total === 0
                    ? "No opportunities detected in this window. Either everything's ranking, or there isn't enough snapshot history yet."
                    : "No opportunities match the filters."}
                </td>
              </tr>
            ) : (
              filteredRows.map((o) => (
                <tr
                  key={o.target_id + o.opportunity_type}
                  className="border-t border-ui-border-base"
                >
                  <td className="px-3 py-2">
                    <Badge
                      color={TYPE_TONE[o.opportunity_type]}
                      size="2xsmall"
                    >
                      {TYPE_LABEL[o.opportunity_type]}
                    </Badge>
                  </td>
                  <td className="px-3 py-2 font-mono text-ui-fg-base">
                    {o.keyword}
                  </td>
                  <td className="px-3 py-2">
                    {o.keyword_group_id ? (
                      <Badge color="grey" size="2xsmall">
                        {groupNameById.get(o.keyword_group_id) ?? "(?)"}
                      </Badge>
                    ) : (
                      <Text size="xsmall" className="text-ui-fg-muted">
                        ungrouped
                      </Text>
                    )}
                  </td>
                  <td className="px-3 py-2">
                    {o.url ? (
                      <a
                        href={o.url}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1 text-ui-fg-base underline-offset-2 hover:underline"
                      >
                        <span className="font-mono">{cleanPath(o.url)}</span>
                        <ArrowUpRightOnBox className="h-3 w-3" />
                      </a>
                    ) : (
                      <Text size="xsmall" className="text-ui-fg-muted">
                        unassigned
                      </Text>
                    )}
                  </td>
                  <td className="px-3 py-2 text-right font-mono">
                    {o.current_position != null
                      ? `#${o.current_position.toFixed(1)}`
                      : "—"}
                  </td>
                  <td className="px-3 py-2 text-right">
                    <PositionDeltaCell delta={o.position_delta_7d} />
                  </td>
                  <td className="px-3 py-2 text-right font-mono">
                    {o.impressions_14d.toLocaleString()}
                  </td>
                  <td className="px-3 py-2 text-right font-mono">
                    {(o.ctr_14d * 100).toFixed(2)}%
                  </td>
                  <td className="px-3 py-2 text-ui-fg-muted italic">
                    {o.reason}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <Text size="xsmall" className="text-ui-fg-muted">
        Opportunity types come from{" "}
        <code className="font-mono">detectKeywordOpportunities</code> —
        a heuristic mix of impression-trend slope, position delta vs 7
        days ago, and CTR-vs-position expected-value table. Phase 4 will
        surface these as one-click "create content brief" CTAs that
        prefill the AI-content generator.
      </Text>
    </section>
  )
}

export default OpportunitiesTab
