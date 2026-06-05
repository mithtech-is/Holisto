import React, { useCallback, useEffect, useMemo, useState } from "react"
import { Badge, Button, Heading, Select, Text, toast } from "@medusajs/ui"
import {
  loadKeywordGroups,
  type KeywordFunnelStage as FunnelStage,
  type KeywordGroup,
} from "./types"

/**
 * Groups Performance tab — `/app/ovo?tab=groups-perf`.
 *
 * Cross-group leaderboard rolled up from the per-target snapshot
 * history (Phase 1 of OVO keyword domination). Three slices:
 *
 *   1. Window-wide totals (clicks, impressions, avg position) per
 *      group across the selected window (default 28 days).
 *   2. Funnel-stage mix — share of tracked keywords by TOFU/MOFU/BOFU
 *      so admins can see whether the buy-intent funnel is starved.
 *   3. Per-group health: % keywords ranking ≤10 and ≤3.
 *
 * Data sources:
 *   - `GET /admin/ovo/keyword-groups`                       — list groups
 *   - `GET /admin/ovo/keyword-groups/:id/performance`       — per-group rollup
 *
 * One fetch round-trip per group on first load + window-change. With
 * the seeded 8 groups this is ~9 calls; well under any concern.
 */

const WINDOW_OPTIONS = [
  { value: "7", label: "Last 7 days" },
  { value: "28", label: "Last 28 days" },
  { value: "90", label: "Last 90 days" },
  { value: "180", label: "Last 180 days" },
]

type GroupPerfSummary = {
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
}

type GroupRow = KeywordGroup & {
  perf: GroupPerfSummary | null
  perf_error?: string
}

async function loadGroupPerf(
  id: string,
  windowDays: number,
): Promise<GroupPerfSummary> {
  const r = await fetch(
    `/admin/ovo/keyword-groups/${encodeURIComponent(id)}/performance?window_days=${windowDays}`,
    { credentials: "include" },
  )
  if (!r.ok) {
    const e = (await r.json().catch(() => ({}))) as { message?: string }
    throw new Error(e.message || `Load perf failed (${r.status})`)
  }
  return (await r.json()) as GroupPerfSummary
}

/* ── presentational helpers ──────────────────────────────────────── */

const FUNNEL_TONE: Record<FunnelStage, "blue" | "purple" | "green"> = {
  TOFU: "blue",
  MOFU: "purple",
  BOFU: "green",
}

const FunnelBadge: React.FC<{ stage: FunnelStage | null }> = ({ stage }) => {
  if (!stage)
    return (
      <Text size="xsmall" className="text-ui-fg-muted">
        —
      </Text>
    )
  return (
    <Badge color={FUNNEL_TONE[stage]} size="2xsmall">
      {stage}
    </Badge>
  )
}

const HealthBadge: React.FC<{ pct_top10: number; targets: number }> = ({
  pct_top10,
  targets,
}) => {
  if (targets === 0) {
    return (
      <Text size="xsmall" className="text-ui-fg-muted">
        no data
      </Text>
    )
  }
  const tone: "green" | "orange" | "red" =
    pct_top10 >= 80 ? "green" : pct_top10 >= 50 ? "orange" : "red"
  return (
    <Badge color={tone} size="2xsmall">
      {pct_top10.toFixed(0)}% top-10
    </Badge>
  )
}

const StatTile: React.FC<{
  label: string
  value: string
  hint?: string
  tone?: "green" | "orange" | "red" | "grey"
}> = ({ label, value, hint, tone = "grey" }) => (
  <div className="flex-1 rounded-md border border-ui-border-base p-4">
    <Text size="xsmall" className="text-ui-fg-muted">
      {label}
    </Text>
    <div className="mt-1 flex items-baseline gap-2">
      <Heading level="h3" className="font-mono">
        {value}
      </Heading>
      {hint && (
        <Badge color={tone} size="2xsmall">
          {hint}
        </Badge>
      )}
    </div>
  </div>
)

/* ── main ────────────────────────────────────────────────────────── */

const GroupsPerfTab: React.FC = () => {
  const [windowDays, setWindowDays] = useState<string>("28")
  const [rows, setRows] = useState<GroupRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const groups = await loadKeywordGroups()
      // Fetch perf in parallel (~8 groups = 8 reqs).
      const perfResults = await Promise.allSettled(
        groups.map((g) => loadGroupPerf(g.id, Number(windowDays))),
      )
      const merged: GroupRow[] = groups.map((g, i) => {
        const r = perfResults[i]
        return r.status === "fulfilled"
          ? { ...g, perf: r.value }
          : { ...g, perf: null, perf_error: (r.reason as Error)?.message }
      })
      setRows(merged)
    } catch (err) {
      setError((err as Error).message)
      toast.error("Load failed", { description: (err as Error).message })
    } finally {
      setLoading(false)
    }
  }, [windowDays])

  useEffect(() => {
    refresh()
  }, [refresh])

  // Aggregates across all groups
  const totals = useMemo(() => {
    let clicks = 0
    let impressions = 0
    let targetsTracked = 0
    let targetsWon = 0
    let posWeightedSum = 0
    let posWeight = 0
    for (const r of rows) {
      const p = r.perf
      if (!p) continue
      clicks += p.clicks_total
      impressions += p.impressions_total
      targetsTracked += p.targets_tracked
      targetsWon += p.targets_won
      if (p.avg_position != null) {
        posWeightedSum += p.avg_position * p.impressions_total
        posWeight += p.impressions_total
      }
    }
    return {
      clicks,
      impressions,
      ctr: impressions > 0 ? clicks / impressions : 0,
      avg_position: posWeight > 0 ? posWeightedSum / posWeight : null,
      targets_tracked: targetsTracked,
      targets_won: targetsWon,
    }
  }, [rows])

  // Funnel-stage breakdown (rough — by targets_tracked weight)
  const funnel = useMemo(() => {
    const acc: Record<FunnelStage | "other", number> = {
      TOFU: 0,
      MOFU: 0,
      BOFU: 0,
      other: 0,
    }
    for (const r of rows) {
      const n = r.perf?.targets_tracked ?? 0
      if (r.funnel_stage) acc[r.funnel_stage] += n
      else acc.other += n
    }
    const total = acc.TOFU + acc.MOFU + acc.BOFU + acc.other
    return {
      counts: acc,
      total,
      pct: {
        TOFU: total > 0 ? (acc.TOFU / total) * 100 : 0,
        MOFU: total > 0 ? (acc.MOFU / total) * 100 : 0,
        BOFU: total > 0 ? (acc.BOFU / total) * 100 : 0,
        other: total > 0 ? (acc.other / total) * 100 : 0,
      },
    }
  }, [rows])

  // Sort: pillars first, then by clicks_total desc, then by name.
  const sortedRows = useMemo(() => {
    return [...rows].sort((a, b) => {
      if (a.is_pillar !== b.is_pillar) return a.is_pillar ? -1 : 1
      const ac = a.perf?.clicks_total ?? 0
      const bc = b.perf?.clicks_total ?? 0
      if (ac !== bc) return bc - ac
      return a.name.localeCompare(b.name)
    })
  }, [rows])

  return (
    <section className="flex flex-col gap-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <Heading level="h2">Groups performance</Heading>
          <Text size="small" className="text-ui-fg-muted">
            Per-group rollup from the daily snapshot cron
            (<code className="font-mono text-xs">keyword-performance-rollup</code>).
            Pillar groups are listed first; non-pillar groups fall below.
            Avg position is impression-weighted across the window.
          </Text>
        </div>
        <div className="flex items-center gap-2">
          <Select value={windowDays} onValueChange={setWindowDays}>
            <Select.Trigger className="w-44">
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

      {/* Window-wide totals */}
      <div className="flex flex-wrap items-stretch gap-3">
        <StatTile
          label={`Clicks (${windowDays}d)`}
          value={totals.clicks.toLocaleString()}
        />
        <StatTile
          label={`Impressions (${windowDays}d)`}
          value={totals.impressions.toLocaleString()}
        />
        <StatTile
          label="Site-wide CTR"
          value={`${(totals.ctr * 100).toFixed(2)}%`}
        />
        <StatTile
          label="Avg position"
          value={
            totals.avg_position == null
              ? "—"
              : `#${totals.avg_position.toFixed(1)}`
          }
        />
        <StatTile
          label="Tracked keywords"
          value={totals.targets_tracked.toString()}
          hint={`${totals.targets_won} won`}
          tone="green"
        />
      </div>

      {/* Funnel-stage mix */}
      {funnel.total > 0 && (
        <div className="flex flex-col gap-2 rounded-md border border-ui-border-base p-3">
          <div>
            <Text size="small" weight="plus" className="text-ui-fg-base">
              Funnel-stage mix
            </Text>
            <Text size="xsmall" className="text-ui-fg-muted">
              Share of tracked keywords by their group's funnel stage.
              A starved BOFU slice is a leading indicator that the
              buy-intent surface is under-instrumented.
            </Text>
          </div>
          <div className="flex h-6 w-full overflow-hidden rounded">
            {funnel.pct.TOFU > 0 && (
              <div
                className="bg-blue-500 flex items-center justify-center text-[10px] text-white"
                style={{ width: `${funnel.pct.TOFU}%` }}
                title={`TOFU: ${funnel.counts.TOFU} keywords`}
              >
                {funnel.pct.TOFU >= 10
                  ? `TOFU ${funnel.pct.TOFU.toFixed(0)}%`
                  : ""}
              </div>
            )}
            {funnel.pct.MOFU > 0 && (
              <div
                className="bg-purple-500 flex items-center justify-center text-[10px] text-white"
                style={{ width: `${funnel.pct.MOFU}%` }}
                title={`MOFU: ${funnel.counts.MOFU} keywords`}
              >
                {funnel.pct.MOFU >= 10
                  ? `MOFU ${funnel.pct.MOFU.toFixed(0)}%`
                  : ""}
              </div>
            )}
            {funnel.pct.BOFU > 0 && (
              <div
                className="bg-green-500 flex items-center justify-center text-[10px] text-white"
                style={{ width: `${funnel.pct.BOFU}%` }}
                title={`BOFU: ${funnel.counts.BOFU} keywords`}
              >
                {funnel.pct.BOFU >= 10
                  ? `BOFU ${funnel.pct.BOFU.toFixed(0)}%`
                  : ""}
              </div>
            )}
            {funnel.pct.other > 0 && (
              <div
                className="bg-ui-bg-component flex items-center justify-center text-[10px] text-ui-fg-muted"
                style={{ width: `${funnel.pct.other}%` }}
                title={`Unstaged: ${funnel.counts.other} keywords`}
              />
            )}
          </div>
        </div>
      )}

      {/* Per-group leaderboard */}
      <div className="overflow-hidden rounded-md border border-ui-border-base">
        <table className="w-full border-collapse text-left text-xs">
          <thead className="bg-ui-bg-subtle">
            <tr>
              <th className="px-3 py-2 font-semibold text-ui-fg-muted">
                Group
              </th>
              <th className="px-3 py-2 font-semibold text-ui-fg-muted">
                Funnel
              </th>
              <th className="px-3 py-2 font-semibold text-ui-fg-muted text-right">
                Tracked
              </th>
              <th className="px-3 py-2 font-semibold text-ui-fg-muted text-right">
                Won
              </th>
              <th className="px-3 py-2 font-semibold text-ui-fg-muted text-right">
                Clicks
              </th>
              <th className="px-3 py-2 font-semibold text-ui-fg-muted text-right">
                Impressions
              </th>
              <th className="px-3 py-2 font-semibold text-ui-fg-muted text-right">
                CTR
              </th>
              <th className="px-3 py-2 font-semibold text-ui-fg-muted text-right">
                Avg pos
              </th>
              <th className="px-3 py-2 font-semibold text-ui-fg-muted">
                Health
              </th>
              <th className="px-3 py-2 font-semibold text-ui-fg-muted text-right">
                Volatility
              </th>
            </tr>
          </thead>
          <tbody>
            {sortedRows.length === 0 ? (
              <tr>
                <td
                  colSpan={10}
                  className="px-3 py-6 text-center text-ui-fg-muted"
                >
                  {loading
                    ? "Loading…"
                    : "No keyword groups yet. Add some from the Keywords tab."}
                </td>
              </tr>
            ) : (
              sortedRows.map((g) => {
                const p = g.perf
                const tracked = p?.targets_tracked ?? 0
                const won = p?.targets_won ?? 0
                const pctTop10 = tracked > 0 ? (won / tracked) * 100 : 0
                return (
                  <tr
                    key={g.id}
                    className="border-t border-ui-border-base"
                  >
                    <td className="px-3 py-2">
                      <div className="flex items-center gap-2">
                        {g.is_pillar && (
                          <Badge color="orange" size="2xsmall">
                            pillar
                          </Badge>
                        )}
                        <span
                          className="font-mono text-ui-fg-base"
                          title={g.slug}
                        >
                          {g.name}
                        </span>
                      </div>
                    </td>
                    <td className="px-3 py-2">
                      <FunnelBadge stage={g.funnel_stage} />
                    </td>
                    <td className="px-3 py-2 text-right font-mono">
                      {tracked}
                    </td>
                    <td className="px-3 py-2 text-right font-mono">
                      {won > 0 ? (
                        <Badge color="green" size="2xsmall">
                          {won}
                        </Badge>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td className="px-3 py-2 text-right font-mono">
                      {p ? p.clicks_total.toLocaleString() : "—"}
                    </td>
                    <td className="px-3 py-2 text-right font-mono">
                      {p ? p.impressions_total.toLocaleString() : "—"}
                    </td>
                    <td className="px-3 py-2 text-right font-mono">
                      {p && p.impressions_total > 0
                        ? `${(p.ctr_avg * 100).toFixed(2)}%`
                        : "—"}
                    </td>
                    <td className="px-3 py-2 text-right font-mono">
                      {p && p.avg_position != null
                        ? `#${p.avg_position.toFixed(1)}`
                        : "—"}
                    </td>
                    <td className="px-3 py-2">
                      <HealthBadge
                        pct_top10={pctTop10}
                        targets={tracked}
                      />
                    </td>
                    <td className="px-3 py-2 text-right font-mono">
                      {p?.volatility != null
                        ? p.volatility.toFixed(2)
                        : "—"}
                    </td>
                  </tr>
                )
              })
            )}
          </tbody>
        </table>
      </div>

      <Text size="xsmall" className="text-ui-fg-muted">
        "Won" reflects the auto-flip from{" "}
        <code className="font-mono">rollupKeywordPerformance</code> when a
        target's average position crosses its{" "}
        <code className="font-mono">target_position</code> threshold.
        Volatility is the sample-variance of impression-weighted average
        position across days in the window — lower is steadier ranking.
      </Text>
    </section>
  )
}

export default GroupsPerfTab
