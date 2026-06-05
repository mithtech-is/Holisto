import React, { useCallback, useEffect, useMemo, useState } from "react"
import { Badge, Button, Heading, Text, toast } from "@medusajs/ui"

/**
 * Metrics tab for `/app/ovo?tab=metrics`.
 *
 * Charts the daily rows in `ovo_seo_metric` written by the daily
 * 00:30 UTC `seo-daily-ingest` cron. Two-section layout:
 *
 *   - Google Search Console — 4 line charts (impressions, clicks,
 *     CTR, average position) plus today's indexed-URL snapshot.
 *   - Bing Webmaster — once Bing accumulates traffic for the site
 *     (~1-2 weeks after verification), the same metric family
 *     populates. Shows a soft empty state until then.
 *
 * Range selector defaults to 30 days back. 7d / 30d / 90d buckets
 * are wide enough for the common "is search up or down" question
 * without overloading the GSC API quota (we cache via the metric
 * table — re-fetching the same range twice in 60s hits the DB
 * cheaply, no upstream call).
 *
 * Charts are vanilla SVG — no chart library is required by Medusa's
 * admin runtime and pulling one in for ~140px sparklines would
 * inflate the admin bundle for very little gain.
 */

type SeoMetricRow = {
  id: string
  engine: string
  metric_type: string
  date: string
  value: number | string
  raw_response?: unknown
}

type Series = {
  label: string
  metric_type: string
  rows: { date: Date; value: number }[]
  format: (v: number) => string
  hint: string
  /** lower-is-better metric (avg_position). Affects the trend arrow. */
  inverted?: boolean
}

type DimensionRow = {
  id: string
  dimension_value: string
  clicks: number | string
  impressions: number | string
  ctr: number | string
  position: number | string
  captured_at: string
}

type QueryHistoryRow = {
  id: string
  query: string
  date: string
  clicks: number | string
  impressions: number | string
  ctr: number | string
  position: number | string
}

const METRICS_API = "/admin/ovo/seo/metrics"
const DIMENSIONS_API = "/admin/ovo/seo/dimensions"
const QUERY_TREND_API = "/admin/ovo/seo/query-trend"
const RANGE_OPTIONS: Array<{ label: string; days: number }> = [
  { label: "7d", days: 7 },
  { label: "30d", days: 30 },
  { label: "90d", days: 90 },
]

async function loadSeries(
  engine: "gsc" | "bing" | "crux",
  metric_type: string,
  daysBack: number,
): Promise<SeoMetricRow[]> {
  const to = new Date()
  const from = new Date(to.getTime() - daysBack * 24 * 60 * 60 * 1000)
  const qs = new URLSearchParams({
    engine,
    metric_type,
    from: from.toISOString(),
    to: to.toISOString(),
    limit: "1000",
  })
  const r = await fetch(`${METRICS_API}?${qs.toString()}`, {
    credentials: "include",
  })
  if (!r.ok) {
    throw new Error(`Failed to load ${engine}/${metric_type} (${r.status})`)
  }
  const json = (await r.json()) as { rows: SeoMetricRow[] }
  return json.rows
}

async function loadDimension(
  dimension: "query" | "page" | "country" | "device",
  limit = 50,
  engine: "gsc" | "yandex" = "gsc",
): Promise<DimensionRow[]> {
  const qs = new URLSearchParams({
    dimension,
    limit: String(limit),
    engine,
  })
  const r = await fetch(`${DIMENSIONS_API}?${qs.toString()}`, {
    credentials: "include",
  })
  if (!r.ok) {
    throw new Error(`Failed to load ${dimension} rollup (${r.status})`)
  }
  const json = (await r.json()) as { rows: DimensionRow[] }
  return json.rows
}

async function loadQueryTrend(
  query: string,
): Promise<QueryHistoryRow[]> {
  const qs = new URLSearchParams({ query, limit: "1000" })
  const r = await fetch(`${QUERY_TREND_API}?${qs.toString()}`, {
    credentials: "include",
  })
  if (!r.ok) {
    throw new Error(`Failed to load trend for "${query}" (${r.status})`)
  }
  const json = (await r.json()) as { rows: QueryHistoryRow[] }
  return json.rows
}

function toSeries(
  label: string,
  metric_type: string,
  rows: SeoMetricRow[],
  format: (v: number) => string,
  hint: string,
  inverted = false,
): Series {
  return {
    label,
    metric_type,
    hint,
    format,
    inverted,
    rows: rows
      .map((r) => ({ date: new Date(r.date), value: Number(r.value) }))
      .filter((p) => Number.isFinite(p.value))
      .sort((a, b) => a.date.getTime() - b.date.getTime()),
  }
}

const fmtInt = (v: number) =>
  v >= 1000 ? `${(v / 1000).toFixed(1)}k` : Math.round(v).toLocaleString()
const fmtPct = (v: number) => `${(v * 100).toFixed(2)}%`
const fmtPos = (v: number) => v.toFixed(1)

const TrendChip: React.FC<{ series: Series }> = ({ series }) => {
  if (series.rows.length < 2) return null
  const last = series.rows[series.rows.length - 1].value
  const first = series.rows[0].value
  const diff = last - first
  const pct = first === 0 ? 0 : (diff / Math.abs(first)) * 100
  const improving = series.inverted ? diff < 0 : diff > 0
  const flat = Math.abs(pct) < 1
  const tone = flat ? "grey" : improving ? "green" : "red"
  // Arrow follows the raw value direction (↑ value grew, ↓ value
  // shrank). Color carries the good/bad interpretation, so an inverted
  // metric like avg_position correctly reads as "↓ 47% (green)" when
  // the rank number got smaller (which is an improvement).
  const arrow = flat ? "→" : diff > 0 ? "↑" : "↓"
  return (
    <Badge color={tone as "grey" | "green" | "red"} size="2xsmall">
      {arrow} {Math.abs(pct).toFixed(0)}%
    </Badge>
  )
}

/**
 * Vanilla SVG sparkline. Renders a polyline through the data points
 * plus a fade-down area fill, a faint zero baseline, and the latest
 * point as a solid dot. Auto-scales Y to [min, max] with 5% headroom.
 */
const MiniLineChart: React.FC<{ series: Series; height?: number }> = ({
  series,
  height = 140,
}) => {
  const W = 600
  const H = height
  const padL = 36
  const padR = 8
  const padT = 8
  const padB = 22

  if (series.rows.length === 0) {
    return (
      <div
        className="flex items-center justify-center rounded-md border border-dashed border-ui-border-base"
        style={{ height: H }}
      >
        <Text size="small" className="text-ui-fg-muted">
          No data yet
        </Text>
      </div>
    )
  }

  const values = series.rows.map((r) => r.value)
  const minV = Math.min(...values, 0)
  const maxV = Math.max(...values)
  // Span padding: 5% headroom around real data. When every point is
  // identical (span = 0), fall back to 10 % of the absolute value so
  // we still get a visible flat line instead of dividing by zero —
  // and to a hard 1 when the value is also zero.
  const rawSpan = maxV - minV
  const span = rawSpan > 0 ? rawSpan : Math.abs(maxV) * 0.1 || 1
  const yMin = minV - span * 0.05
  const yMax = maxV + span * 0.05
  const ySpan = yMax - yMin

  const x = (i: number) =>
    padL + (i * (W - padL - padR)) / Math.max(1, series.rows.length - 1)
  const y = (v: number) => padT + ((yMax - v) / ySpan) * (H - padT - padB)

  const pts = series.rows.map((r, i) => `${x(i)},${y(r.value)}`).join(" ")
  const area = `M ${padL},${y(yMin)} L ${pts.split(" ").join(" L ")} L ${x(
    series.rows.length - 1,
  )},${y(yMin)} Z`

  const firstDate = series.rows[0].date
  const lastDate = series.rows[series.rows.length - 1].date
  const fmtDate = (d: Date) =>
    `${d.getUTCMonth() + 1}/${d.getUTCDate()}`

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" preserveAspectRatio="none">
      {/* Y-axis labels */}
      <text x={4} y={padT + 8} className="fill-ui-fg-muted" fontSize="10">
        {series.format(yMax)}
      </text>
      <text
        x={4}
        y={H - padB + 4}
        className="fill-ui-fg-muted"
        fontSize="10"
      >
        {series.format(Math.max(yMin, 0))}
      </text>
      {/* X-axis labels */}
      <text
        x={padL}
        y={H - 6}
        className="fill-ui-fg-muted"
        fontSize="10"
      >
        {fmtDate(firstDate)}
      </text>
      <text
        x={W - padR}
        y={H - 6}
        textAnchor="end"
        className="fill-ui-fg-muted"
        fontSize="10"
      >
        {fmtDate(lastDate)}
      </text>
      {/* baseline */}
      <line
        x1={padL}
        x2={W - padR}
        y1={y(Math.max(yMin, 0))}
        y2={y(Math.max(yMin, 0))}
        stroke="currentColor"
        strokeWidth={0.5}
        className="text-ui-border-base"
      />
      {/* area fill */}
      <path d={area} className="fill-ui-tag-blue-bg" opacity={0.25} />
      {/* line */}
      <polyline
        points={pts}
        fill="none"
        stroke="currentColor"
        strokeWidth={1.8}
        className="text-ui-tag-blue-icon"
      />
      {/* dots */}
      {series.rows.map((r, i) => (
        <circle
          key={i}
          cx={x(i)}
          cy={y(r.value)}
          r={i === series.rows.length - 1 ? 3 : 1.4}
          className="fill-ui-tag-blue-icon"
        >
          <title>
            {r.date.toISOString().slice(0, 10)}: {series.format(r.value)}
          </title>
        </circle>
      ))}
    </svg>
  )
}

/* ── CrUX / Core Web Vitals panel (Phase 12.B) ─────────────────── */

type CwvMetricKey = "lcp" | "cls" | "inp" | "fcp" | "ttfb"
type CwvFormFactor = "phone" | "desktop" | "all"

const CWV_METRICS: Array<{
  key: CwvMetricKey
  label: string
  /** Threshold values for Google's Good / Needs Improvement / Poor split. */
  goodMax: number
  needsImprovementMax: number
  format: (v: number) => string
}> = [
  {
    key: "lcp",
    label: "LCP",
    goodMax: 2500,
    needsImprovementMax: 4000,
    format: (v) => `${(v / 1000).toFixed(2)} s`,
  },
  {
    key: "cls",
    label: "CLS",
    goodMax: 0.1,
    needsImprovementMax: 0.25,
    format: (v) => v.toFixed(3),
  },
  {
    key: "inp",
    label: "INP",
    goodMax: 200,
    needsImprovementMax: 500,
    format: (v) => `${Math.round(v)} ms`,
  },
  {
    key: "fcp",
    label: "FCP",
    goodMax: 1800,
    needsImprovementMax: 3000,
    format: (v) => `${(v / 1000).toFixed(2)} s`,
  },
  {
    key: "ttfb",
    label: "TTFB",
    goodMax: 800,
    needsImprovementMax: 1800,
    format: (v) => `${Math.round(v)} ms`,
  },
]

type CwvCell = { p75: number; good: number } | null

const CwvPanel: React.FC = () => {
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [data, setData] = useState<Record<
    CwvFormFactor,
    Record<CwvMetricKey, CwvCell>
  > | null>(null)
  const [collectedAt, setCollectedAt] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    const run = async () => {
      setLoading(true)
      setError(null)
      try {
        // Phase 13.C — single batched endpoint replaces 30 parallel
        // `loadSeries("crux", ...)` calls (5 metrics × 3 form factors ×
        // 2 kinds) that triggered the admin rate-limiter (429) on
        // first load alongside the GSC/Bing/Yandex parallel reads.
        const r = await fetch("/admin/ovo/cwv/latest", {
          credentials: "include",
        })
        if (!r.ok) {
          throw new Error(`CWV load failed (${r.status})`)
        }
        const json = (await r.json()) as {
          collected_at: string | null
        } & Record<CwvFormFactor, Record<CwvMetricKey, CwvCell>>
        if (!cancelled) {
          setData({
            phone: json.phone,
            desktop: json.desktop,
            all: json.all,
          })
          setCollectedAt(json.collected_at)
        }
      } catch (err) {
        if (!cancelled) setError((err as Error).message)
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    run()
    return () => {
      cancelled = true
    }
  }, [])

  const triggerIngest = async () => {
    try {
      const r = await fetch("/admin/ovo/cwv/ingest", {
        method: "POST",
        credentials: "include",
      })
      const out = (await r.json()) as { written?: number; message?: string }
      if (!r.ok) {
        throw new Error(out.message || `Ingest failed (${r.status})`)
      }
      toast.success(`CrUX ingest wrote ${out.written ?? 0} rows`)
      // Re-mount via dependency-less effect won't auto-fire; force a reload.
      window.location.reload()
    } catch (err) {
      toast.error("CrUX ingest failed", { description: (err as Error).message })
    }
  }

  const hasAnyData = data
    ? (Object.values(data) as Record<CwvMetricKey, CwvCell>[]).some((row) =>
        Object.values(row).some((cell) => cell !== null),
      )
    : false

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <Heading level="h3">Core Web Vitals (CrUX, 28-day field data)</Heading>
        <div className="flex items-center gap-2">
          {collectedAt && (
            <Text size="xsmall" className="text-ui-fg-muted">
              window ending {collectedAt.slice(0, 10)}
            </Text>
          )}
          <Button variant="transparent" size="small" onClick={triggerIngest}>
            Run ingest now
          </Button>
        </div>
      </div>
      {loading ? (
        <Text size="small" className="text-ui-fg-muted">
          Loading CrUX…
        </Text>
      ) : error ? (
        <div className="rounded-md border border-ui-tag-red-border bg-ui-tag-red-bg p-3">
          <Text size="small" className="text-ui-tag-red-text">
            {error}
          </Text>
        </div>
      ) : !hasAnyData ? (
        <div className="rounded-md border border-dashed border-ui-border-base p-6">
          <Text size="small" className="text-ui-fg-base">
            No CrUX data yet.
          </Text>
          <Text size="xsmall" className="mt-2 text-ui-fg-muted">
            Two reasons this can show empty:
          </Text>
          <ul className="mt-2 ml-5 list-disc text-xs text-ui-fg-muted">
            <li>
              CrUX API key not configured — paste one in the Submit tab's
              Integrations card.
            </li>
            <li>
              Origin has insufficient real-user traffic. CrUX needs a
              non-trivial sample of Chrome users — fresh domains usually need
              a few weeks of organic traffic before any form factor returns
              data.
            </li>
          </ul>
        </div>
      ) : (
        <div className="overflow-hidden rounded-md border border-ui-border-base">
          <table className="w-full border-collapse text-left text-xs">
            <thead className="bg-ui-bg-subtle">
              <tr>
                <th className="px-3 py-2 font-semibold text-ui-fg-muted">
                  Metric
                </th>
                <th className="px-3 py-2 font-semibold text-ui-fg-muted">
                  Mobile (p75 / Good %)
                </th>
                <th className="px-3 py-2 font-semibold text-ui-fg-muted">
                  Desktop (p75 / Good %)
                </th>
                <th className="px-3 py-2 font-semibold text-ui-fg-muted">
                  All (p75 / Good %)
                </th>
                <th className="px-3 py-2 font-semibold text-ui-fg-muted">
                  Good ≤
                </th>
              </tr>
            </thead>
            <tbody>
              {CWV_METRICS.map((m) => (
                <tr
                  key={m.key}
                  className="border-t border-ui-border-base"
                >
                  <td className="px-3 py-2 font-mono text-ui-fg-base">
                    {m.label}
                  </td>
                  <CwvTd cell={data!.phone[m.key]} meta={m} />
                  <CwvTd cell={data!.desktop[m.key]} meta={m} />
                  <CwvTd cell={data!.all[m.key]} meta={m} />
                  <td className="px-3 py-2 text-ui-fg-muted">
                    {m.format(m.goodMax)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

const CwvTd: React.FC<{
  cell: CwvCell
  meta: (typeof CWV_METRICS)[number]
}> = ({ cell, meta }) => {
  if (!cell) {
    return <td className="px-3 py-2 text-ui-fg-muted">—</td>
  }
  const tone =
    cell.p75 <= meta.goodMax
      ? "text-ui-tag-green-text"
      : cell.p75 <= meta.needsImprovementMax
        ? "text-ui-tag-orange-text"
        : "text-ui-tag-red-text"
  return (
    <td className="px-3 py-2">
      <span className={`font-mono font-semibold ${tone}`}>
        {meta.format(cell.p75)}
      </span>
      <span className="ml-2 text-ui-fg-muted">
        ({Math.round(cell.good * 100)}% good)
      </span>
    </td>
  )
}

const ChartCard: React.FC<{ series: Series }> = ({ series }) => {
  const last = series.rows.length
    ? series.rows[series.rows.length - 1]
    : null
  return (
    <div className="flex flex-col gap-2 rounded-md border border-ui-border-base p-4">
      <div className="flex items-baseline justify-between gap-2">
        <div>
          <Text size="small" weight="plus" className="text-ui-fg-base">
            {series.label}
          </Text>
          <Text size="xsmall" className="text-ui-fg-muted">
            {series.hint}
          </Text>
        </div>
        <div className="flex flex-col items-end gap-0.5">
          <Heading level="h3" className="font-mono">
            {last ? series.format(last.value) : "—"}
          </Heading>
          <TrendChip series={series} />
        </div>
      </div>
      <MiniLineChart series={series} />
    </div>
  )
}

/**
 * Resolve a country dimension value into a human-readable name. GSC
 * returns ISO 3166-1 alpha-3 ("ind", "usa", …). Falls back to the raw
 * code uppercased if the locale lookup misses (older Node-in-Chromium
 * builds without the Intl.DisplayNames data).
 */
const countryName = (code: string): string => {
  if (!code) return "—"
  // GSC sometimes returns "zzz" for unknown — pass through as-is.
  try {
    const upper = code.toUpperCase()
    // DisplayNames needs alpha-2 OR alpha-3 (most modern runtimes
    // accept both via region type). Wrap to silence errors.
    const Intl_ =
      (globalThis as unknown as { Intl?: { DisplayNames?: any } }).Intl
    if (Intl_?.DisplayNames) {
      const dn = new Intl_.DisplayNames(["en"], { type: "region" })
      return dn.of(upper) ?? upper
    }
    return upper
  } catch {
    return code.toUpperCase()
  }
}

/**
 * Format a dimension value for a row label depending on its type.
 *   - query   — raw search string
 *   - page    — full URL (truncated tail in the cell)
 *   - country — ISO alpha-3 → English country name
 *   - device  — "DESKTOP" → "Desktop"
 */
const formatDimValue = (
  type: "query" | "page" | "country" | "device",
  value: string,
): string => {
  if (type === "country") return countryName(value)
  if (type === "device") {
    return (
      value.charAt(0).toUpperCase() + value.slice(1).toLowerCase() || value
    )
  }
  return value
}

/**
 * Format a numeric-or-string value as integer. Mikro-ORM serialises
 * `double precision` as JS number, but a future bigint-coerced row
 * would come back as string — `Number(x)` handles both.
 */
const toInt = (v: number | string): number => {
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
}

/**
 * Sortable, optionally-expandable table that lists the rows of one
 * dimension rollup (top queries / pages / countries / devices). Used
 * uniformly across the four tables on the Metrics tab.
 *
 * Click a row to toggle the "expanded" state — for the `query`
 * dimension, this surfaces a per-query rank trend chart inline.
 */
const DimensionTable: React.FC<{
  rows: DimensionRow[]
  type: "query" | "page" | "country" | "device"
  expandable?: boolean
  onExpand?: (value: string) => void
  expandedKey?: string | null
  /** Renders inside the expanded slot under the active row. */
  renderExpanded?: (value: string) => React.ReactNode
  emptyHint?: string
}> = ({
  rows,
  type,
  expandable = false,
  onExpand,
  expandedKey,
  renderExpanded,
  emptyHint = "Nothing yet — daily ingest hasn't filled this dimension. Try the manual fire on the Submit tab.",
}) => {
  if (!rows.length) {
    return (
      <div className="rounded-md border border-dashed border-ui-border-base p-5 text-center">
        <Text size="small" className="text-ui-fg-muted">
          {emptyHint}
        </Text>
      </div>
    )
  }

  const totalClicks = rows.reduce((s, r) => s + toInt(r.clicks), 0)
  const totalImps = rows.reduce((s, r) => s + toInt(r.impressions), 0)

  const labelHeader = {
    query: "Query",
    page: "Page",
    country: "Country",
    device: "Device",
  }[type]

  return (
    <div className="overflow-hidden rounded-md border border-ui-border-base">
      <table className="w-full border-collapse text-left text-xs">
        <thead className="bg-ui-bg-subtle">
          <tr>
            <th className="px-3 py-2 font-semibold text-ui-fg-muted">
              {labelHeader}
            </th>
            <th className="px-3 py-2 text-right font-semibold text-ui-fg-muted">
              Clicks
            </th>
            <th className="px-3 py-2 text-right font-semibold text-ui-fg-muted">
              Share
            </th>
            <th className="px-3 py-2 text-right font-semibold text-ui-fg-muted">
              Impr.
            </th>
            <th className="px-3 py-2 text-right font-semibold text-ui-fg-muted">
              CTR
            </th>
            <th className="px-3 py-2 text-right font-semibold text-ui-fg-muted">
              Pos.
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const clicks = toInt(r.clicks)
            const imps = toInt(r.impressions)
            const ctr = Number(r.ctr) || 0
            const pos = Number(r.position) || 0
            const sharePct =
              totalClicks > 0 ? (clicks / totalClicks) * 100 : 0
            const isExpanded = expandable && expandedKey === r.dimension_value
            return (
              <React.Fragment key={r.id}>
                <tr
                  className={
                    "border-t border-ui-border-base transition-colors " +
                    (expandable
                      ? "cursor-pointer hover:bg-ui-bg-base-hover"
                      : "")
                  }
                  onClick={
                    expandable && onExpand
                      ? () =>
                          onExpand(
                            isExpanded ? "" : r.dimension_value,
                          )
                      : undefined
                  }
                >
                  <td className="px-3 py-2">
                    <div className="flex items-center gap-2">
                      {expandable && (
                        <span className="font-mono text-ui-fg-muted">
                          {isExpanded ? "▾" : "▸"}
                        </span>
                      )}
                      {type === "page" ? (
                        <a
                          href={r.dimension_value}
                          target="_blank"
                          rel="noreferrer"
                          className="truncate font-mono text-ui-fg-base underline-offset-2 hover:underline"
                          style={{ maxWidth: "26ch" }}
                          onClick={(e) => e.stopPropagation()}
                          title={r.dimension_value}
                        >
                          {r.dimension_value.replace(
                            /^https?:\/\/[^/]+/,
                            "",
                          ) || "/"}
                        </a>
                      ) : (
                        <span
                          className={
                            type === "query"
                              ? "font-mono text-ui-fg-base"
                              : "text-ui-fg-base"
                          }
                          title={r.dimension_value}
                        >
                          {formatDimValue(type, r.dimension_value)}
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="px-3 py-2 text-right font-mono">
                    {clicks.toLocaleString()}
                  </td>
                  <td className="px-3 py-2 text-right font-mono text-ui-fg-muted">
                    {totalImps > 0 ? `${sharePct.toFixed(0)}%` : "—"}
                  </td>
                  <td className="px-3 py-2 text-right font-mono">
                    {imps.toLocaleString()}
                  </td>
                  <td className="px-3 py-2 text-right font-mono">
                    {imps > 0 ? `${(ctr * 100).toFixed(2)}%` : "—"}
                  </td>
                  <td className="px-3 py-2 text-right font-mono">
                    {pos > 0 ? pos.toFixed(1) : "—"}
                  </td>
                </tr>
                {isExpanded && renderExpanded && (
                  <tr className="border-t border-ui-border-base bg-ui-bg-subtle">
                    <td colSpan={6} className="px-3 py-3">
                      {renderExpanded(r.dimension_value)}
                    </td>
                  </tr>
                )}
              </React.Fragment>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

/**
 * Inline rank-trend chart that pops open under an expanded query row.
 * Three sparkline series stacked: clicks, impressions, position.
 *
 * Fetches on demand (when the row is expanded) so the page load
 * stays cheap — typical user will only open one or two queries.
 */
const QueryTrendPanel: React.FC<{ query: string }> = ({ query }) => {
  const [rows, setRows] = useState<QueryHistoryRow[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    loadQueryTrend(query)
      .then((r) => {
        if (!cancelled) setRows(r)
      })
      .catch((err) => {
        if (!cancelled) setError((err as Error).message)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [query])

  if (loading) {
    return (
      <Text size="xsmall" className="text-ui-fg-muted">
        Loading trend for &ldquo;{query}&rdquo;…
      </Text>
    )
  }
  if (error) {
    return (
      <Text size="xsmall" className="text-ui-tag-red-text">
        {error}
      </Text>
    )
  }
  if (rows.length === 0) {
    return (
      <Text size="xsmall" className="text-ui-fg-muted">
        No history yet for &ldquo;{query}&rdquo; — the query history
        ingest runs daily; the row will populate on the next 00:30 UTC
        tick or via a manual fire on the Submit tab.
      </Text>
    )
  }

  const toPoints = (key: "clicks" | "impressions" | "position") =>
    rows
      .map((r) => ({
        date: new Date(r.date),
        value: Number(r[key]) || 0,
      }))
      .filter((p) => Number.isFinite(p.value))
      .sort((a, b) => a.date.getTime() - b.date.getTime())

  const clicksSeries: Series = {
    label: "Clicks",
    metric_type: "clicks",
    rows: toPoints("clicks"),
    format: fmtInt,
    hint: `Daily clicks for "${query}".`,
  }
  const impsSeries: Series = {
    label: "Impressions",
    metric_type: "impressions",
    rows: toPoints("impressions"),
    format: fmtInt,
    hint: `Daily impressions for "${query}".`,
  }
  const posSeries: Series = {
    label: "Rank position",
    metric_type: "position",
    rows: toPoints("position"),
    format: fmtPos,
    hint: `Daily rank for "${query}". Lower is better.`,
    inverted: true,
  }

  return (
    <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
      <ChartCard series={clicksSeries} />
      <ChartCard series={impsSeries} />
      <ChartCard series={posSeries} />
    </div>
  )
}

const MetricsTab: React.FC = () => {
  const [daysBack, setDaysBack] = useState(30)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [gsc, setGsc] = useState<Series[]>([])
  const [bing, setBing] = useState<Series[]>([])
  const [indexed, setIndexed] = useState<{ value: number; date: Date } | null>(
    null,
  )
  // Top-N rollups per dimension. Replaced wholesale on every refresh.
  const [topQueries, setTopQueries] = useState<DimensionRow[]>([])
  const [topPages, setTopPages] = useState<DimensionRow[]>([])
  const [countries, setCountries] = useState<DimensionRow[]>([])
  const [devices, setDevices] = useState<DimensionRow[]>([])
  const [yandexQueries, setYandexQueries] = useState<DimensionRow[]>([])
  // Which query row has its rank-trend panel expanded ("" = none).
  const [expandedQuery, setExpandedQuery] = useState<string>("")

  const refresh = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [
        gscClicks,
        gscImps,
        gscCtr,
        gscPos,
        gscIndexed,
        bingClicks,
        bingImps,
        bingCrawled,
        bingErr4xx,
        queriesRows,
        pagesRows,
        countriesRows,
        devicesRows,
        yandexQueryRows,
      ] = await Promise.all([
        loadSeries("gsc", "clicks", daysBack),
        loadSeries("gsc", "impressions", daysBack),
        loadSeries("gsc", "ctr", daysBack),
        loadSeries("gsc", "avg_position", daysBack),
        loadSeries("gsc", "indexed_surfaced", 365),
        loadSeries("bing", "clicks", daysBack),
        loadSeries("bing", "impressions", daysBack),
        loadSeries("bing", "crawled_pages", daysBack),
        loadSeries("bing", "crawl_errors_4xx", daysBack),
        loadDimension("query", 50),
        loadDimension("page", 25),
        loadDimension("country", 20),
        loadDimension("device", 5),
        loadDimension("query", 25, "yandex"),
      ])
      setGsc([
        toSeries(
          "Impressions",
          "impressions",
          gscImps,
          fmtInt,
          "Times your site appeared in Google results.",
        ),
        toSeries(
          "Clicks",
          "clicks",
          gscClicks,
          fmtInt,
          "Times a user clicked through from Google.",
        ),
        toSeries(
          "CTR",
          "ctr",
          gscCtr,
          fmtPct,
          "Click-through rate (clicks ÷ impressions).",
        ),
        toSeries(
          "Average position",
          "avg_position",
          gscPos,
          fmtPos,
          "Mean SERP rank across queries. Lower is better.",
          true,
        ),
      ])
      setBing([
        toSeries(
          "Impressions",
          "impressions",
          bingImps,
          fmtInt,
          "Times your site appeared in Bing results.",
        ),
        toSeries(
          "Clicks",
          "clicks",
          bingClicks,
          fmtInt,
          "Bing click-throughs.",
        ),
        toSeries(
          "Pages crawled",
          "crawled_pages",
          bingCrawled,
          fmtInt,
          "URLs Bingbot fetched in the period.",
        ),
        toSeries(
          "4xx crawl errors",
          "crawl_errors_4xx",
          bingErr4xx,
          fmtInt,
          "URLs returning a 4xx to Bingbot.",
          true,
        ),
      ])
      if (gscIndexed.length) {
        const sorted = [...gscIndexed].sort(
          (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime(),
        )
        setIndexed({
          value: Number(sorted[0].value),
          date: new Date(sorted[0].date),
        })
      } else {
        setIndexed(null)
      }
      setTopQueries(queriesRows)
      setTopPages(pagesRows)
      setCountries(countriesRows)
      setDevices(devicesRows)
      setYandexQueries(yandexQueryRows)
    } catch (err) {
      setError((err as Error).message ?? "load failed")
    } finally {
      setLoading(false)
    }
  }, [daysBack])

  useEffect(() => {
    refresh()
  }, [refresh])

  const bingEmpty = useMemo(
    () => bing.every((s) => s.rows.length === 0),
    [bing],
  )

  return (
    <section className="flex flex-col gap-6">
      {/* Header */}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <Heading level="h2">Search metrics</Heading>
          <Text size="small" className="text-ui-fg-muted">
            Daily snapshots from Google Search Console and Bing Webmaster.
            Refreshed by the 00:30 UTC ingest cron — back-fills the most
            recent {daysBack} days on each run, so a missed day repairs
            itself the next morning.
          </Text>
        </div>
        <div className="flex items-center gap-2">
          {RANGE_OPTIONS.map((opt) => (
            <Button
              key={opt.days}
              variant={opt.days === daysBack ? "primary" : "secondary"}
              size="small"
              onClick={() => setDaysBack(opt.days)}
              disabled={loading}
            >
              {opt.label}
            </Button>
          ))}
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

      {/* Google Search Console */}
      <div className="flex flex-col gap-3">
        <div className="flex items-baseline justify-between">
          <Heading level="h3">Google Search Console</Heading>
          {indexed && (
            <Text size="small" className="text-ui-fg-muted">
              Indexed surfaces:{" "}
              <span className="font-mono text-ui-fg-base">
                {fmtInt(indexed.value)}
              </span>{" "}
              · as of {indexed.date.toISOString().slice(0, 10)}
            </Text>
          )}
        </div>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          {gsc.map((s) => (
            <ChartCard key={s.metric_type} series={s} />
          ))}
        </div>
      </div>

      {/* Top queries — clickable rows reveal per-query rank trend */}
      <div className="flex flex-col gap-3">
        <div className="flex items-baseline justify-between gap-3">
          <Heading level="h3">Top queries (28-day rollup)</Heading>
          <Text size="xsmall" className="text-ui-fg-muted">
            Click a row to see its rank trend over the last 90 days.
          </Text>
        </div>
        <DimensionTable
          rows={topQueries}
          type="query"
          expandable
          expandedKey={expandedQuery}
          onExpand={setExpandedQuery}
          renderExpanded={(value) => <QueryTrendPanel query={value} />}
          emptyHint="No query rollup yet. Run a manual ingest on the Submit tab or wait for the 00:30 UTC cron."
        />
      </div>

      {/* Top landing pages */}
      <div className="flex flex-col gap-3">
        <Heading level="h3">Top landing pages (28-day rollup)</Heading>
        <DimensionTable
          rows={topPages}
          type="page"
          emptyHint="No page rollup yet."
        />
      </div>

      {/* Country + device side by side */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <div className="flex flex-col gap-3">
          <Heading level="h3">By country</Heading>
          <DimensionTable
            rows={countries}
            type="country"
            emptyHint="No country rollup yet."
          />
        </div>
        <div className="flex flex-col gap-3">
          <Heading level="h3">By device</Heading>
          <DimensionTable
            rows={devices}
            type="device"
            emptyHint="No device rollup yet."
          />
        </div>
      </div>

      {/* Core Web Vitals (Phase 12) */}
      <CwvPanel />

      {/* Bing Webmaster */}
      <div className="flex flex-col gap-3">
        <Heading level="h3">Bing Webmaster</Heading>
        {bingEmpty ? (
          <div className="rounded-md border border-dashed border-ui-border-base p-6">
            <Text size="small" className="text-ui-fg-base">
              No Bing data has appeared yet.
            </Text>
            <Text size="xsmall" className="mt-2 text-ui-fg-muted">
              The cron does call Bing every night — all endpoints return
              an empty result set (<code className="font-mono">{`{"d":[]}`}</code>).
              Diagnosis verified on the most recent run:
              <ul className="ml-5 mt-2 list-disc">
                <li>API key works — auth returns 200 on every endpoint.</li>
                <li>
                  Site URL is registered — Bing accepts both{" "}
                  <code className="font-mono">https://your-domain.example/</code> and
                  the bare-domain variant.
                </li>
                <li>
                  Bing simply has not accumulated traffic + crawl data
                  yet. For a newly-verified site the wait is typically
                  1-4 weeks. Re-running the ingest manually doesn't
                  help — only Bingbot's own crawl + impression
                  accumulation will.
                </li>
              </ul>
              The cron will keep trying every morning at 00:30 UTC; this
              card flips to populated charts the moment Bing returns
              any row.
            </Text>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            {bing.map((s) => (
              <ChartCard key={s.metric_type} series={s} />
            ))}
          </div>
        )}
      </div>

      {/* Yandex top queries (Phase 12.C) */}
      <div className="flex flex-col gap-3">
        <Heading level="h3">Yandex top queries</Heading>
        {yandexQueries.length === 0 ? (
          <div className="rounded-md border border-dashed border-ui-border-base p-6">
            <Text size="small" className="text-ui-fg-base">
              No Yandex query rollup yet.
            </Text>
            <Text size="xsmall" className="mt-2 text-ui-fg-muted">
              Paste a Yandex OAuth token in the Submit-tab Integrations card,
              then wait for the next 00:30 UTC cron (or hit "Run ingest now" on
              the same card). Fresh Yandex verifications need a 1-2 week warmup
              before the popular-queries endpoint returns data.
            </Text>
          </div>
        ) : (
          <DimensionTable
            rows={yandexQueries}
            type="query"
            emptyHint="No Yandex query data."
          />
        )}
      </div>
    </section>
  )
}

export default MetricsTab
