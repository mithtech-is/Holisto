import React, { useCallback, useEffect, useMemo, useState } from "react"
import {
  Badge,
  Button,
  Heading,
  Input,
  Text,
  toast,
  Tooltip,
} from "@medusajs/ui"
// @medusajs/icons exposes a deliberately small set — some Heroicons we'd
// normally reach for (ExternalLink, ArrowsUpDown, plain ArrowUp) don't
// exist here, so we pick the closest semantic match: ArrowUpRightOnBox
// reads as "open in new tab", ArrowUpDown as "sortable column", etc.
import {
  ArrowUpRightOnBox,
  ArrowDownMini,
  ArrowUpMini,
  ArrowUpDown,
  ArrowDownTray,
  ArrowPathMini,
  CodeMerge,
  ChevronRight,
  ChevronDown,
} from "@medusajs/icons"
import {
  ISSUE_DOCS,
  resolveStorefrontSource,
  externalValidatorLinks,
  severityTone,
  type IssueDoc,
} from "./audit-meta"
import { useDebouncedValue } from "./useDebouncedValue"

/**
 * Audit tab v2 for `/app/ovo?tab=audit`.
 *
 * Built on top of v1's per-URL `ovo_seo_audit` table; adds:
 *
 *   - Audit-health trend mini-chart (last 30 runs, healthy/warn/error
 *     stacked) so operators see whether their fixes are working over
 *     time.
 *   - Top-issues panel — clickable chips that filter the table down
 *     to URLs with that issue code.
 *   - Sortable table columns (issue count, response time, words).
 *   - Per-row action buttons:
 *       Re-audit  →  POST /admin/ovo/seo/audit/url  (single URL)
 *       Open      →  open live URL in a new tab
 *       Source    →  show the resolved storefront source-file path
 *       Validators →  Google Rich Results / PageSpeed / etc.
 *   - "What's exactly wrong" — each finding row shows the extracted
 *     value (title text, canonical URL, jsonld types, etc.) plus a
 *     concise fix recipe sourced from the shared `ISSUE_DOCS` map.
 *   - CSV export of the full findings set for stakeholder reports.
 *
 * Most of this is read-only against the existing DB — the only new
 * mutation is the single-URL re-audit. No new tables beyond
 * `ovo_seo_audit_run` (for the trend chart history).
 */

type AuditFinding = {
  severity: "error" | "warn"
  code: string
  message: string
}

type AuditRow = {
  id: string
  url: string
  audited_at: string
  status_code: number
  response_time_ms: number
  title: string | null
  title_length: number
  meta_description: string | null
  meta_description_length: number
  canonical_url: string | null
  canonical_ok: boolean
  h1_count: number
  h1_text: string | null
  h2_count: number
  h3_count: number
  image_count: number
  image_missing_alt_count: number
  images_missing_dim_count: number
  jsonld_count: number
  jsonld_invalid_count: number
  jsonld_types: string[] | null
  word_count: number
  has_og_title: boolean
  has_og_image: boolean
  has_twitter_card: boolean
  is_https: boolean
  has_viewport: boolean
  has_lang: boolean
  robots_noindex: boolean
  response_bytes: number
  external_script_count: number
  internal_link_count: number
  external_link_count: number
  quality_score: number
  target_keywords_match:
    | Array<{ keyword: string; in_title: boolean; in_h1: boolean; in_body: boolean }>
    | null
  issues: AuditFinding[]
  raw_html_sample: string | null
}

type AuditSummary = {
  total: number
  healthy: number
  warn: number
  error: number
  last_run_at: string | null
}

type AuditRun = {
  id: string
  started_at: string
  duration_ms: number
  urls_total: number
  urls_error: number
  urls_warn: number
  urls_healthy: number
  trigger: string
  issues_by_code: Record<string, number> | null
}

type SortKey = "url" | "issues" | "response" | "words" | "status" | "score"
type SortDir = "asc" | "desc"

const AUDIT_API = "/admin/ovo/seo/audit"
const AUDIT_URL_API = "/admin/ovo/seo/audit/url"
const AUDIT_RUNS_API = "/admin/ovo/seo/audit/runs"

/* ── data layer ───────────────────────────────────────────────────── */

async function loadAudit(opts: {
  severity: "error" | "warn" | "all"
  search: string
}): Promise<{ rows: AuditRow[]; summary: AuditSummary }> {
  const qs = new URLSearchParams()
  if (opts.severity !== "all") qs.set("severity", opts.severity)
  if (opts.search.trim()) qs.set("search", opts.search.trim())
  qs.set("limit", "1000")
  const r = await fetch(`${AUDIT_API}?${qs.toString()}`, {
    credentials: "include",
  })
  if (!r.ok) {
    const e = (await r.json().catch(() => ({}))) as { message?: string }
    throw new Error(e.message || `Audit load failed (${r.status})`)
  }
  return (await r.json()) as { rows: AuditRow[]; summary: AuditSummary }
}

async function runAuditFull(): Promise<{
  audited: number
  error_urls: number
  warn_urls: number
}> {
  const r = await fetch(AUDIT_API, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: "{}",
  })
  if (!r.ok) {
    const e = (await r.json().catch(() => ({}))) as { message?: string }
    throw new Error(e.message || `Audit run failed (${r.status})`)
  }
  return (await r.json()) as {
    audited: number
    error_urls: number
    warn_urls: number
  }
}

async function runAuditOne(url: string): Promise<{
  url: string
  status_code: number
  findings: AuditFinding[]
}> {
  const r = await fetch(AUDIT_URL_API, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url }),
  })
  if (!r.ok) {
    const e = (await r.json().catch(() => ({}))) as { message?: string }
    throw new Error(e.message || `Single-URL audit failed (${r.status})`)
  }
  return (await r.json()) as {
    url: string
    status_code: number
    findings: AuditFinding[]
  }
}

async function loadAuditRuns(limit = 30): Promise<AuditRun[]> {
  const r = await fetch(`${AUDIT_RUNS_API}?limit=${limit}`, {
    credentials: "include",
  })
  if (!r.ok) throw new Error(`Run history load failed (${r.status})`)
  const json = (await r.json()) as { rows: AuditRun[] }
  return json.rows
}

/* ── small helpers ────────────────────────────────────────────────── */

const issueDotClass = (sev: "error" | "warn"): string =>
  sev === "error" ? "bg-ui-tag-red-icon" : "bg-ui-tag-orange-icon"

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
  const s = Math.round(diff / 1000)
  if (s < 60) return `${s}s ago`
  const m = Math.round(s / 60)
  if (m < 60) return `${m}m ago`
  const h = Math.round(m / 60)
  if (h < 24) return `${h}h ago`
  const d = Math.round(h / 24)
  return `${d}d ago`
}

const downloadCsv = (rows: AuditRow[]) => {
  const cols = [
    "url",
    "status_code",
    "response_time_ms",
    "title",
    "title_length",
    "meta_description_length",
    "canonical_ok",
    "h1_count",
    "image_missing_alt_count",
    "jsonld_invalid_count",
    "word_count",
    "issue_count",
    "error_count",
    "warn_count",
    "issue_codes",
  ]
  const esc = (v: unknown): string => {
    const s = v == null ? "" : String(v)
    if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`
    return s
  }
  const lines = [cols.join(",")]
  for (const r of rows) {
    const errC = r.issues.filter((f) => f.severity === "error").length
    const warnC = r.issues.filter((f) => f.severity === "warn").length
    lines.push(
      [
        esc(r.url),
        esc(r.status_code),
        esc(r.response_time_ms),
        esc(r.title ?? ""),
        esc(r.title_length),
        esc(r.meta_description_length),
        esc(r.canonical_ok ? "yes" : "no"),
        esc(r.h1_count),
        esc(r.image_missing_alt_count),
        esc(r.jsonld_invalid_count),
        esc(r.word_count),
        esc(r.issues.length),
        esc(errC),
        esc(warnC),
        esc(r.issues.map((i) => i.code).join("; ")),
      ].join(","),
    )
  }
  const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8" })
  const url = URL.createObjectURL(blob)
  const a = document.createElement("a")
  a.href = url
  a.download = `ovo-seo-audit-${new Date()
    .toISOString()
    .slice(0, 19)
    .replace(/:/g, "")}.csv`
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

/* ── sub-components ───────────────────────────────────────────────── */

/**
 * Color-banded badge for the 0-100 page quality score.
 *   >= 90  green   "great"
 *   70-89  green   "good"
 *   50-69  orange  "fair"
 *   < 50   red     "poor"
 */
/**
 * Average-score summary card. Computes the mean of every row's
 * `quality_score` and renders it as a big number + color-banded
 * badge. Falls back to "—" when there are no rows.
 */
const AvgScoreCard: React.FC<{ rows: AuditRow[] }> = ({ rows }) => {
  const avg = useMemo(() => {
    if (!rows.length) return null
    const sum = rows.reduce((s, r) => s + (r.quality_score ?? 100), 0)
    return Math.round(sum / rows.length)
  }, [rows])
  const tone: "green" | "orange" | "red" | "grey" =
    avg == null ? "grey" : avg >= 70 ? "green" : avg >= 50 ? "orange" : "red"
  return (
    <div className="flex-1 rounded-md border border-ui-border-base p-4">
      <Text size="xsmall" className="text-ui-fg-muted">
        Avg quality score
      </Text>
      <div className="mt-1 flex items-baseline gap-2">
        <Heading level="h3" className="font-mono">
          {avg ?? "—"}
        </Heading>
        {avg != null && (
          <Badge color={tone === "grey" ? "grey" : tone} size="2xsmall">
            /100
          </Badge>
        )}
      </div>
    </div>
  )
}

const QualityScoreBadge: React.FC<{ score: number }> = ({ score }) => {
  const tone: "green" | "orange" | "red" =
    score >= 70 ? "green" : score >= 50 ? "orange" : "red"
  return (
    <Badge color={tone} size="2xsmall">
      <span className="font-mono">{score}</span>
    </Badge>
  )
}

const SummaryCard: React.FC<{
  label: string
  value: number
  tone: "green" | "orange" | "red" | "grey"
  total: number
}> = ({ label, value, tone, total }) => {
  const pct = total > 0 ? Math.round((value / total) * 100) : 0
  return (
    <div className="flex-1 rounded-md border border-ui-border-base p-4">
      <Text size="xsmall" className="text-ui-fg-muted">
        {label}
      </Text>
      <div className="mt-1 flex items-baseline gap-2">
        <Heading level="h3" className="font-mono">
          {value}
        </Heading>
        <Badge color={tone === "grey" ? "grey" : tone} size="2xsmall">
          {pct}%
        </Badge>
      </div>
    </div>
  )
}

/**
 * Stacked-bar mini-chart of the last N audit runs. Each bar is one
 * run; vertical stack is healthy (green) / warn (orange) / error
 * (red). Width auto-scales; bars are ~12 px each.
 */
const RunHistoryChart: React.FC<{ runs: AuditRun[] }> = ({ runs }) => {
  if (!runs.length) {
    return (
      <div className="rounded-md border border-dashed border-ui-border-base p-4 text-center">
        <Text size="xsmall" className="text-ui-fg-muted">
          No audit history yet. The first run lands the moment you press
          “Run audit now” or after the 01:30 UTC cron fires.
        </Text>
      </div>
    )
  }
  // Render oldest → newest so the rightmost bar is the latest.
  const ordered = [...runs].reverse()
  const W = Math.max(ordered.length * 18, 200)
  const H = 80
  const padT = 6
  const padB = 16
  const padL = 28
  const maxTotal = Math.max(...ordered.map((r) => r.urls_total), 1)
  const barW = (W - padL) / ordered.length

  return (
    <div className="overflow-x-auto rounded-md border border-ui-border-base p-3">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" preserveAspectRatio="none">
        {/* Y axis labels */}
        <text x={4} y={padT + 6} className="fill-ui-fg-muted" fontSize="9">
          {maxTotal}
        </text>
        <text
          x={4}
          y={H - padB + 4}
          className="fill-ui-fg-muted"
          fontSize="9"
        >
          0
        </text>
        {ordered.map((r, i) => {
          const x = padL + i * barW
          const total = r.urls_total || 1
          const scale = (H - padT - padB) / maxTotal
          const errH = r.urls_error * scale
          const warnH = r.urls_warn * scale
          const okH = r.urls_healthy * scale
          let y = H - padB
          const errY = (y -= errH)
          const warnY = (y -= warnH)
          const okY = (y -= okH)
          const dateLabel = new Date(r.started_at)
            .toISOString()
            .slice(5, 10)
          return (
            <g key={r.id}>
              <rect
                x={x + 1}
                y={errY}
                width={barW - 2}
                height={errH}
                className="fill-ui-tag-red-icon"
              >
                <title>
                  {dateLabel}: {r.urls_error} errors
                </title>
              </rect>
              <rect
                x={x + 1}
                y={warnY}
                width={barW - 2}
                height={warnH}
                className="fill-ui-tag-orange-icon"
              >
                <title>
                  {dateLabel}: {r.urls_warn} warns
                </title>
              </rect>
              <rect
                x={x + 1}
                y={okY}
                width={barW - 2}
                height={okH}
                className="fill-ui-tag-green-icon"
              >
                <title>
                  {dateLabel}: {r.urls_healthy} healthy / {total} total
                </title>
              </rect>
              {/* x-axis label every 5 bars (or first/last) */}
              {(i === 0 || i === ordered.length - 1 || i % 5 === 0) && (
                <text
                  x={x + barW / 2}
                  y={H - 4}
                  textAnchor="middle"
                  className="fill-ui-fg-muted"
                  fontSize="8"
                >
                  {dateLabel}
                </text>
              )}
            </g>
          )
        })}
      </svg>
    </div>
  )
}

/**
 * Top-issues panel. Aggregates the current snapshot into a horizontal
 * chip strip ordered by URL-count. Clicking a chip filters the table
 * to URLs that have that issue.
 */
const TopIssuesPanel: React.FC<{
  rows: AuditRow[]
  activeCode: string
  onCodeClick: (code: string) => void
}> = ({ rows, activeCode, onCodeClick }) => {
  const counts = useMemo(() => {
    const c: Record<string, { count: number; severity: "error" | "warn" }> = {}
    for (const r of rows) {
      for (const f of r.issues) {
        if (!c[f.code]) c[f.code] = { count: 0, severity: f.severity }
        c[f.code].count += 1
      }
    }
    return Object.entries(c)
      .map(([code, v]) => ({ code, ...v }))
      .sort((a, b) => b.count - a.count)
  }, [rows])

  if (!counts.length) return null

  return (
    <div className="rounded-md border border-ui-border-base p-3">
      <div className="mb-2 flex items-center justify-between">
        <Text size="xsmall" className="text-ui-fg-muted">
          Top issues across the audited URL set (click a chip to filter)
        </Text>
        {activeCode && (
          <Button
            variant="transparent"
            size="small"
            onClick={() => onCodeClick("")}
          >
            Clear filter
          </Button>
        )}
      </div>
      <div className="flex flex-wrap gap-2">
        {counts.map((c) => {
          const active = c.code === activeCode
          return (
            <button
              key={c.code}
              onClick={() => onCodeClick(active ? "" : c.code)}
              className={
                "flex items-center gap-1.5 rounded-full border px-3 py-1 text-[11px] transition-colors " +
                (active
                  ? "border-ui-fg-base bg-ui-bg-base-hover"
                  : "border-ui-border-base bg-ui-bg-subtle hover:bg-ui-bg-base-hover")
              }
            >
              <span
                className={`h-2 w-2 rounded-full ${issueDotClass(c.severity)}`}
              />
              <span className="font-mono">{c.code.replace(/_/g, " ")}</span>
              <span className="rounded-full bg-ui-bg-base px-1.5 font-mono text-ui-fg-muted">
                {c.count}
              </span>
            </button>
          )
        })}
      </div>
    </div>
  )
}

const TruncUrl: React.FC<{ url: string }> = ({ url }) => (
  <a
    href={url}
    target="_blank"
    rel="noreferrer"
    className="font-mono text-ui-fg-base underline-offset-2 hover:underline"
    title={url}
    onClick={(e) => e.stopPropagation()}
  >
    {cleanPath(url) || "/"}
  </a>
)

const FindingChip: React.FC<{ finding: AuditFinding }> = ({ finding }) => (
  <span
    className={
      "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] " +
      (finding.severity === "error"
        ? "border-ui-tag-red-border bg-ui-tag-red-bg text-ui-tag-red-text"
        : "border-ui-tag-orange-border bg-ui-tag-orange-bg text-ui-tag-orange-text")
    }
    title={finding.message}
  >
    <span className={`h-1.5 w-1.5 rounded-full ${issueDotClass(finding.severity)}`} />
    {finding.code.replace(/_/g, " ")}
  </span>
)

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
    <Text size="xsmall" className="break-words text-ui-fg-base">
      {value ?? "—"}
    </Text>
  </div>
)

/**
 * Per-finding block on the expanded row. Shows the code, the exact
 * extracted value that triggered it (e.g. the actual 105-char title),
 * the human meaning, and the fix recipe.
 */
const FindingDetail: React.FC<{
  finding: AuditFinding
  row: AuditRow
}> = ({ finding, row }) => {
  const doc: IssueDoc | undefined = ISSUE_DOCS[finding.code]
  // Resolve the "exact extracted value" most relevant to this finding.
  let extracted: { label: string; value: string | null; extra?: string } | null =
    null
  switch (finding.code) {
    case "title_short":
    case "title_long":
    case "title_too_long":
    case "title_missing":
      extracted = {
        label: "Current title",
        value: row.title,
        extra: `${row.title_length} chars`,
      }
      break
    case "meta_description_missing":
    case "meta_description_short":
    case "meta_description_long":
      extracted = {
        label: "Current description",
        value: row.meta_description,
        extra: `${row.meta_description_length} chars`,
      }
      break
    case "canonical_missing":
    case "canonical_mismatch":
      extracted = {
        label: "Canonical URL",
        value: row.canonical_url,
        extra: row.canonical_ok ? "matches" : "mismatch",
      }
      break
    case "h1_missing":
    case "h1_multiple":
      extracted = {
        label: "H1 text",
        value: row.h1_text,
        extra: `${row.h1_count} found`,
      }
      break
    case "img_missing_alt":
      extracted = {
        label: "Image alt coverage",
        value: `${row.image_missing_alt_count} missing of ${row.image_count} total`,
      }
      break
    case "jsonld_invalid":
      extracted = {
        label: "JSON-LD blocks",
        value:
          row.jsonld_types && row.jsonld_types.length
            ? row.jsonld_types.join(", ")
            : "(none parsed)",
        extra: `${row.jsonld_invalid_count} invalid of ${row.jsonld_count}`,
      }
      break
    case "thin_content":
      extracted = {
        label: "Visible word count",
        value: String(row.word_count),
      }
      break
    case "non_2xx":
    case "fetch_failed":
    case "slow_response":
      extracted = {
        label: "Response",
        value: `HTTP ${row.status_code} · ${row.response_time_ms} ms`,
      }
      break
  }

  return (
    <div
      className={
        "flex flex-col gap-2 rounded-md border p-3 text-xs " +
        (finding.severity === "error"
          ? "border-ui-tag-red-border bg-ui-tag-red-bg"
          : "border-ui-tag-orange-border bg-ui-tag-orange-bg")
      }
    >
      <div className="flex items-baseline justify-between gap-2">
        <Text
          size="xsmall"
          weight="plus"
          className={
            finding.severity === "error"
              ? "text-ui-tag-red-text"
              : "text-ui-tag-orange-text"
          }
        >
          {finding.code.replace(/_/g, " ")}
        </Text>
        {doc?.learn && (
          <a
            href={doc.learn}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 text-ui-fg-muted hover:text-ui-fg-base"
          >
            Learn more <ArrowUpRightOnBox className="h-3 w-3" />
          </a>
        )}
      </div>
      <Text size="xsmall" className="text-ui-fg-base">
        {finding.message}
      </Text>
      {extracted && (
        <div className="rounded border border-ui-border-base bg-ui-bg-base p-2">
          <Text size="xsmall" className="text-ui-fg-muted">
            {extracted.label}
            {extracted.extra ? (
              <span className="ml-2 font-mono">({extracted.extra})</span>
            ) : null}
          </Text>
          <Text
            size="xsmall"
            className="break-words font-mono text-ui-fg-base"
          >
            {extracted.value ?? "(not present)"}
          </Text>
        </div>
      )}
      {doc && (
        <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
          <div>
            <Text size="xsmall" className="text-ui-fg-muted">
              Why it matters
            </Text>
            <Text size="xsmall" className="text-ui-fg-base">
              {doc.why}
            </Text>
          </div>
          <div>
            <Text size="xsmall" className="text-ui-fg-muted">
              Fix
            </Text>
            <Text size="xsmall" className="text-ui-fg-base">
              {doc.fix}
            </Text>
          </div>
        </div>
      )}
    </div>
  )
}

/**
 * Expanded row block — list of finding details + source-file link +
 * external validator links + raw HTML sample (collapsed).
 */
const ExpandedDetails: React.FC<{
  row: AuditRow
  onReaudit: (url: string) => Promise<void>
  isReauditing: boolean
}> = ({ row, onReaudit, isReauditing }) => {
  const source = resolveStorefrontSource(row.url)
  const validators = externalValidatorLinks(row.url)
  const [copied, setCopied] = useState(false)
  const [showHtml, setShowHtml] = useState(false)

  const copyPath = async () => {
    try {
      await navigator.clipboard.writeText(source.path)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      /* noop */
    }
  }

  return (
    <div className="flex flex-col gap-3 rounded-md bg-ui-bg-subtle p-3 text-xs">
      {/* Action bar */}
      <div className="flex flex-wrap items-center gap-2">
        <Button
          variant="primary"
          size="small"
          onClick={() => onReaudit(row.url)}
          isLoading={isReauditing}
          disabled={isReauditing}
        >
          <ArrowPathMini className="mr-1 h-3 w-3" />
          Re-audit
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
        <Tooltip
          content={
            source.isDynamic
              ? "Resolved to the dynamic route's template; the dynamic segment is filled at runtime."
              : "Click to copy the source path"
          }
        >
          <button
            onClick={copyPath}
            className="inline-flex items-center gap-1 rounded-md border border-ui-border-base bg-ui-bg-base px-3 py-1.5 font-mono text-[11px] text-ui-fg-base hover:bg-ui-bg-base-hover"
          >
            <CodeMerge className="h-3 w-3" />
            {copied ? "copied!" : source.path}
            {source.isDynamic && (
              <span className="ml-1 rounded bg-ui-bg-subtle px-1 text-ui-fg-muted">
                dynamic
              </span>
            )}
          </button>
        </Tooltip>
      </div>

      {/* Validators */}
      <div className="flex flex-wrap items-center gap-2">
        <Text size="xsmall" className="text-ui-fg-muted">
          Open in:
        </Text>
        {validators.map((v) => (
          <Tooltip key={v.label} content={v.hint}>
            <a
              href={v.href}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 rounded-full border border-ui-border-base bg-ui-bg-base px-3 py-1 text-[11px] text-ui-fg-base hover:bg-ui-bg-base-hover"
            >
              {v.label}
              <ArrowUpRightOnBox className="h-2.5 w-2.5" />
            </a>
          </Tooltip>
        ))}
      </div>

      {/* Findings — what's exactly wrong */}
      {row.issues.length === 0 ? (
        <div className="rounded-md border border-dashed border-ui-tag-green-border bg-ui-tag-green-bg p-3 text-center">
          <Text size="xsmall" className="text-ui-tag-green-text">
            No findings. Page passes every check.
          </Text>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
          {row.issues.map((f, i) => (
            <FindingDetail
              key={`${row.id}-finding-${i}`}
              finding={f}
              row={row}
            />
          ))}
        </div>
      )}

      {/* Target keywords + presence matrix */}
      {row.target_keywords_match && row.target_keywords_match.length > 0 && (
        <div className="flex flex-col gap-2 rounded-md border border-ui-border-base bg-ui-bg-base p-3">
          <Text size="xsmall" weight="plus" className="text-ui-fg-base">
            Target keywords for this URL
          </Text>
          <table className="text-[11px]">
            <thead className="text-ui-fg-muted">
              <tr>
                <th className="px-2 py-1 text-left">Keyword</th>
                <th className="px-2 py-1 text-center">In title</th>
                <th className="px-2 py-1 text-center">In h1</th>
                <th className="px-2 py-1 text-center">In body</th>
              </tr>
            </thead>
            <tbody>
              {row.target_keywords_match.map((t, i) => (
                <tr
                  key={`${row.id}-kw-${i}`}
                  className="border-t border-ui-border-base"
                >
                  <td className="px-2 py-1 font-mono text-ui-fg-base">
                    {t.keyword}
                  </td>
                  <td className="px-2 py-1 text-center">
                    {t.in_title ? "✓" : "✗"}
                  </td>
                  <td className="px-2 py-1 text-center">
                    {t.in_h1 ? "✓" : "✗"}
                  </td>
                  <td className="px-2 py-1 text-center">
                    {t.in_body ? "✓" : "✗"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <Text size="xsmall" className="text-ui-fg-muted">
            Add or edit targets in the Keywords tab. The audit re-checks
            each on every run.
          </Text>
        </div>
      )}

      {/* Page metadata snapshot — useful even when there are no findings */}
      <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
        <KV label="Title" value={row.title} extra={`${row.title_length} ch`} />
        <KV
          label="Meta description"
          value={row.meta_description}
          extra={`${row.meta_description_length} ch`}
        />
        <KV
          label="Canonical"
          value={row.canonical_url}
          extra={row.canonical_ok ? "matches" : "mismatch"}
        />
        <KV
          label="H1"
          value={row.h1_text}
          extra={`${row.h1_count} found`}
        />
        <KV
          label="JSON-LD types"
          value={
            row.jsonld_types && row.jsonld_types.length
              ? row.jsonld_types.join(", ")
              : "(none)"
          }
          extra={
            row.jsonld_invalid_count > 0
              ? `${row.jsonld_invalid_count} INVALID`
              : `${row.jsonld_count} valid`
          }
        />
        <KV
          label="OG / Twitter"
          value={[
            row.has_og_title ? "og:title" : null,
            row.has_og_image ? "og:image" : null,
            row.has_twitter_card ? "twitter:card" : null,
          ]
            .filter(Boolean)
            .join(", ") || "(none)"}
        />
        <KV
          label="Response"
          value={`${row.status_code} · ${row.response_time_ms} ms`}
        />
      </div>

      {/* Per-URL quality-score history (Phase 7.C) */}
      <PerUrlHistorySparkline url={row.url} />

      {/* Inline metadata override editor (Phase 8.B) */}
      <MetadataEditorPanel row={row} />

      {/* Image-alt AI suggestions (Phase 8.F) — only when there are gaps */}
      {row.image_missing_alt_count > 0 && (
        <ImageAltSuggesterPanel
          url={row.url}
          missingCount={row.image_missing_alt_count}
        />
      )}

      {/* Suggested incoming internal links (Phase 7.B) */}
      <LinkSuggestionsPanel url={row.url} />

      {/* Raw HTML sample (only for pages with findings) */}
      {row.raw_html_sample && (
        <details
          className="rounded-md border border-ui-border-base bg-ui-bg-base p-2"
          open={showHtml}
          onToggle={(e) => setShowHtml((e.target as HTMLDetailsElement).open)}
        >
          <summary className="cursor-pointer text-ui-fg-muted">
            Raw HTML sample (first 2 KB)
          </summary>
          <pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap break-words rounded bg-ui-bg-subtle p-2 text-[10px] text-ui-fg-base">
            {row.raw_html_sample}
          </pre>
        </details>
      )}
    </div>
  )
}

/* ── Regression alerts (Phase 7.C) ─────────────────────────────── */

type RegressionRow = {
  url: string
  current_score: number
  previous_score: number
  delta: number
  current_issues: number
  previous_issues: number
  captured_at: string
}

/**
 * Loads `/admin/ovo/seo/audit/regressions` and renders URLs whose
 * quality_score dropped ≥ 10 points in the last week. Mounted near
 * the top of the Audit tab so the operator's first signal is "did
 * anything break since yesterday?". Empty state = collapsed
 * unobtrusively.
 */
const RegressionsPanel: React.FC = () => {
  const [rows, setRows] = useState<RegressionRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    fetch("/admin/ovo/seo/audit/regressions?window_hours=168&min_delta=10", {
      credentials: "include",
    })
      .then(async (r) => {
        if (!r.ok) {
          const e = (await r.json().catch(() => ({}))) as { message?: string }
          throw new Error(e.message || `Regressions load failed (${r.status})`)
        }
        const json = (await r.json()) as { rows: RegressionRow[] }
        if (!cancelled) setRows(json.rows)
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
  }, [])

  if (loading || (rows.length === 0 && !error)) return null

  return (
    <div className="rounded-md border border-ui-tag-red-border bg-ui-tag-red-bg p-3">
      <div className="mb-2 flex items-baseline justify-between">
        <Text size="xsmall" weight="plus" className="text-ui-tag-red-text">
          Quality regressions (last 7 days)
        </Text>
        <Text size="xsmall" className="text-ui-fg-muted">
          score drop ≥ 10 points
        </Text>
      </div>
      {error ? (
        <Text size="xsmall" className="text-ui-tag-red-text">
          {error}
        </Text>
      ) : (
        <table className="w-full text-[11px]">
          <thead className="text-ui-fg-muted">
            <tr>
              <th className="px-2 py-1 text-left">URL</th>
              <th className="px-2 py-1 text-right">Was</th>
              <th className="px-2 py-1 text-right">Now</th>
              <th className="px-2 py-1 text-right">Δ</th>
              <th className="px-2 py-1 text-right">Issues</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const path = (() => {
                try {
                  const u = new URL(r.url)
                  return u.pathname + u.search
                } catch {
                  return r.url
                }
              })()
              return (
                <tr key={r.url} className="border-t border-ui-tag-red-border">
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
                  <td className="px-2 py-1 text-right font-mono">
                    {r.previous_score}
                  </td>
                  <td className="px-2 py-1 text-right font-mono">
                    {r.current_score}
                  </td>
                  <td className="px-2 py-1 text-right">
                    <Badge color="red" size="2xsmall">
                      {r.delta}
                    </Badge>
                  </td>
                  <td className="px-2 py-1 text-right font-mono">
                    {r.previous_issues} → {r.current_issues}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      )}
    </div>
  )
}

/* ── Per-URL history sparkline (Phase 7.C) ─────────────────────── */

type HistoryRow = {
  id: string
  url: string
  captured_at: string
  quality_score: number
  issue_count: number
  error_count: number
  warn_count: number
}

/**
 * Loads `/admin/ovo/seo/audit/history?url=...` and renders a tiny
 * sparkline of quality_score over the last 30 snapshots. Mounted in
 * `ExpandedDetails` so the operator can see "this URL's score went
 * 95 → 80 → 75 over the last week" at a glance.
 */
const PerUrlHistorySparkline: React.FC<{ url: string }> = ({ url }) => {
  const [rows, setRows] = useState<HistoryRow[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    fetch(`/admin/ovo/seo/audit/history?url=${encodeURIComponent(url)}`, {
      credentials: "include",
    })
      .then(async (r) => {
        if (!r.ok) return { rows: [] as HistoryRow[] }
        return (await r.json()) as { rows: HistoryRow[] }
      })
      .then((json) => {
        if (!cancelled) setRows(json.rows)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [url])

  if (loading) return null
  if (rows.length < 2) {
    return (
      <div className="rounded-md border border-dashed border-ui-border-base bg-ui-bg-base p-3">
        <Text size="xsmall" className="text-ui-fg-muted">
          Quality-score history will populate after the next audit run.
        </Text>
      </div>
    )
  }

  const W = 600
  const H = 80
  const padL = 28
  const padR = 8
  const padT = 8
  const padB = 18
  const xs = rows.map((_, i) => i)
  const ys = rows.map((r) => r.quality_score)
  const minY = Math.max(0, Math.min(...ys) - 5)
  const maxY = Math.min(100, Math.max(...ys) + 5)
  const ySpan = Math.max(1, maxY - minY)
  const x = (i: number) =>
    padL +
    (xs.length > 1 ? (i / (xs.length - 1)) * (W - padL - padR) : 0)
  const y = (v: number) =>
    padT + ((maxY - v) / ySpan) * (H - padT - padB)
  const pts = rows.map((r, i) => `${x(i)},${y(r.quality_score)}`).join(" ")

  const latest = rows[rows.length - 1]
  const earliest = rows[0]
  const delta = latest.quality_score - earliest.quality_score
  const tone: "green" | "orange" | "red" | "grey" =
    delta > 0 ? "green" : delta < -5 ? "red" : delta < 0 ? "orange" : "grey"

  return (
    <div className="rounded-md border border-ui-border-base bg-ui-bg-base p-3">
      <div className="mb-2 flex items-baseline justify-between">
        <Text size="xsmall" weight="plus" className="text-ui-fg-base">
          Quality score trend ({rows.length} snapshots)
        </Text>
        <Badge color={tone === "grey" ? "grey" : tone} size="2xsmall">
          {delta > 0 ? "+" : ""}
          {delta} pts since first snapshot
        </Badge>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full">
        <text x={4} y={padT + 6} className="fill-ui-fg-muted" fontSize="9">
          {maxY}
        </text>
        <text
          x={4}
          y={H - padB + 4}
          className="fill-ui-fg-muted"
          fontSize="9"
        >
          {minY}
        </text>
        <polyline
          points={pts}
          fill="none"
          stroke="currentColor"
          strokeWidth={1.8}
          className="text-ui-tag-blue-icon"
        />
        {rows.map((r, i) => (
          <circle
            key={r.id}
            cx={x(i)}
            cy={y(r.quality_score)}
            r={i === rows.length - 1 ? 3 : 1.2}
            className="fill-ui-tag-blue-icon"
          >
            <title>
              {new Date(r.captured_at).toLocaleDateString()}: score{" "}
              {r.quality_score}, {r.issue_count} issues
            </title>
          </circle>
        ))}
      </svg>
    </div>
  )
}

/* ── Image-alt AI suggestions (Phase 8.F) ────────────────────────── */

type AltSuggestion = {
  image_url: string
  current_alt: string | null
  suggested_alt: string | null
  skipped_reason: string | null
  error?: string
}

type AltSuggestResponse = {
  url: string
  images_total: number
  images_missing_alt: number
  suggestions: AltSuggestion[]
  errors: string[]
}

/**
 * On-demand image-alt suggester. Renders inside `ExpandedDetails`
 * only when the audit row reports `image_missing_alt_count > 0`.
 *
 * Click the button → backend re-fetches the page, picks every
 * missing-alt `<img>`, calls Gemini Vision on each (up to 12 by
 * default), returns suggestions. Operator copies them into the
 * page source — nothing is persisted server-side.
 */
const ImageAltSuggesterPanel: React.FC<{ url: string; missingCount: number }> = ({
  url,
  missingCount,
}) => {
  const [loading, setLoading] = useState(false)
  const [data, setData] = useState<AltSuggestResponse | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState<string>("")

  const run = async () => {
    setLoading(true)
    setError(null)
    try {
      const r = await fetch("/admin/ovo/seo/image-alt/suggest", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url, limit: 12 }),
      })
      if (!r.ok) {
        const e = (await r.json().catch(() => ({}))) as { message?: string }
        throw new Error(e.message || `Suggest failed (${r.status})`)
      }
      setData((await r.json()) as AltSuggestResponse)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setLoading(false)
    }
  }

  const copy = async (s: string) => {
    try {
      await navigator.clipboard.writeText(s)
      setCopied(s)
      setTimeout(() => setCopied(""), 1500)
    } catch {
      /* noop */
    }
  }

  return (
    <div className="flex flex-col gap-2 rounded-md border border-ui-border-base bg-ui-bg-base p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Text size="xsmall" weight="plus" className="text-ui-fg-base">
          Image alt-text suggestions ({missingCount} missing)
        </Text>
        <Button
          size="small"
          variant="secondary"
          onClick={run}
          isLoading={loading}
          disabled={loading}
        >
          {data ? "Re-run" : "Suggest alt text"}
        </Button>
      </div>
      <Text size="xsmall" className="text-ui-fg-muted">
        Calls Gemini Vision on each `&lt;img&gt;` without an{" "}
        <code className="font-mono">alt</code> attribute. Suggestions
        aren't saved — copy and paste them into the page source.
        Requires a Google AI API key on the General tab.
      </Text>

      {error && (
        <Text size="xsmall" className="text-ui-tag-red-text">
          {error}
        </Text>
      )}

      {data && (
        <>
          <Text size="xsmall" className="text-ui-fg-muted">
            {data.images_total} total `&lt;img&gt;`, {data.images_missing_alt}{" "}
            missing alt — Gemini processed {data.suggestions.length}.
            {data.errors.length > 0 && (
              <span className="ml-2 text-ui-tag-orange-text">
                {data.errors.join("; ")}
              </span>
            )}
          </Text>
          {data.suggestions.length === 0 ? (
            <Text size="xsmall" className="text-ui-fg-muted">
              No images without alt attributes on this page.
            </Text>
          ) : (
            <div className="flex flex-col gap-2">
              {data.suggestions.map((s) => (
                <div
                  key={s.image_url}
                  className="flex items-start gap-2 rounded border border-ui-border-base bg-ui-bg-subtle p-2"
                >
                  <img
                    src={s.image_url}
                    alt=""
                    className="h-12 w-12 flex-shrink-0 rounded object-cover"
                    onError={(e) => {
                      ;(e.currentTarget as HTMLImageElement).style.display =
                        "none"
                    }}
                  />
                  <div className="flex flex-1 flex-col gap-1">
                    <code className="break-all font-mono text-[10px] text-ui-fg-muted">
                      {s.image_url.length > 80
                        ? s.image_url.slice(0, 80) + "…"
                        : s.image_url}
                    </code>
                    {s.suggested_alt ? (
                      <div className="flex items-center justify-between gap-2">
                        <Text size="xsmall" className="text-ui-fg-base">
                          {s.suggested_alt}
                        </Text>
                        <button
                          onClick={() => copy(s.suggested_alt!)}
                          className="flex-shrink-0 rounded border border-ui-border-base bg-ui-bg-base px-2 py-0.5 text-[10px] text-ui-fg-base hover:bg-ui-bg-base-hover"
                        >
                          {copied === s.suggested_alt ? "copied!" : "copy"}
                        </button>
                      </div>
                    ) : (
                      <Text size="xsmall" className="text-ui-tag-orange-text">
                        Skipped: {s.skipped_reason}
                        {s.error ? ` (${s.error})` : ""}
                      </Text>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  )
}

/* ── Inline metadata editor (Phase 8.B) ──────────────────────────── */

/**
 * Maps an audited URL to the OvoOverride row that controls its
 * metadata. Used by `MetadataEditorPanel` to decide whether to render
 * the inline editor (page-keyed overrides) or a "open in admin"
 * shortcut (product/category-keyed overrides — those need a
 * handle→id lookup we don't have client-side).
 *
 * The dynamic-route detection list intentionally mirrors the one in
 * `audit-meta.ts::resolveStorefrontSource` so the editor and the
 * "View source" link agree on what counts as a product vs a page.
 */
type OvoUrlTarget =
  | { kind: "page"; path: string }
  | { kind: "product"; slug: string }
  | { kind: "knowledge_article"; slug: string }
  | { kind: "unsupported"; reason: string }

function mapUrlToOvoTarget(url: string): OvoUrlTarget {
  let pathname: string
  try {
    pathname = new URL(url).pathname.replace(/\/+$/, "") || "/"
  } catch {
    return { kind: "unsupported", reason: "Could not parse URL." }
  }

  // Per-product detail page → product override (handle→id resolution
  // happens via admin product search; the inline editor can't do it
  // without a product-list API call).
  const productMatch = /^\/products\/([^/]+)$/.exec(pathname)
  if (productMatch) return { kind: "product", slug: productMatch[1] }

  // Knowledge article detail → these are   // (content engine) which uses the `content_page` entity_type.
  // Without the slug→id resolution table we surface a graceful
  // "edit in content engine" hint.
  const kbArticleMatch = /^\/knowledge\/articles\/([^/]+)$/.exec(pathname)
  if (kbArticleMatch) return { kind: "knowledge_article", slug: kbArticleMatch[1] }

  // Everything else (storefront marketing pages, static routes,
  // search results, the homepage, llm.txt variants…) is a page-keyed
  // override. `path` is the entity_id stored in OvoOverride.entity_id.
  return { kind: "page", path: pathname }
}

type InlineOverride = {
  seo_title: string | null
  seo_description: string | null
  og_image_url: string | null
  canonical_url: string | null
  noindex: boolean
}

const EMPTY_INLINE: InlineOverride = {
  seo_title: null,
  seo_description: null,
  og_image_url: null,
  canonical_url: null,
  noindex: false,
}

/**
 * Inline 4-field metadata editor for page-keyed OvoOverride rows.
 * Trimmed compared to the full `OvoOverrideForm` (no FAQ / JSON-LD /
 * author / reviewer fields) — those rare overrides live in the Pages
 * tab. This is the 90% case: "tweak the SEO title or meta description
 * for this URL without leaving the audit flow".
 *
 * For product/category URLs we bail out and link to the corresponding
 * admin section, since we'd need a handle→id lookup we don't have
 * client-side.
 *
 * Save round-trip mirrors the existing override CRUD:
 *   POST /admin/ovo/overrides/page/{encoded path}   → upsert
 *   DELETE same                                     → clear
 */
const MetadataEditorPanel: React.FC<{ row: AuditRow }> = ({ row }) => {
  const target = useMemo(() => mapUrlToOvoTarget(row.url), [row.url])

  // For product URLs, no inline editor — link out to the admin
  // product search (slug → product → product detail's OVO widget).
  if (target.kind === "product") {
    return (
      <div className="flex flex-col gap-2 rounded-md border border-ui-border-base bg-ui-bg-base p-3">
        <Text size="xsmall" weight="plus" className="text-ui-fg-base">
          Metadata override
        </Text>
        <Text size="xsmall" className="text-ui-fg-muted">
          This URL is a product detail page. SEO overrides live on the
          product itself — use the OVO widget on the product detail
          page.
        </Text>
        <a
          href={`/app/products?q=${encodeURIComponent(target.slug)}`}
          className="inline-flex w-fit items-center gap-1 rounded-md border border-ui-border-base bg-ui-bg-subtle px-3 py-1.5 text-[11px] text-ui-fg-base hover:bg-ui-bg-base-hover"
        >
          <ArrowUpRightOnBox className="h-3 w-3" />
          Find “{target.slug}” in product admin
        </a>
      </div>
    )
  }

  if (target.kind === "knowledge_article") {
    return (
      <div className="flex flex-col gap-2 rounded-md border border-ui-border-base bg-ui-bg-base p-3">
        <Text size="xsmall" weight="plus" className="text-ui-fg-base">
          Metadata override
        </Text>
        <Text size="xsmall" className="text-ui-fg-muted">
          This URL is a knowledge-base article. Edit its SEO fields in
          the content engine (`content_page` override) rather than as
          a page-keyed override — the storefront resolver prefers the
          per-row data when both exist.
        </Text>
      </div>
    )
  }

  if (target.kind === "unsupported") {
    return null
  }

  return <PageOverrideInlineForm path={target.path} />
}

const PageOverrideInlineForm: React.FC<{ path: string }> = ({ path }) => {
  const [draft, setDraft] = useState<InlineOverride>(EMPTY_INLINE)
  const [hasOverride, setHasOverride] = useState(false)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  const apiUrl = `/admin/ovo/overrides/page/${encodeURIComponent(path)}`

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    fetch(apiUrl, { credentials: "include" })
      .then(async (r) => {
        if (!r.ok) {
          throw new Error(`Load failed (${r.status})`)
        }
        const body = await r.json()
        if (cancelled) return
        if (body && typeof body === "object" && "id" in body) {
          setHasOverride(true)
          setDraft({
            seo_title: body.seo_title ?? null,
            seo_description: body.seo_description ?? null,
            og_image_url: body.og_image_url ?? null,
            canonical_url: body.canonical_url ?? null,
            noindex: !!body.noindex,
          })
        } else {
          setHasOverride(false)
          setDraft(EMPTY_INLINE)
        }
      })
      .catch((err) => {
        if (!cancelled) {
          toast.error("Failed to load override", {
            description: (err as Error).message,
          })
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [apiUrl])

  const save = async () => {
    setSaving(true)
    try {
      const r = await fetch(apiUrl, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(draft),
      })
      if (!r.ok) {
        const e = await r.json().catch(() => ({}))
        throw new Error(e.message || `Save failed (${r.status})`)
      }
      setHasOverride(true)
      toast.success("Override saved", { description: path })
    } catch (err) {
      toast.error("Save failed", { description: (err as Error).message })
    } finally {
      setSaving(false)
    }
  }

  const clear = async () => {
    if (!hasOverride) return
    setSaving(true)
    try {
      const r = await fetch(apiUrl, {
        method: "DELETE",
        credentials: "include",
      })
      if (!r.ok) {
        const e = await r.json().catch(() => ({}))
        throw new Error(e.message || `Clear failed (${r.status})`)
      }
      setHasOverride(false)
      setDraft(EMPTY_INLINE)
      toast.success("Override cleared", { description: path })
    } catch (err) {
      toast.error("Clear failed", { description: (err as Error).message })
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return (
      <div className="rounded-md border border-ui-border-base bg-ui-bg-base p-3">
        <Text size="xsmall" className="text-ui-fg-muted">
          Loading metadata override…
        </Text>
      </div>
    )
  }

  const titleLen = (draft.seo_title ?? "").length
  const descLen = (draft.seo_description ?? "").length

  return (
    <div className="flex flex-col gap-3 rounded-md border border-ui-border-base bg-ui-bg-base p-3">
      <div className="flex items-center justify-between gap-2">
        <Text size="xsmall" weight="plus" className="text-ui-fg-base">
          Metadata override
        </Text>
        <div className="flex items-center gap-1.5">
          {hasOverride ? (
            <Badge color="blue" size="2xsmall">
              Active
            </Badge>
          ) : (
            <Badge color="grey" size="2xsmall">
              None
            </Badge>
          )}
          <code className="font-mono text-[10px] text-ui-fg-muted">
            {path}
          </code>
        </div>
      </div>
      <Text size="xsmall" className="text-ui-fg-muted">
        Per-URL SEO override. Saves to the page-keyed override row;
        storefront picks it up on the next ISR window. Leave a field
        blank to fall back to the OVO defaults.
      </Text>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <label className="flex flex-col gap-1">
          <span className="flex items-center justify-between text-[11px] text-ui-fg-muted">
            <span>SEO title</span>
            <span
              className={
                titleLen > 60 ? "text-ui-tag-orange-text" : "text-ui-fg-muted"
              }
            >
              {titleLen}/60
            </span>
          </span>
          <Input
            value={draft.seo_title ?? ""}
            onChange={(e) =>
              setDraft({ ...draft, seo_title: e.target.value || null })
            }
            placeholder="Falls back to default"
          />
        </label>

        <label className="flex flex-col gap-1">
          <span className="flex items-center justify-between text-[11px] text-ui-fg-muted">
            <span>Canonical URL</span>
            <span className="text-ui-fg-muted">absolute https://…</span>
          </span>
          <Input
            value={draft.canonical_url ?? ""}
            onChange={(e) =>
              setDraft({ ...draft, canonical_url: e.target.value || null })
            }
            placeholder="Falls back to URL"
          />
        </label>

        <label className="col-span-1 flex flex-col gap-1 md:col-span-2">
          <span className="flex items-center justify-between text-[11px] text-ui-fg-muted">
            <span>Meta description</span>
            <span
              className={
                descLen > 160 ? "text-ui-tag-orange-text" : "text-ui-fg-muted"
              }
            >
              {descLen}/160
            </span>
          </span>
          <textarea
            value={draft.seo_description ?? ""}
            onChange={(e) =>
              setDraft({ ...draft, seo_description: e.target.value || null })
            }
            placeholder="Falls back to default"
            rows={2}
            className="rounded-md border border-ui-border-base bg-ui-bg-base px-3 py-2 text-[12px] text-ui-fg-base"
          />
        </label>

        <label className="flex flex-col gap-1">
          <span className="text-[11px] text-ui-fg-muted">og:image URL</span>
          <Input
            value={draft.og_image_url ?? ""}
            onChange={(e) =>
              setDraft({ ...draft, og_image_url: e.target.value || null })
            }
            placeholder="Falls back to default"
          />
        </label>

        <label className="flex items-center gap-2 self-end">
          <input
            type="checkbox"
            checked={draft.noindex}
            onChange={(e) =>
              setDraft({ ...draft, noindex: e.target.checked })
            }
          />
          <span className="text-[11px] text-ui-fg-base">
            <code className="font-mono">noindex</code> — hide from search
          </span>
        </label>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Button
          size="small"
          variant="primary"
          onClick={save}
          isLoading={saving}
          disabled={saving}
        >
          Save override
        </Button>
        {hasOverride && (
          <Button
            size="small"
            variant="secondary"
            onClick={clear}
            disabled={saving}
          >
            Clear override
          </Button>
        )}
        <Text size="xsmall" className="text-ui-fg-muted">
          For FAQ + custom JSON-LD, use the Pages tab.
        </Text>
      </div>
    </div>
  )
}

/* ── Internal link suggestions (Phase 7.B) ───────────────────────── */

type LinkSuggestion = {
  source_url: string
  title: string | null
  similarity: number
  shared_terms: string[]
}

/**
 * Fetches `/admin/ovo/seo/link-suggestions?url=<target>` and renders
 * the top topically-related pages. Operator-actionable: each row has
 * a copy-URL button + an "Open page" arrow so the operator can jump
 * to the source page and edit it to add the link.
 *
 * Mounted inside `ExpandedDetails` only — won't fire on collapse.
 * Hits the backend once per row-expansion, no polling.
 */
const LinkSuggestionsPanel: React.FC<{ url: string }> = ({ url }) => {
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [suggestions, setSuggestions] = useState<LinkSuggestion[]>([])
  const [copied, setCopied] = useState<string>("")

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    fetch(
      `/admin/ovo/seo/link-suggestions?url=${encodeURIComponent(url)}`,
      { credentials: "include" },
    )
      .then(async (r) => {
        if (!r.ok) {
          const e = (await r.json().catch(() => ({}))) as { message?: string }
          throw new Error(e.message || `Suggestions load failed (${r.status})`)
        }
        const json = (await r.json()) as { suggestions: LinkSuggestion[] }
        if (!cancelled) setSuggestions(json.suggestions)
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
  }, [url])

  const copyUrl = async (u: string) => {
    try {
      await navigator.clipboard.writeText(u)
      setCopied(u)
      setTimeout(() => setCopied(""), 1500)
    } catch {
      /* noop */
    }
  }

  if (loading) {
    return (
      <div className="rounded-md border border-ui-border-base bg-ui-bg-base p-3">
        <Text size="xsmall" className="text-ui-fg-muted">
          Loading link suggestions…
        </Text>
      </div>
    )
  }
  if (error) {
    return (
      <div className="rounded-md border border-ui-border-base bg-ui-bg-base p-3">
        <Text size="xsmall" className="text-ui-tag-red-text">
          {error}
        </Text>
      </div>
    )
  }
  if (suggestions.length === 0) {
    return (
      <div className="rounded-md border border-dashed border-ui-border-base bg-ui-bg-base p-3">
        <Text size="xsmall" className="text-ui-fg-muted">
          No topically-related pages found in the audit index. Run an
          audit so every URL has metadata, then check again.
        </Text>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-2 rounded-md border border-ui-border-base bg-ui-bg-base p-3">
      <Text size="xsmall" weight="plus" className="text-ui-fg-base">
        Suggested incoming internal links
      </Text>
      <Text size="xsmall" className="text-ui-fg-muted">
        Add a link from any of these pages to this URL — gives Googlebot
        a discovery path and feeds ranking signal. Sorted by topic
        similarity. Click a source URL to copy.
      </Text>
      <table className="text-[11px]">
        <thead className="text-ui-fg-muted">
          <tr>
            <th className="px-2 py-1 text-left">Source URL</th>
            <th className="px-2 py-1 text-left">Title</th>
            <th className="px-2 py-1 text-right">Match</th>
            <th className="px-2 py-1 text-left">Shared topic terms</th>
            <th className="px-2 py-1"></th>
          </tr>
        </thead>
        <tbody>
          {suggestions.map((s) => {
            const path = (() => {
              try {
                const u = new URL(s.source_url)
                return u.pathname + u.search
              } catch {
                return s.source_url
              }
            })()
            return (
              <tr
                key={s.source_url}
                className="border-t border-ui-border-base"
              >
                <td className="px-2 py-1">
                  <button
                    onClick={() => copyUrl(s.source_url)}
                    className="font-mono text-ui-fg-base hover:underline"
                  >
                    {copied === s.source_url ? "copied!" : path}
                  </button>
                </td>
                <td className="px-2 py-1 text-ui-fg-base">
                  {s.title ? (
                    s.title.length > 50
                      ? s.title.slice(0, 50) + "…"
                      : s.title
                  ) : (
                    <span className="text-ui-fg-muted">—</span>
                  )}
                </td>
                <td className="px-2 py-1 text-right">
                  <Badge
                    color={
                      s.similarity >= 0.3
                        ? "green"
                        : s.similarity >= 0.15
                          ? "orange"
                          : "grey"
                    }
                    size="2xsmall"
                  >
                    {(s.similarity * 100).toFixed(0)}%
                  </Badge>
                </td>
                <td className="px-2 py-1 text-ui-fg-muted">
                  {s.shared_terms.slice(0, 4).join(", ")}
                  {s.shared_terms.length > 4 ? "…" : ""}
                </td>
                <td className="px-2 py-1">
                  <a
                    href={s.source_url}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-0.5 text-ui-fg-muted hover:text-ui-fg-base"
                  >
                    <ArrowUpRightOnBox className="h-3 w-3" />
                  </a>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

const sortIcon = (active: boolean, dir: SortDir): React.ReactNode => {
  if (!active) return <ArrowUpDown className="h-3 w-3 text-ui-fg-muted" />
  return dir === "asc" ? (
    <ArrowUpMini className="h-3 w-3" />
  ) : (
    <ArrowDownMini className="h-3 w-3" />
  )
}

/* ── main component ───────────────────────────────────────────────── */

const AuditTab: React.FC = () => {
  const [loading, setLoading] = useState(true)
  const [running, setRunning] = useState(false)
  const [reauditingUrl, setReauditingUrl] = useState<string>("")
  const [error, setError] = useState<string | null>(null)
  const [severity, setSeverity] = useState<"error" | "warn" | "all">("all")
  const [search, setSearch] = useState("")
  // Debounced search — the input updates immediately for visual
  // feedback but the audit fetch only fires after 300ms of typing
  // idle. Without this, fast typists trip the 120 req/60s admin
  // rate-limit and the run history fails with a 429.
  const debouncedSearch = useDebouncedValue(search, 300)
  const [codeFilter, setCodeFilter] = useState<string>("")
  const [rows, setRows] = useState<AuditRow[]>([])
  const [summary, setSummary] = useState<AuditSummary | null>(null)
  const [runs, setRuns] = useState<AuditRun[]>([])
  const [expanded, setExpanded] = useState<string>("")
  const [sortKey, setSortKey] = useState<SortKey>("issues")
  const [sortDir, setSortDir] = useState<SortDir>("desc")

  // Audit-run history is independent of severity/search filters —
  // load it ONCE on mount instead of on every filter change. Cuts
  // ~half of this tab's mount-time rate-limit budget.
  const refreshRuns = useCallback(async () => {
    try {
      const h = await loadAuditRuns(30)
      setRuns(h)
    } catch {
      /* tolerate — runs are non-essential to the lint table */
    }
  }, [])

  useEffect(() => {
    refreshRuns()
  }, [refreshRuns])

  const refresh = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const a = await loadAudit({ severity, search: debouncedSearch })
      setRows(a.rows)
      setSummary(a.summary)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setLoading(false)
    }
  }, [severity, debouncedSearch])

  useEffect(() => {
    refresh()
  }, [refresh])

  const onFullAudit = useCallback(async () => {
    setRunning(true)
    try {
      const r = await runAuditFull()
      toast.success("Audit complete", {
        description: `${r.audited} URLs · ${r.error_urls} errors · ${r.warn_urls} warnings`,
      })
      await refresh()
    } catch (err) {
      toast.error("Audit failed", { description: (err as Error).message })
    } finally {
      setRunning(false)
    }
  }, [refresh])

  const onReaudit = useCallback(
    async (url: string) => {
      setReauditingUrl(url)
      try {
        const r = await runAuditOne(url)
        const errC = r.findings.filter((f) => f.severity === "error").length
        const warnC = r.findings.filter((f) => f.severity === "warn").length
        if (r.findings.length === 0) {
          toast.success("Re-audit: all clear", {
            description: cleanPath(url),
          })
        } else {
          toast.info("Re-audit complete", {
            description: `${errC} error · ${warnC} warn — ${cleanPath(url)}`,
          })
        }
        await refresh()
      } catch (err) {
        toast.error("Re-audit failed", {
          description: (err as Error).message,
        })
      } finally {
        setReauditingUrl("")
      }
    },
    [refresh],
  )

  const filteredRows = useMemo(() => {
    if (!codeFilter) return rows
    return rows.filter((r) =>
      r.issues.some((f) => f.code === codeFilter),
    )
  }, [rows, codeFilter])

  const sortedRows = useMemo(() => {
    const copy = [...filteredRows]
    copy.sort((a, b) => {
      let cmp = 0
      switch (sortKey) {
        case "url":
          cmp = a.url.localeCompare(b.url)
          break
        case "issues": {
          const aErr = a.issues.filter((f) => f.severity === "error").length
          const bErr = b.issues.filter((f) => f.severity === "error").length
          if (aErr !== bErr) {
            cmp = aErr - bErr
          } else {
            cmp = a.issues.length - b.issues.length
          }
          break
        }
        case "response":
          cmp = a.response_time_ms - b.response_time_ms
          break
        case "words":
          cmp = a.word_count - b.word_count
          break
        case "status":
          cmp = a.status_code - b.status_code
          break
        case "score":
          cmp = (a.quality_score ?? 100) - (b.quality_score ?? 100)
          break
      }
      return sortDir === "asc" ? cmp : -cmp
    })
    return copy
  }, [filteredRows, sortKey, sortDir])

  const onSortClick = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir(sortDir === "asc" ? "desc" : "asc")
    } else {
      setSortKey(key)
      setSortDir(key === "url" ? "asc" : "desc")
    }
  }

  return (
    <section className="flex flex-col gap-6">
      {/* Header */}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <Heading level="h2">On-page SEO audit</Heading>
          <Text size="small" className="text-ui-fg-muted">
            Nightly lint of every URL in the storefront sitemap. Catches
            missing meta tags, broken canonicals, malformed JSON-LD,
            duplicate H1s, slow responses, and missing image alt text
            before they tank rankings.
            {summary?.last_run_at && (
              <>
                {" "}Last run{" "}
                <span className="font-mono">
                  {formatRelative(summary.last_run_at)}
                </span>
                .
              </>
            )}
          </Text>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="secondary"
            size="small"
            onClick={() => downloadCsv(sortedRows)}
            disabled={!sortedRows.length}
          >
            <ArrowDownTray className="mr-1 h-3 w-3" />
            Export CSV
          </Button>
          <Button onClick={onFullAudit} isLoading={running} disabled={running}>
            {running ? "Auditing…" : "Run audit now"}
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

      {/* Summary cards */}
      {summary && summary.total > 0 && (
        <div className="flex flex-wrap items-stretch gap-3">
          <SummaryCard
            label="Healthy"
            value={summary.healthy}
            tone="green"
            total={summary.total}
          />
          <SummaryCard
            label="Warnings"
            value={summary.warn}
            tone="orange"
            total={summary.total}
          />
          <SummaryCard
            label="Errors"
            value={summary.error}
            tone="red"
            total={summary.total}
          />
          <AvgScoreCard rows={rows} />
        </div>
      )}

      {/* Run-history trend chart */}
      <div className="flex flex-col gap-2">
        <Text size="xsmall" className="text-ui-fg-muted">
          Audit health over time (last {runs.length} runs)
        </Text>
        <RunHistoryChart runs={runs} />
      </div>

      {/* Regression alerts — what got worse this week */}
      <RegressionsPanel />

      {/* Top-issues drill-down */}
      <TopIssuesPanel
        rows={rows}
        activeCode={codeFilter}
        onCodeClick={setCodeFilter}
      />

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-2 border-t border-ui-border-base pt-3">
        <Text size="xsmall" className="text-ui-fg-muted">
          Severity:
        </Text>
        {(["all", "error", "warn"] as const).map((s) => (
          <Button
            key={s}
            variant={s === severity ? "primary" : "secondary"}
            size="small"
            onClick={() => setSeverity(s)}
          >
            {s === "all" ? "All" : s === "error" ? "Errors" : "Warnings+"}
          </Button>
        ))}
        {codeFilter && (
          <Badge color="grey" size="2xsmall">
            filtered: {codeFilter}
          </Badge>
        )}
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Filter by URL substring…"
          className="ml-auto max-w-xs"
        />
        <Button variant="transparent" size="small" onClick={refresh} disabled={loading}>
          {loading ? "Loading…" : "Refresh"}
        </Button>
      </div>

      {/* Table */}
      {summary?.total === 0 ? (
        <div className="rounded-md border border-dashed border-ui-border-base p-8 text-center">
          <Text size="small" className="text-ui-fg-muted">
            No audit data yet. Click <span className="font-semibold">Run audit now</span> to
            walk the sitemap and lint every page.
          </Text>
        </div>
      ) : (
        <div className="overflow-hidden rounded-md border border-ui-border-base">
          <table className="w-full border-collapse text-left text-xs">
            <thead className="bg-ui-bg-subtle">
              <tr>
                <SortableTh
                  label="URL"
                  active={sortKey === "url"}
                  dir={sortDir}
                  onClick={() => onSortClick("url")}
                />
                <SortableTh
                  label="Score"
                  active={sortKey === "score"}
                  dir={sortDir}
                  onClick={() => onSortClick("score")}
                  alignRight
                />
                <SortableTh
                  label="Status"
                  active={sortKey === "status"}
                  dir={sortDir}
                  onClick={() => onSortClick("status")}
                />
                <SortableTh
                  label="Findings"
                  active={sortKey === "issues"}
                  dir={sortDir}
                  onClick={() => onSortClick("issues")}
                />
                <SortableTh
                  label="Words"
                  active={sortKey === "words"}
                  dir={sortDir}
                  onClick={() => onSortClick("words")}
                  alignRight
                />
                <SortableTh
                  label="ms"
                  active={sortKey === "response"}
                  dir={sortDir}
                  onClick={() => onSortClick("response")}
                  alignRight
                />
              </tr>
            </thead>
            <tbody>
              {sortedRows.map((r) => {
                const errs = r.issues.filter((f) => f.severity === "error").length
                const warns = r.issues.filter((f) => f.severity === "warn").length
                const tone =
                  errs > 0 ? "red" : warns > 0 ? "orange" : "green"
                const label = errs > 0 ? "Error" : warns > 0 ? "Warn" : "OK"
                const isExpanded = expanded === r.id
                return (
                  <React.Fragment key={r.id}>
                    <tr
                      className="cursor-pointer border-t border-ui-border-base hover:bg-ui-bg-base-hover"
                      onClick={() => setExpanded(isExpanded ? "" : r.id)}
                    >
                      <td className="px-3 py-2">
                        <div className="flex items-center gap-2">
                          {isExpanded ? (
                            <ChevronDown className="h-3 w-3 text-ui-fg-muted" />
                          ) : (
                            <ChevronRight className="h-3 w-3 text-ui-fg-muted" />
                          )}
                          <TruncUrl url={r.url} />
                        </div>
                      </td>
                      <td className="px-3 py-2 text-right">
                        <QualityScoreBadge score={r.quality_score ?? 100} />
                      </td>
                      <td className="px-3 py-2">
                        <Badge color={tone as "red" | "orange" | "green"} size="2xsmall">
                          {label}
                        </Badge>
                      </td>
                      <td className="px-3 py-2">
                        <div className="flex flex-wrap gap-1">
                          {r.issues.length === 0 ? (
                            <Text size="xsmall" className="text-ui-fg-muted">
                              No findings
                            </Text>
                          ) : (
                            r.issues
                              .slice(0, 6)
                              .map((f, i) => (
                                <FindingChip
                                  key={`${r.id}-chip-${i}`}
                                  finding={f}
                                />
                              ))
                          )}
                          {r.issues.length > 6 && (
                            <Text size="xsmall" className="text-ui-fg-muted">
                              +{r.issues.length - 6}
                            </Text>
                          )}
                        </div>
                      </td>
                      <td className="px-3 py-2 text-right font-mono">
                        {r.word_count.toLocaleString()}
                      </td>
                      <td className="px-3 py-2 text-right font-mono">
                        {r.response_time_ms}
                      </td>
                    </tr>
                    {isExpanded && (
                      <tr className="border-t border-ui-border-base bg-ui-bg-subtle">
                        <td colSpan={6} className="px-3 py-3">
                          <ExpandedDetails
                            row={r}
                            onReaudit={onReaudit}
                            isReauditing={reauditingUrl === r.url}
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

const SortableTh: React.FC<{
  label: string
  active: boolean
  dir: SortDir
  onClick: () => void
  alignRight?: boolean
}> = ({ label, active, dir, onClick, alignRight }) => (
  <th
    className={
      "select-none cursor-pointer px-3 py-2 font-semibold text-ui-fg-muted " +
      (alignRight ? "text-right" : "")
    }
    onClick={onClick}
  >
    <span
      className={
        "inline-flex items-center gap-1 " + (alignRight ? "justify-end w-full" : "")
      }
    >
      {label}
      {sortIcon(active, dir)}
    </span>
  </th>
)

export default AuditTab
