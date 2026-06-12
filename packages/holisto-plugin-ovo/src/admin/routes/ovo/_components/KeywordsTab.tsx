import React, { useCallback, useEffect, useMemo, useState } from "react"
import {
  Badge,
  Button,
  Drawer,
  Heading,
  Input,
  Label,
  Select,
  Switch,
  Text,
  Textarea,
  toast,
} from "@medusajs/ui"
import {
  ArrowUpRightOnBox,
  ArrowUpTray,
  Plus,
  Trash,
  XMark,
} from "@medusajs/icons"
import {
  loadKeywordGroups,
  type KeywordGroup as KeywordGroupRow,
} from "./types"

/**
 * Keywords tab — `/app/ovo?tab=keywords`.
 *
 * Phase 1 of OVO keyword-domination: the flat (URL, keyword, priority,
 * notes) table is widened to support keyword groups, a status state
 * machine, target-position auto-flipping, and search-intent
 * auto-classification. The full 3-column tree+drawer redesign lives
 * behind a feature flag; this is the backwards-compatible flat view
 * that exposes the new fields inline.
 *
 *   1. Add-target form (keyword + optional URL + priority 1-5 + group
 *      + status + target_position + notes).
 *   2. Table of every existing target with: priority, keyword, target
 *      URL (nullable in Phase 1), group, status, intent, target
 *      position, latest snapshot/rollup clicks/impressions/CTR/
 *      position.
 *   3. Filter by URL substring + group + status.
 *
 * Performance numbers come from `ovo_seo_keyword_perf_snapshot` first
 * (Phase 1 daily rollup) and fall back to the GSC dimension rollup
 * for targets without a snapshot yet.
 */

/* ── types ─────────────────────────────────────────────────────────── */

type SearchIntent =
  | "informational"
  | "navigational"
  | "transactional"
  | "commercial"

type TargetStatus = "tracking" | "paused" | "won" | "lost"

type KeywordTargetRow = {
  id: string
  url: string | null
  keyword: string
  normalized_keyword: string
  keyword_group_id: string | null
  priority: number
  notes: string | null
  status: TargetStatus
  target_position: number | null
  is_active: boolean
  tags: string[] | null
  search_intent?: SearchIntent
  clicks: number | null
  impressions: number | null
  ctr: number | null
  position: number | null
  captured_at: string | null
  source?: "snapshot" | "rollup" | "none"
}

// KeywordGroupRow re-exported as KeywordGroup from ./types so all four
// keyword tabs share one source of truth for the group shape and the
// `/admin/ovo/keyword-groups` fetcher.

const TARGETS_API = "/admin/ovo/seo/keyword-targets"

/* ── fetchers ─────────────────────────────────────────────────────── */

async function loadTargets(): Promise<KeywordTargetRow[]> {
  const r = await fetch(`${TARGETS_API}?with_performance=1`, {
    credentials: "include",
  })
  if (!r.ok) {
    const e = (await r.json().catch(() => ({}))) as { message?: string }
    throw new Error(e.message || `Load failed (${r.status})`)
  }
  return ((await r.json()) as { rows: KeywordTargetRow[] }).rows
}

// loadKeywordGroups imported from ./types

async function createTarget(input: {
  keyword: string
  url?: string | null
  priority?: number
  notes?: string | null
  keyword_group_id?: string | null
  status?: TargetStatus
  target_position?: number | null
}): Promise<void> {
  const r = await fetch(TARGETS_API, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  })
  if (!r.ok) {
    const e = (await r.json().catch(() => ({}))) as { message?: string }
    throw new Error(e.message || `Create failed (${r.status})`)
  }
}

async function updateTarget(
  id: string,
  patch: Partial<
    Pick<
      KeywordTargetRow,
      | "keyword"
      | "url"
      | "priority"
      | "notes"
      | "keyword_group_id"
      | "status"
      | "target_position"
      | "is_active"
    >
  >,
): Promise<void> {
  const r = await fetch(`${TARGETS_API}/${id}`, {
    method: "PATCH",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(patch),
  })
  if (!r.ok) {
    const e = (await r.json().catch(() => ({}))) as { message?: string }
    throw new Error(e.message || `Update failed (${r.status})`)
  }
}

async function deleteTarget(id: string): Promise<void> {
  const r = await fetch(`${TARGETS_API}/${id}`, {
    method: "DELETE",
    credentials: "include",
  })
  if (!r.ok) {
    const e = (await r.json().catch(() => ({}))) as { message?: string }
    throw new Error(e.message || `Delete failed (${r.status})`)
  }
}

/** Per-target rank-trend points for the detail drawer chart. */
type KwPerfPoint = {
  date: string
  clicks: number
  impressions: number
  ctr: number
  position: number | null
  indexed: boolean
}

type KwPerfResp = {
  series: KwPerfPoint[]
  latest: KwPerfPoint | null
  // Phase I — per-engine breakdown. Older snapshots only had `series`
  // (GSC-only), so both new fields are optional on the wire.
  engines?: string[]
  by_engine?: Record<
    string,
    {
      series: KwPerfPoint[]
      latest: KwPerfPoint | null
    }
  >
}

async function loadKeywordPerformance(
  id: string,
  windowDays = 90,
): Promise<KwPerfResp> {
  const r = await fetch(
    `${TARGETS_API}/${encodeURIComponent(id)}/performance?window_days=${windowDays}`,
    { credentials: "include" },
  )
  if (!r.ok) {
    const e = (await r.json().catch(() => ({}))) as { message?: string }
    throw new Error(e.message || `Perf load failed (${r.status})`)
  }
  return (await r.json()) as KwPerfResp
}

async function setKeywordIntent(
  id: string,
  intent: SearchIntent,
): Promise<void> {
  const r = await fetch(
    `${TARGETS_API}/${encodeURIComponent(id)}/intent`,
    {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ intent }),
    },
  )
  if (!r.ok) {
    const e = (await r.json().catch(() => ({}))) as { message?: string }
    throw new Error(e.message || `Intent override failed (${r.status})`)
  }
}

/** Move-to-group payload for the multi-select toolbar. */
async function bulkMoveTargets(
  targetIds: string[],
  groupId: string | null,
): Promise<{ moved: number }> {
  const r = await fetch(`${TARGETS_API}/move-to-group`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ target_ids: targetIds, group_id: groupId }),
  })
  if (!r.ok) {
    const e = (await r.json().catch(() => ({}))) as { message?: string }
    throw new Error(e.message || `Bulk move failed (${r.status})`)
  }
  return (await r.json()) as { moved: number }
}

/**
 * Bulk-import CSV row shape after parsing. We deliberately accept a
 * loose superset of the server schema so the preview can show invalid
 * rows with per-row error messages before sending. The server
 * validates again via zod and returns per-row errors when present.
 */
type BulkImportRow = {
  keyword: string
  url?: string | null
  priority?: number
  notes?: string | null
  keyword_group_id?: string | null
  status?: TargetStatus
  target_position?: number | null
  search_intent?: SearchIntent
}

type BulkImportResult = {
  inserted: number
  updated: number
  errors: Array<{ index: number; keyword?: string; error: string }>
}

async function bulkImportTargets(
  rows: BulkImportRow[],
): Promise<BulkImportResult> {
  const r = await fetch(`${TARGETS_API}/bulk-import`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ rows }),
  })
  if (!r.ok) {
    const e = (await r.json().catch(() => ({}))) as { message?: string }
    throw new Error(e.message || `Bulk import failed (${r.status})`)
  }
  return (await r.json()) as BulkImportResult
}

/* ── Intent-mix panel (Phase 8.D) ────────────────────────────────── */

type IntentMix = {
  total: number
  by_intent: {
    informational: number
    navigational: number
    transactional: number
    commercial: number
  }
  pct: {
    informational: number
    navigational: number
    transactional: number
    commercial: number
  }
}

const INTENT_COLOURS: Record<keyof IntentMix["by_intent"], string> = {
  informational: "bg-ui-tag-blue-bg text-ui-tag-blue-text",
  navigational: "bg-ui-tag-purple-bg text-ui-tag-purple-text",
  transactional: "bg-ui-tag-green-bg text-ui-tag-green-text",
  commercial: "bg-ui-tag-orange-bg text-ui-tag-orange-text",
}

const INTENT_BAR_COLOURS: Record<keyof IntentMix["by_intent"], string> = {
  informational: "bg-blue-500",
  navigational: "bg-purple-500",
  transactional: "bg-green-500",
  commercial: "bg-orange-500",
}

const IntentMixPanel: React.FC<{ refreshKey: number }> = ({ refreshKey }) => {
  const [mix, setMix] = useState<IntentMix | null>(null)
  const [loading, setLoading] = useState(false)
  const [backfilling, setBackfilling] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const r = await fetch("/admin/ovo/seo/keywords/intent-mix", {
        credentials: "include",
      })
      if (!r.ok) {
        const e = (await r.json().catch(() => ({}))) as { message?: string }
        throw new Error(e.message || `Load failed (${r.status})`)
      }
      setMix((await r.json()) as IntentMix)
    } catch (err) {
      toast.error("Intent mix load failed", {
        description: (err as Error).message,
      })
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
  }, [load, refreshKey])

  const backfill = async () => {
    setBackfilling(true)
    try {
      const r = await fetch("/admin/ovo/seo/keywords/backfill-intent", {
        method: "POST",
        credentials: "include",
      })
      if (!r.ok) {
        const e = (await r.json().catch(() => ({}))) as { message?: string }
        throw new Error(e.message || `Backfill failed (${r.status})`)
      }
      const out = (await r.json()) as { updated: number }
      toast.success(`Reclassified ${out.updated} keywords`)
      await load()
    } catch (err) {
      toast.error("Backfill failed", { description: (err as Error).message })
    } finally {
      setBackfilling(false)
    }
  }

  if (!mix) {
    return (
      <div className="rounded-md border border-ui-border-base bg-ui-bg-base p-3">
        <Text size="small" className="text-ui-fg-muted">
          {loading ? "Loading intent mix…" : "No intent data yet."}
        </Text>
      </div>
    )
  }

  const order: (keyof IntentMix["by_intent"])[] = [
    "informational",
    "commercial",
    "transactional",
    "navigational",
  ]

  return (
    <div className="flex flex-col gap-2 rounded-md border border-ui-border-base bg-ui-bg-base p-3">
      <div className="flex items-center justify-between gap-2">
        <div>
          <Text size="small" weight="plus" className="text-ui-fg-base">
            Funnel-stage mix
          </Text>
          <Text size="xsmall" className="text-ui-fg-muted">
            How your tracked keywords distribute across search intent.
            Auto-classified from keyword text.
          </Text>
        </div>
        <Button
          size="small"
          variant="secondary"
          onClick={backfill}
          isLoading={backfilling}
          disabled={backfilling || loading}
        >
          Reclassify all
        </Button>
      </div>

      {/* Stacked bar */}
      <div className="flex h-6 w-full overflow-hidden rounded">
        {order.map((k) => {
          const pct = mix.pct[k]
          if (pct <= 0) return null
          return (
            <div
              key={k}
              className={`${INTENT_BAR_COLOURS[k]} flex items-center justify-center text-[10px] text-white`}
              style={{ width: `${pct}%` }}
              title={`${k}: ${mix.by_intent[k]} (${pct}%)`}
            >
              {pct >= 10 ? `${pct}%` : ""}
            </div>
          )
        })}
      </div>

      {/* Legend */}
      <div className="flex flex-wrap items-center gap-2">
        {order.map((k) => (
          <span
            key={k}
            className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] ${INTENT_COLOURS[k]}`}
          >
            <span
              className={`inline-block h-2 w-2 rounded-full ${INTENT_BAR_COLOURS[k]}`}
            />
            {k} · {mix.by_intent[k]}
          </span>
        ))}
        <span className="text-[10px] text-ui-fg-muted">
          total {mix.total}
        </span>
      </div>
    </div>
  )
}

/* ── presentational ───────────────────────────────────────────────── */

const PRIORITY_LABELS: Record<number, string> = {
  1: "P1 head",
  2: "P2 secondary",
  3: "P3 long-tail",
  4: "P4 exploratory",
  5: "P5 experiment",
}

const PRIORITY_TONE: Record<
  number,
  "red" | "orange" | "grey" | "blue" | "purple"
> = {
  1: "red",
  2: "orange",
  3: "grey",
  4: "blue",
  5: "purple",
}

const PriorityBadge: React.FC<{ priority: number }> = ({ priority }) => (
  <Badge color={PRIORITY_TONE[priority] ?? "grey"} size="2xsmall">
    {PRIORITY_LABELS[priority] ?? `P${priority}`}
  </Badge>
)

const STATUS_TONE: Record<TargetStatus, "green" | "orange" | "red" | "grey"> = {
  tracking: "grey",
  paused: "orange",
  won: "green",
  lost: "red",
}

const StatusBadge: React.FC<{ status: TargetStatus }> = ({ status }) => (
  <Badge color={STATUS_TONE[status]} size="2xsmall">
    {status}
  </Badge>
)

const IntentChip: React.FC<{ intent?: SearchIntent }> = ({ intent }) => {
  if (!intent) return <Text size="xsmall" className="text-ui-fg-muted">—</Text>
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] ${INTENT_COLOURS[intent]}`}
    >
      <span className={`inline-block h-1.5 w-1.5 rounded-full ${INTENT_BAR_COLOURS[intent]}`} />
      {intent.slice(0, 4)}
    </span>
  )
}

const PositionCell: React.FC<{
  position: number | null
  target: number | null
}> = ({ position, target }) => {
  if (position == null) {
    return (
      <Text size="xsmall" className="text-ui-fg-muted">
        not ranked
      </Text>
    )
  }
  const tone: "green" | "orange" | "red" =
    position <= 3 ? "green" : position <= 10 ? "orange" : "red"
  return (
    <span className="inline-flex items-center gap-1">
      <Badge color={tone} size="2xsmall">
        <span className="font-mono">#{position.toFixed(1)}</span>
      </Badge>
      {target != null && (
        <Text size="xsmall" className="text-ui-fg-muted font-mono">
          /≤{target}
        </Text>
      )}
    </span>
  )
}

const cleanPath = (url: string | null): string => {
  if (!url) return "—"
  try {
    const u = new URL(url)
    return u.pathname + u.search
  } catch {
    return url
  }
}

/* ── add form ─────────────────────────────────────────────────────── */

const AddForm: React.FC<{
  groups: KeywordGroupRow[]
  onCreated: () => void
}> = ({ groups, onCreated }) => {
  const [url, setUrl] = useState("")
  const [keyword, setKeyword] = useState("")
  const [priority, setPriority] = useState<string>("2")
  const [groupId, setGroupId] = useState<string>("__none__")
  const [status, setStatus] = useState<TargetStatus>("tracking")
  const [targetPos, setTargetPos] = useState<string>("")
  const [notes, setNotes] = useState("")
  const [submitting, setSubmitting] = useState(false)

  const submit = useCallback(async () => {
    if (keyword.trim().length < 2) {
      toast.warning("Keyword too short")
      return
    }
    // URL is optional in Phase 1; if provided must be absolute.
    if (url.trim() && !/^https?:\/\//.test(url.trim())) {
      toast.warning("URL must be absolute (https://your-domain.example/...)")
      return
    }
    setSubmitting(true)
    try {
      await createTarget({
        keyword: keyword.trim(),
        url: url.trim() || null,
        priority: Number(priority),
        notes: notes.trim() || null,
        keyword_group_id: groupId === "__none__" ? null : groupId,
        status,
        target_position: targetPos.trim()
          ? Math.max(1, Math.min(100, Number(targetPos)))
          : null,
      })
      setUrl("")
      setKeyword("")
      setNotes("")
      setPriority("2")
      setGroupId("__none__")
      setStatus("tracking")
      setTargetPos("")
      toast.success("Target added", {
        description: "Will be checked on the next audit run.",
      })
      onCreated()
    } catch (err) {
      toast.error("Create failed", { description: (err as Error).message })
    } finally {
      setSubmitting(false)
    }
  }, [url, keyword, priority, notes, groupId, status, targetPos, onCreated])

  return (
    <div className="flex flex-col gap-2 rounded-md border border-dashed border-ui-border-base p-3">
      <Text size="small" weight="plus" className="text-ui-fg-base">
        Add a target keyword
      </Text>
      <div className="grid grid-cols-1 gap-2 md:grid-cols-12">
        <Input
          value={keyword}
          onChange={(e) => setKeyword(e.target.value)}
          placeholder='keyword e.g. "your primary keyword"'
          className="md:col-span-4 font-mono text-xs"
        />
        <Input
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="https://your-domain.example/products/example-product (optional)"
          className="md:col-span-4 font-mono text-xs"
        />
        <Select value={priority} onValueChange={setPriority}>
          <Select.Trigger className="md:col-span-2">
            <Select.Value placeholder="Priority" />
          </Select.Trigger>
          <Select.Content>
            <Select.Item value="1">P1 head</Select.Item>
            <Select.Item value="2">P2 secondary</Select.Item>
            <Select.Item value="3">P3 long-tail</Select.Item>
            <Select.Item value="4">P4 exploratory</Select.Item>
            <Select.Item value="5">P5 experiment</Select.Item>
          </Select.Content>
        </Select>
        <Button
          onClick={submit}
          isLoading={submitting}
          disabled={submitting}
          size="small"
          className="md:col-span-2"
        >
          <Plus className="mr-1 h-3 w-3" />
          Add
        </Button>
      </div>
      <div className="grid grid-cols-1 gap-2 md:grid-cols-12">
        <Select value={groupId} onValueChange={setGroupId}>
          <Select.Trigger className="md:col-span-4">
            <Select.Value placeholder="Group" />
          </Select.Trigger>
          <Select.Content>
            <Select.Item value="__none__">Ungrouped</Select.Item>
            {groups.map((g) => (
              <Select.Item key={g.id} value={g.id}>
                {g.name}
              </Select.Item>
            ))}
          </Select.Content>
        </Select>
        <Select
          value={status}
          onValueChange={(v) => setStatus(v as TargetStatus)}
        >
          <Select.Trigger className="md:col-span-3">
            <Select.Value placeholder="Status" />
          </Select.Trigger>
          <Select.Content>
            <Select.Item value="tracking">tracking</Select.Item>
            <Select.Item value="paused">paused</Select.Item>
            <Select.Item value="won">won</Select.Item>
            <Select.Item value="lost">lost</Select.Item>
          </Select.Content>
        </Select>
        <Input
          value={targetPos}
          onChange={(e) => setTargetPos(e.target.value)}
          placeholder="Target rank ≤ N"
          inputMode="numeric"
          className="md:col-span-2 text-xs"
        />
        <Input
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="Notes (optional)"
          className="md:col-span-3 text-xs"
        />
      </div>
    </div>
  )
}

/* ── row controls ─────────────────────────────────────────────────── */

const RowControls: React.FC<{
  row: KeywordTargetRow
  onChange: () => void
}> = ({ row, onChange }) => {
  const remove = useCallback(async () => {
    if (
      !confirm(
        `Delete target "${row.keyword}"${
          row.url ? ` → ${cleanPath(row.url)}` : ""
        }?`,
      )
    )
      return
    try {
      await deleteTarget(row.id)
      toast.success("Target deleted")
      onChange()
    } catch (err) {
      toast.error("Delete failed", { description: (err as Error).message })
    }
  }, [row, onChange])

  const cyclePriority = useCallback(async () => {
    const next = row.priority === 5 ? 1 : row.priority + 1
    try {
      await updateTarget(row.id, { priority: next })
      onChange()
    } catch (err) {
      toast.error("Update failed", { description: (err as Error).message })
    }
  }, [row, onChange])

  return (
    <div className="flex items-center gap-1">
      <Button variant="transparent" size="small" onClick={cyclePriority}>
        Cycle P
      </Button>
      <Button variant="transparent" size="small" onClick={remove}>
        <Trash className="h-3 w-3" />
      </Button>
    </div>
  )
}

/* ── bulk-import dialog ───────────────────────────────────────────── */

/**
 * Minimal CSV parser. Handles:
 *   - header line + N data lines
 *   - comma OR tab delimiters (auto-detected from header)
 *   - quoted fields with embedded commas / quotes
 *   - empty lines (skipped)
 *
 * Returns rows already shaped against the canonical BulkImportRow.
 * Unknown columns are silently ignored so operators can paste a
 * fuller spreadsheet without hand-trimming first.
 */
const ALLOWED_HEADERS = new Set([
  "keyword",
  "url",
  "priority",
  "notes",
  "keyword_group_id",
  "status",
  "target_position",
  "search_intent",
])

function parseCsv(input: string): {
  rows: BulkImportRow[]
  parseErrors: Array<{ line: number; error: string }>
} {
  const text = input.replace(/\r\n?/g, "\n").trim()
  if (!text) return { rows: [], parseErrors: [] }

  const lines: string[] = []
  let buf = ""
  let inQuote = false
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (ch === '"') {
      if (inQuote && text[i + 1] === '"') {
        buf += '"'
        i++
      } else {
        inQuote = !inQuote
      }
      continue
    }
    if (ch === "\n" && !inQuote) {
      lines.push(buf)
      buf = ""
      continue
    }
    buf += ch
  }
  if (buf.length > 0) lines.push(buf)

  const nonEmpty = lines.filter((l) => l.trim().length > 0)
  if (nonEmpty.length < 2) {
    return {
      rows: [],
      parseErrors: [{ line: 0, error: "Expected a header row + ≥1 data row" }],
    }
  }

  const headerLine = nonEmpty[0]
  const delim = headerLine.includes("\t") ? "\t" : ","
  const splitRow = (line: string): string[] => {
    const out: string[] = []
    let cur = ""
    let q = false
    for (let i = 0; i < line.length; i++) {
      const ch = line[i]
      if (ch === '"') {
        if (q && line[i + 1] === '"') {
          cur += '"'
          i++
        } else q = !q
        continue
      }
      if (ch === delim && !q) {
        out.push(cur)
        cur = ""
        continue
      }
      cur += ch
    }
    out.push(cur)
    return out.map((c) => c.trim())
  }

  const headers = splitRow(headerLine).map((h) => h.toLowerCase())
  const kwIdx = headers.indexOf("keyword")
  if (kwIdx < 0) {
    return {
      rows: [],
      parseErrors: [
        { line: 1, error: 'Header must include a "keyword" column' },
      ],
    }
  }

  const rows: BulkImportRow[] = []
  const parseErrors: Array<{ line: number; error: string }> = []
  for (let i = 1; i < nonEmpty.length; i++) {
    const cols = splitRow(nonEmpty[i])
    const obj: Record<string, string> = {}
    headers.forEach((h, hi) => {
      if (ALLOWED_HEADERS.has(h)) obj[h] = cols[hi] ?? ""
    })
    if (!obj.keyword || obj.keyword.length < 2) {
      parseErrors.push({ line: i + 1, error: "keyword missing or too short" })
      continue
    }
    const row: BulkImportRow = { keyword: obj.keyword }
    if (obj.url) row.url = obj.url
    if (obj.priority) {
      const p = Number(obj.priority)
      if (Number.isFinite(p) && p >= 1 && p <= 5) row.priority = p
      else parseErrors.push({ line: i + 1, error: "priority must be 1-5" })
    }
    if (obj.notes) row.notes = obj.notes
    if (obj.keyword_group_id) row.keyword_group_id = obj.keyword_group_id
    if (obj.status) {
      if (
        obj.status === "tracking" ||
        obj.status === "paused" ||
        obj.status === "won" ||
        obj.status === "lost"
      ) {
        row.status = obj.status
      } else {
        parseErrors.push({
          line: i + 1,
          error: "status must be tracking|paused|won|lost",
        })
      }
    }
    if (obj.target_position) {
      const tp = Number(obj.target_position)
      if (Number.isFinite(tp) && tp >= 1 && tp <= 100) row.target_position = tp
      else parseErrors.push({ line: i + 1, error: "target_position must be 1-100" })
    }
    if (obj.search_intent) {
      if (
        obj.search_intent === "informational" ||
        obj.search_intent === "navigational" ||
        obj.search_intent === "transactional" ||
        obj.search_intent === "commercial"
      ) {
        row.search_intent = obj.search_intent
      } else {
        parseErrors.push({
          line: i + 1,
          error: "search_intent must be informational|navigational|transactional|commercial",
        })
      }
    }
    rows.push(row)
  }
  return { rows, parseErrors }
}

const CSV_TEMPLATE = `keyword,url,priority,keyword_group_id,status,target_position,search_intent,notes
your primary keyword,https://your-domain.example/products/example-product,1,,tracking,3,transactional,top-3 BOFU
nse vs bse,,3,,tracking,,comparison,
how to choose a product,https://your-domain.example/guides/buying,2,,tracking,5,informational,TOFU primer`

const BulkImportDialog: React.FC<{
  open: boolean
  onOpenChange: (o: boolean) => void
  groups: KeywordGroupRow[]
  onImported: () => void
}> = ({ open, onOpenChange, onImported }) => {
  const [csv, setCsv] = useState("")
  const [parseErrors, setParseErrors] = useState<
    Array<{ line: number; error: string }>
  >([])
  const [parsed, setParsed] = useState<BulkImportRow[]>([])
  const [busy, setBusy] = useState(false)
  const [serverResult, setServerResult] = useState<BulkImportResult | null>(
    null,
  )

  const reset = useCallback(() => {
    setCsv("")
    setParseErrors([])
    setParsed([])
    setServerResult(null)
  }, [])

  useEffect(() => {
    if (!open) reset()
  }, [open, reset])

  const handleParse = useCallback(() => {
    const r = parseCsv(csv)
    setParsed(r.rows)
    setParseErrors(r.parseErrors)
    setServerResult(null)
  }, [csv])

  const handleImport = useCallback(async () => {
    if (parsed.length === 0) {
      toast.warning("No valid rows to import. Parse the CSV first.")
      return
    }
    setBusy(true)
    try {
      const result = await bulkImportTargets(parsed)
      setServerResult(result)
      const ok = result.inserted + result.updated
      if (ok > 0) {
        toast.success(
          `Imported ${result.inserted} new + ${result.updated} updated`,
          {
            description:
              result.errors.length > 0
                ? `${result.errors.length} rows failed — see preview.`
                : undefined,
          },
        )
        onImported()
      } else if (result.errors.length > 0) {
        toast.error(`All ${result.errors.length} rows failed`, {
          description: "Review the preview to fix the data.",
        })
      }
    } catch (err) {
      toast.error("Bulk import failed", {
        description: (err as Error).message,
      })
    } finally {
      setBusy(false)
    }
  }, [parsed, onImported])

  const usePreviewTemplate = useCallback(() => {
    setCsv(CSV_TEMPLATE)
    setParseErrors([])
    setParsed([])
    setServerResult(null)
  }, [])

  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <Drawer.Content>
        <Drawer.Header>
          <Drawer.Title>Bulk-import keywords from CSV</Drawer.Title>
          <Drawer.Description>
            Paste a CSV with a <code>keyword</code> column (required) plus
            any of: <code>url</code>, <code>priority</code> (1-5),{" "}
            <code>keyword_group_id</code>, <code>status</code>,{" "}
            <code>target_position</code> (1-100),{" "}
            <code>search_intent</code>, <code>notes</code>. Up to 5000
            rows per import.
          </Drawer.Description>
        </Drawer.Header>
        <Drawer.Body className="flex flex-col gap-4 overflow-y-auto">
          <div className="flex items-center justify-between gap-2">
            <Text size="small" weight="plus">
              CSV input
            </Text>
            <Button
              size="small"
              variant="transparent"
              onClick={usePreviewTemplate}
            >
              Insert sample
            </Button>
          </div>
          <Textarea
            rows={10}
            value={csv}
            onChange={(e) => setCsv(e.target.value)}
            placeholder={"keyword,url,priority,status\nfoo bar,https://...,1,tracking"}
            className="font-mono text-xs"
          />
          <div className="flex flex-wrap items-center gap-2">
            <Button size="small" onClick={handleParse} disabled={!csv.trim()}>
              Parse preview
            </Button>
            <Button
              size="small"
              variant="primary"
              onClick={handleImport}
              isLoading={busy}
              disabled={busy || parsed.length === 0}
            >
              <ArrowUpTray className="mr-1 h-3 w-3" />
              Import {parsed.length > 0 ? `${parsed.length} rows` : ""}
            </Button>
            {parsed.length > 0 && (
              <Text size="xsmall" className="text-ui-fg-muted">
                {parsed.length} parsed
                {parseErrors.length > 0
                  ? ` · ${parseErrors.length} parse errors`
                  : ""}
              </Text>
            )}
          </div>

          {parseErrors.length > 0 && (
            <div className="rounded-md border border-ui-tag-orange-border bg-ui-tag-orange-bg p-3">
              <Text size="small" weight="plus" className="text-ui-tag-orange-text">
                Parse errors
              </Text>
              <ul className="mt-1 list-disc pl-5 text-xs text-ui-tag-orange-text">
                {parseErrors.slice(0, 20).map((e, i) => (
                  <li key={i}>
                    Line {e.line}: {e.error}
                  </li>
                ))}
                {parseErrors.length > 20 && (
                  <li>+{parseErrors.length - 20} more…</li>
                )}
              </ul>
            </div>
          )}

          {parsed.length > 0 && (
            <div className="overflow-auto rounded-md border border-ui-border-base">
              <table className="w-full text-left text-xs">
                <thead className="bg-ui-bg-subtle">
                  <tr>
                    <th className="px-2 py-1 text-ui-fg-muted">#</th>
                    <th className="px-2 py-1 text-ui-fg-muted">keyword</th>
                    <th className="px-2 py-1 text-ui-fg-muted">URL</th>
                    <th className="px-2 py-1 text-ui-fg-muted">P</th>
                    <th className="px-2 py-1 text-ui-fg-muted">status</th>
                    <th className="px-2 py-1 text-ui-fg-muted">tgt</th>
                    <th className="px-2 py-1 text-ui-fg-muted">intent</th>
                  </tr>
                </thead>
                <tbody>
                  {parsed.slice(0, 50).map((r, i) => (
                    <tr key={i} className="border-t border-ui-border-base">
                      <td className="px-2 py-1 text-ui-fg-muted">{i + 1}</td>
                      <td className="px-2 py-1 font-mono">{r.keyword}</td>
                      <td className="px-2 py-1 font-mono text-ui-fg-muted">
                        {r.url ? cleanPath(r.url) : "—"}
                      </td>
                      <td className="px-2 py-1">{r.priority ?? "—"}</td>
                      <td className="px-2 py-1">{r.status ?? "tracking"}</td>
                      <td className="px-2 py-1">{r.target_position ?? "—"}</td>
                      <td className="px-2 py-1">{r.search_intent ?? "—"}</td>
                    </tr>
                  ))}
                  {parsed.length > 50 && (
                    <tr>
                      <td
                        colSpan={7}
                        className="px-2 py-1 text-center text-ui-fg-muted"
                      >
                        +{parsed.length - 50} more rows (will be imported)
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          )}

          {serverResult && (
            <div
              className={`rounded-md border p-3 ${
                serverResult.errors.length === 0
                  ? "border-ui-tag-green-border bg-ui-tag-green-bg"
                  : "border-ui-tag-orange-border bg-ui-tag-orange-bg"
              }`}
            >
              <Text
                size="small"
                weight="plus"
                className={
                  serverResult.errors.length === 0
                    ? "text-ui-tag-green-text"
                    : "text-ui-tag-orange-text"
                }
              >
                Import result
              </Text>
              <Text size="xsmall" className="text-ui-fg-muted">
                {serverResult.inserted} inserted · {serverResult.updated} updated
                · {serverResult.errors.length} errors
              </Text>
              {serverResult.errors.length > 0 && (
                <ul className="mt-1 list-disc pl-5 text-xs text-ui-tag-orange-text">
                  {serverResult.errors.slice(0, 20).map((e, i) => (
                    <li key={i}>
                      Row {e.index + 1}
                      {e.keyword ? ` (${e.keyword})` : ""}: {e.error}
                    </li>
                  ))}
                  {serverResult.errors.length > 20 && (
                    <li>+{serverResult.errors.length - 20} more…</li>
                  )}
                </ul>
              )}
            </div>
          )}
        </Drawer.Body>
        <Drawer.Footer>
          <Button variant="secondary" onClick={() => onOpenChange(false)}>
            Close
          </Button>
        </Drawer.Footer>
      </Drawer.Content>
    </Drawer>
  )
}

/* ── per-target detail drawer ─────────────────────────────────────── */

const INTENT_VALUES_UI: SearchIntent[] = [
  "informational",
  "navigational",
  "transactional",
  "commercial",
]

/**
 * Compact rank-trend sparkline. Pure SVG; no charting lib. Y-axis is
 * inverted (rank 1 at top). Missing days break the line so a gap
 * tells the operator "we didn't have a snapshot that day" rather than
 * a fake interpolation.
 */
const RankSparkline: React.FC<{
  series: KwPerfPoint[]
  width?: number
  height?: number
}> = ({ series, width = 360, height = 80 }) => {
  const points = series
    .filter((p) => p.position != null)
    .map((p) => ({ date: p.date, position: p.position as number }))
  if (points.length < 2) {
    return (
      <Text size="xsmall" className="text-ui-fg-muted">
        Not enough snapshots yet to draw a trend.
      </Text>
    )
  }
  const minPos = Math.min(...points.map((p) => p.position))
  const maxPos = Math.max(...points.map((p) => p.position))
  const span = Math.max(1, maxPos - minPos)
  const stepX = width / (points.length - 1)
  const yFor = (pos: number) =>
    height - 8 - ((maxPos - pos) / span) * (height - 16)
  const path = points
    .map((p, i) => `${i === 0 ? "M" : "L"}${(i * stepX).toFixed(1)},${yFor(p.position).toFixed(1)}`)
    .join(" ")
  return (
    <svg width={width} height={height} className="overflow-visible">
      <text x={0} y={10} fontSize={10} fill="currentColor" className="text-ui-fg-muted">
        #{maxPos.toFixed(1)} (worst)
      </text>
      <text x={0} y={height - 1} fontSize={10} fill="currentColor" className="text-ui-fg-muted">
        #{minPos.toFixed(1)} (best)
      </text>
      <path
        d={path}
        fill="none"
        stroke="currentColor"
        strokeWidth={1.5}
        className="text-ui-fg-base"
      />
      {points.map((p, i) => (
        <circle
          key={p.date}
          cx={(i * stepX).toFixed(1)}
          cy={yFor(p.position).toFixed(1)}
          r={1.5}
          fill="currentColor"
          className="text-ui-fg-base"
        >
          <title>{`${p.date}: rank ${p.position.toFixed(1)}`}</title>
        </circle>
      ))}
    </svg>
  )
}

const KeywordDetailDrawer: React.FC<{
  row: KeywordTargetRow | null
  groups: KeywordGroupRow[]
  onClose: () => void
  onChange: () => void
}> = ({ row, groups, onClose, onChange }) => {
  const [perf, setPerf] = useState<KwPerfResp | null>(null)
  const [perfLoading, setPerfLoading] = useState(false)
  const [windowDays, setWindowDays] = useState<number>(90)
  // Phase I — per-engine selector inside the drawer. Defaults to GSC
  // since it's the only engine guaranteed to have data today; flips
  // automatically when a target only has data from a non-GSC engine.
  const [engine, setEngine] = useState<string>("gsc")
  const [notesDraft, setNotesDraft] = useState<string>("")
  const [savingNotes, setSavingNotes] = useState(false)
  const [intentDraft, setIntentDraft] = useState<SearchIntent | "">("")
  const [savingIntent, setSavingIntent] = useState(false)

  const loadPerf = useCallback(
    async (id: string, w: number) => {
      setPerfLoading(true)
      try {
        const r = await loadKeywordPerformance(id, w)
        setPerf(r)
      } catch (err) {
        toast.error("Rank trend load failed", {
          description: (err as Error).message,
        })
      } finally {
        setPerfLoading(false)
      }
    },
    [],
  )

  useEffect(() => {
    if (!row) {
      setPerf(null)
      setNotesDraft("")
      setIntentDraft("")
      return
    }
    setNotesDraft(row.notes ?? "")
    setIntentDraft((row.search_intent as SearchIntent | undefined) ?? "")
    loadPerf(row.id, windowDays)
  }, [row, loadPerf, windowDays])

  // Pick a sensible default engine on each refresh — prefer GSC if it
  // has data, otherwise the first engine that does. Avoids the empty-
  // chart state when a target only has Bing/Yandex coverage.
  useEffect(() => {
    if (!perf?.engines || perf.engines.length === 0) return
    if (!perf.engines.includes(engine)) {
      setEngine(perf.engines.includes("gsc") ? "gsc" : perf.engines[0])
    }
  }, [perf, engine])

  // Resolve which series to render. For the GSC-only legacy response
  // shape, falls back to `perf.series` so the drawer still works
  // against older API outputs.
  const activeSeries: KwPerfPoint[] = useMemo(() => {
    if (perf?.by_engine && perf.by_engine[engine]) {
      return perf.by_engine[engine].series
    }
    return perf?.series ?? []
  }, [perf, engine])

  const activeLatest: KwPerfPoint | null = useMemo(() => {
    if (perf?.by_engine && perf.by_engine[engine]) {
      return perf.by_engine[engine].latest
    }
    return perf?.latest ?? null
  }, [perf, engine])

  const saveNotes = useCallback(async () => {
    if (!row) return
    setSavingNotes(true)
    try {
      await updateTarget(row.id, { notes: notesDraft.trim() || null })
      toast.success("Notes saved")
      onChange()
    } catch (err) {
      toast.error("Save failed", { description: (err as Error).message })
    } finally {
      setSavingNotes(false)
    }
  }, [row, notesDraft, onChange])

  const saveIntent = useCallback(async () => {
    if (!row || !intentDraft) return
    setSavingIntent(true)
    try {
      await setKeywordIntent(row.id, intentDraft as SearchIntent)
      toast.success(`Intent override → ${intentDraft}`)
      onChange()
    } catch (err) {
      toast.error("Intent override failed", {
        description: (err as Error).message,
      })
    } finally {
      setSavingIntent(false)
    }
  }, [row, intentDraft, onChange])

  const toggleActive = useCallback(
    async (next: boolean) => {
      if (!row) return
      try {
        await updateTarget(row.id, { is_active: next })
        toast.success(`Target ${next ? "activated" : "paused"}`)
        onChange()
      } catch (err) {
        toast.error("Toggle failed", { description: (err as Error).message })
      }
    },
    [row, onChange],
  )

  const groupName = useMemo(() => {
    if (!row?.keyword_group_id) return null
    return groups.find((g) => g.id === row.keyword_group_id)?.name ?? null
  }, [row, groups])

  return (
    <Drawer open={!!row} onOpenChange={(o) => !o && onClose()}>
      <Drawer.Content>
        <Drawer.Header>
          <Drawer.Title className="flex items-center gap-2">
            <span className="font-mono">{row?.keyword}</span>
            {row && <StatusBadge status={row.status} />}
          </Drawer.Title>
          <Drawer.Description>
            {row?.url ? (
              <a
                href={row.url}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 text-ui-fg-base hover:underline"
              >
                <span className="font-mono">{cleanPath(row.url)}</span>
                <ArrowUpRightOnBox className="h-3 w-3" />
              </a>
            ) : (
              <span className="text-ui-fg-muted">No target URL set</span>
            )}
            {groupName && (
              <Badge color="grey" size="2xsmall" className="ml-2">
                {groupName}
              </Badge>
            )}
          </Drawer.Description>
        </Drawer.Header>
        <Drawer.Body className="flex flex-col gap-6 overflow-y-auto">
          {!row ? null : (
            <>
              {/* Rank trend */}
              <section className="flex flex-col gap-2">
                <div className="flex items-center justify-between">
                  <Text size="small" weight="plus">
                    Rank trend
                  </Text>
                  <div className="flex items-center gap-2">
                    <Select
                      value={String(windowDays)}
                      onValueChange={(v) => setWindowDays(Number(v) || 90)}
                    >
                      <Select.Trigger className="w-32">
                        <Select.Value />
                      </Select.Trigger>
                      <Select.Content>
                        <Select.Item value="28">28 days</Select.Item>
                        <Select.Item value="90">90 days</Select.Item>
                        <Select.Item value="180">180 days</Select.Item>
                        <Select.Item value="365">365 days</Select.Item>
                      </Select.Content>
                    </Select>
                    <Button
                      size="small"
                      variant="transparent"
                      onClick={() => loadPerf(row.id, windowDays)}
                      disabled={perfLoading}
                    >
                      {perfLoading ? "Refreshing…" : "Refresh"}
                    </Button>
                  </div>
                </div>
                {perf ? (
                  <div className="rounded-md border border-ui-border-base p-3">
                    {/* Engine pill row — only renders when the backend
                        reports ≥2 engines with data. Single-engine
                        keywords (the common case today) stay clean. */}
                    {perf.engines && perf.engines.length > 1 && (
                      <div className="mb-3 flex flex-wrap items-center gap-1.5">
                        <Text
                          size="xsmall"
                          className="text-ui-fg-muted mr-1"
                        >
                          Engine:
                        </Text>
                        {perf.engines.map((eng) => (
                          <button
                            key={eng}
                            type="button"
                            onClick={() => setEngine(eng)}
                            className={
                              "rounded-full border px-2 py-0.5 text-[10px] uppercase " +
                              (engine === eng
                                ? "border-ui-border-interactive bg-ui-bg-highlight text-ui-fg-base"
                                : "border-ui-border-base text-ui-fg-muted hover:bg-ui-bg-base-hover")
                            }
                          >
                            {eng}
                          </button>
                        ))}
                      </div>
                    )}
                    <RankSparkline series={activeSeries} />
                    <div className="mt-3 grid grid-cols-2 gap-2 text-xs md:grid-cols-4">
                      <DrawerStat
                        label="Latest rank"
                        value={
                          activeLatest?.position?.toFixed(1) ?? "—"
                        }
                      />
                      <DrawerStat
                        label="Latest clicks"
                        value={activeLatest?.clicks?.toString() ?? "—"}
                      />
                      <DrawerStat
                        label="Latest impressions"
                        value={
                          activeLatest?.impressions?.toString() ?? "—"
                        }
                      />
                      <DrawerStat
                        label="Latest CTR"
                        value={
                          activeLatest?.ctr != null
                            ? `${(activeLatest.ctr * 100).toFixed(2)}%`
                            : "—"
                        }
                      />
                    </div>
                  </div>
                ) : perfLoading ? (
                  <Text size="xsmall" className="text-ui-fg-muted">
                    Loading…
                  </Text>
                ) : (
                  <Text size="xsmall" className="text-ui-fg-muted">
                    No snapshot data.
                  </Text>
                )}
              </section>

              {/* Active toggle */}
              <section className="flex items-center gap-3 rounded-md border border-ui-border-base p-3">
                <Switch
                  id={`active_${row.id}`}
                  checked={row.is_active}
                  onCheckedChange={(c) => toggleActive(!!c)}
                />
                <div>
                  <Label htmlFor={`active_${row.id}`}>Active</Label>
                  <Text size="xsmall" className="text-ui-fg-muted">
                    Inactive targets stay in the table but are skipped by
                    the daily snapshot rollup.
                  </Text>
                </div>
              </section>

              {/* Intent override */}
              <section className="flex flex-col gap-2">
                <Text size="small" weight="plus">
                  Search intent
                </Text>
                <Text size="xsmall" className="text-ui-fg-muted">
                  Currently <IntentChip intent={row.search_intent} />. The
                  classifier sets this from keyword text on edit — pick a
                  value here to override until the next manual reclassify.
                </Text>
                <div className="flex items-center gap-2">
                  <Select
                    value={intentDraft}
                    onValueChange={(v) => setIntentDraft(v as SearchIntent)}
                  >
                    <Select.Trigger className="w-48">
                      <Select.Value placeholder="Pick intent" />
                    </Select.Trigger>
                    <Select.Content>
                      {INTENT_VALUES_UI.map((iv) => (
                        <Select.Item key={iv} value={iv}>
                          {iv}
                        </Select.Item>
                      ))}
                    </Select.Content>
                  </Select>
                  <Button
                    size="small"
                    onClick={saveIntent}
                    disabled={
                      !intentDraft ||
                      savingIntent ||
                      intentDraft === row.search_intent
                    }
                    isLoading={savingIntent}
                  >
                    Override
                  </Button>
                </div>
              </section>

              {/* Notes */}
              <section className="flex flex-col gap-2">
                <Text size="small" weight="plus">
                  Notes
                </Text>
                <Textarea
                  rows={3}
                  value={notesDraft}
                  onChange={(e) => setNotesDraft(e.target.value)}
                  placeholder="What's special about this target?"
                />
                <div className="flex justify-end">
                  <Button
                    size="small"
                    onClick={saveNotes}
                    disabled={savingNotes || (notesDraft ?? "") === (row.notes ?? "")}
                    isLoading={savingNotes}
                  >
                    Save notes
                  </Button>
                </div>
              </section>

              {/* Danger zone */}
              <section className="flex flex-col gap-2 rounded-md border border-ui-tag-red-border bg-ui-tag-red-bg p-3">
                <Text size="small" weight="plus" className="text-ui-tag-red-text">
                  Delete target
                </Text>
                <Text size="xsmall" className="text-ui-tag-red-text">
                  Soft-delete. Historic snapshots remain in the perf
                  table; no rows are physically removed.
                </Text>
                <div className="flex justify-end">
                  <Button
                    size="small"
                    variant="danger"
                    onClick={async () => {
                      if (!confirm(`Delete target "${row.keyword}"?`)) return
                      try {
                        await deleteTarget(row.id)
                        toast.success("Target deleted")
                        onChange()
                        onClose()
                      } catch (err) {
                        toast.error("Delete failed", {
                          description: (err as Error).message,
                        })
                      }
                    }}
                  >
                    <Trash className="mr-1 h-3 w-3" />
                    Delete
                  </Button>
                </div>
              </section>
            </>
          )}
        </Drawer.Body>
        <Drawer.Footer>
          <Button variant="secondary" onClick={onClose}>
            Close
          </Button>
        </Drawer.Footer>
      </Drawer.Content>
    </Drawer>
  )
}

const DrawerStat: React.FC<{ label: string; value: string }> = ({
  label,
  value,
}) => (
  <div className="flex flex-col">
    <Text size="xsmall" className="text-ui-fg-muted">
      {label}
    </Text>
    <span className="font-mono text-ui-fg-base">{value}</span>
  </div>
)

/* ── main ─────────────────────────────────────────────────────────── */

type SortKey =
  | "priority"
  | "url"
  | "keyword"
  | "position"
  | "clicks"
  | "impressions"
  | "status"
  | "group"

const KeywordsTab: React.FC = () => {
  const [rows, setRows] = useState<KeywordTargetRow[]>([])
  const [groups, setGroups] = useState<KeywordGroupRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [urlFilter, setUrlFilter] = useState("")
  const [groupFilter, setGroupFilter] = useState<string>("__all__")
  const [statusFilter, setStatusFilter] = useState<string>("__all__")
  const [sortKey, setSortKey] = useState<SortKey>("priority")
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc")
  // Phase C — multi-select + dialog + drawer state
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [bulkOpen, setBulkOpen] = useState(false)
  const [detailRow, setDetailRow] = useState<KeywordTargetRow | null>(null)
  const [bulkGroupValue, setBulkGroupValue] = useState<string>("__none__")
  const [bulkBusy, setBulkBusy] = useState(false)

  const refresh = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [t, g] = await Promise.all([loadTargets(), loadKeywordGroups()])
      setRows(t)
      setGroups(g)
      // Drop any selection that points to a now-missing target so the
      // bulk toolbar count doesn't go stale after a delete.
      setSelected((prev) => {
        const live = new Set(t.map((r) => r.id))
        const next = new Set<string>()
        for (const id of prev) if (live.has(id)) next.add(id)
        return next
      })
      // Keep an open drawer hydrated against the freshly fetched row.
      setDetailRow((prev) =>
        prev ? (t.find((r) => r.id === prev.id) ?? null) : null,
      )
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    refresh()
  }, [refresh])

  const groupNameById = useMemo(() => {
    const m = new Map<string, string>()
    for (const g of groups) m.set(g.id, g.name)
    return m
  }, [groups])

  const filtered = useMemo(() => {
    let r = rows
    if (urlFilter.trim()) {
      const f = urlFilter.toLowerCase()
      r = r.filter(
        (row) =>
          row.keyword.toLowerCase().includes(f) ||
          (row.url ?? "").toLowerCase().includes(f),
      )
    }
    if (groupFilter !== "__all__") {
      r = r.filter((row) =>
        groupFilter === "__none__"
          ? row.keyword_group_id == null
          : row.keyword_group_id === groupFilter,
      )
    }
    if (statusFilter !== "__all__") {
      r = r.filter((row) => row.status === statusFilter)
    }
    return [...r].sort((a, b) => {
      let cmp = 0
      switch (sortKey) {
        case "priority":
          cmp = a.priority - b.priority
          if (cmp === 0) cmp = a.keyword.localeCompare(b.keyword)
          break
        case "url":
          cmp = (a.url ?? "").localeCompare(b.url ?? "")
          break
        case "keyword":
          cmp = a.keyword.localeCompare(b.keyword)
          break
        case "position":
          cmp = (a.position ?? 999) - (b.position ?? 999)
          break
        case "clicks":
          cmp = (a.clicks ?? 0) - (b.clicks ?? 0)
          break
        case "impressions":
          cmp = (a.impressions ?? 0) - (b.impressions ?? 0)
          break
        case "status":
          cmp = a.status.localeCompare(b.status)
          break
        case "group":
          cmp = (groupNameById.get(a.keyword_group_id ?? "") ?? "~").localeCompare(
            groupNameById.get(b.keyword_group_id ?? "") ?? "~",
          )
          break
      }
      return sortDir === "asc" ? cmp : -cmp
    })
  }, [rows, urlFilter, groupFilter, statusFilter, sortKey, sortDir, groupNameById])

  const summary = useMemo(() => {
    const total = rows.length
    const ranked = rows.filter((r) => r.position != null).length
    const top10 = rows.filter((r) => r.position != null && r.position <= 10)
      .length
    const top3 = rows.filter((r) => r.position != null && r.position <= 3)
      .length
    const won = rows.filter((r) => r.status === "won").length
    return { total, ranked, top10, top3, won }
  }, [rows])

  // Visible-row IDs feed "select all visible" + drop-on-filter behaviour.
  const visibleIds = useMemo(() => new Set(filtered.map((r) => r.id)), [filtered])
  const allVisibleSelected = useMemo(() => {
    if (filtered.length === 0) return false
    for (const r of filtered) if (!selected.has(r.id)) return false
    return true
  }, [filtered, selected])
  const someSelected = selected.size > 0

  const toggleOne = useCallback((id: string, checked: boolean) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (checked) next.add(id)
      else next.delete(id)
      return next
    })
  }, [])

  const toggleAllVisible = useCallback(
    (checked: boolean) => {
      setSelected((prev) => {
        const next = new Set(prev)
        for (const id of visibleIds) {
          if (checked) next.add(id)
          else next.delete(id)
        }
        return next
      })
    },
    [visibleIds],
  )

  const clearSelection = useCallback(() => setSelected(new Set()), [])

  const doBulkMove = useCallback(async () => {
    if (selected.size === 0) return
    setBulkBusy(true)
    try {
      const groupId =
        bulkGroupValue === "__none__" ? null : bulkGroupValue
      const ids = Array.from(selected)
      const r = await bulkMoveTargets(ids, groupId)
      toast.success(`Moved ${r.moved} target${r.moved === 1 ? "" : "s"}`, {
        description: groupId
          ? `→ ${groups.find((g) => g.id === groupId)?.name ?? groupId}`
          : "→ Ungrouped",
      })
      clearSelection()
      await refresh()
    } catch (err) {
      toast.error("Bulk move failed", {
        description: (err as Error).message,
      })
    } finally {
      setBulkBusy(false)
    }
  }, [selected, bulkGroupValue, groups, refresh, clearSelection])

  const doBulkDelete = useCallback(async () => {
    if (selected.size === 0) return
    if (
      !confirm(
        `Soft-delete ${selected.size} keyword target${
          selected.size === 1 ? "" : "s"
        }? Snapshots are preserved.`,
      )
    )
      return
    setBulkBusy(true)
    const ids = Array.from(selected)
    let ok = 0
    let fail = 0
    // Sequential to keep server load predictable and surface partial
    // failures clearly (Promise.allSettled would, but the per-row trip
    // is fast enough that serial is fine for the 2000-row cap).
    for (const id of ids) {
      try {
        await deleteTarget(id)
        ok++
      } catch {
        fail++
      }
    }
    setBulkBusy(false)
    if (ok > 0) {
      toast.success(`Deleted ${ok} target${ok === 1 ? "" : "s"}`, {
        description: fail > 0 ? `${fail} failed` : undefined,
      })
    } else {
      toast.error("Bulk delete failed", {
        description: "No rows were removed.",
      })
    }
    clearSelection()
    await refresh()
  }, [selected, refresh, clearSelection])

  const onSortClick = (k: SortKey) => {
    if (sortKey === k) {
      setSortDir(sortDir === "asc" ? "desc" : "asc")
    } else {
      setSortKey(k)
      setSortDir(
        k === "priority" ||
          k === "position" ||
          k === "url" ||
          k === "keyword" ||
          k === "status" ||
          k === "group"
          ? "asc"
          : "desc",
      )
    }
  }

  return (
    <section className="flex flex-col gap-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <Heading level="h2">Target keywords</Heading>
          <Text size="small" className="text-ui-fg-muted">
            Phase 1: keywords are now grouped, status-tracked, and
            optionally tied to a target rank. Performance numbers come
            from the daily snapshot rollup at 02:00 IST, with a fallback
            to the GSC 28-day dimension rollup for un-snapshotted
            targets.
          </Text>
        </div>
        <div className="flex items-center gap-2">
          <Input
            value={urlFilter}
            onChange={(e) => setUrlFilter(e.target.value)}
            placeholder="Filter keyword or URL..."
            className="max-w-xs"
          />
          <Select value={groupFilter} onValueChange={setGroupFilter}>
            <Select.Trigger className="w-44">
              <Select.Value placeholder="Group" />
            </Select.Trigger>
            <Select.Content>
              <Select.Item value="__all__">All groups</Select.Item>
              <Select.Item value="__none__">Ungrouped</Select.Item>
              {groups.map((g) => (
                <Select.Item key={g.id} value={g.id}>
                  {g.name}
                </Select.Item>
              ))}
            </Select.Content>
          </Select>
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <Select.Trigger className="w-36">
              <Select.Value placeholder="Status" />
            </Select.Trigger>
            <Select.Content>
              <Select.Item value="__all__">Any status</Select.Item>
              <Select.Item value="tracking">tracking</Select.Item>
              <Select.Item value="paused">paused</Select.Item>
              <Select.Item value="won">won</Select.Item>
              <Select.Item value="lost">lost</Select.Item>
            </Select.Content>
          </Select>
          <Button
            variant="secondary"
            size="small"
            onClick={() => setBulkOpen(true)}
          >
            <ArrowUpTray className="mr-1 h-3 w-3" />
            Import CSV
          </Button>
          <Button variant="transparent" size="small" onClick={refresh} disabled={loading}>
            {loading ? "Loading…" : "Refresh"}
          </Button>
        </div>
      </div>

      {/* Bulk-select toolbar — appears when ≥1 row is checked. */}
      {someSelected && (
        <div className="flex flex-wrap items-center gap-3 rounded-md border border-ui-border-base bg-ui-bg-subtle px-3 py-2">
          <Text size="small" weight="plus">
            {selected.size} selected
          </Text>
          <span className="text-ui-fg-muted">·</span>
          <div className="flex items-center gap-2">
            <Text size="xsmall" className="text-ui-fg-muted">
              Move to
            </Text>
            <Select value={bulkGroupValue} onValueChange={setBulkGroupValue}>
              <Select.Trigger className="w-48">
                <Select.Value placeholder="Group" />
              </Select.Trigger>
              <Select.Content>
                <Select.Item value="__none__">Ungrouped</Select.Item>
                {groups.map((g) => (
                  <Select.Item key={g.id} value={g.id}>
                    {g.name}
                  </Select.Item>
                ))}
              </Select.Content>
            </Select>
            <Button
              size="small"
              onClick={doBulkMove}
              isLoading={bulkBusy}
              disabled={bulkBusy}
            >
              Apply
            </Button>
          </div>
          <span className="text-ui-fg-muted">·</span>
          <Button
            size="small"
            variant="danger"
            onClick={doBulkDelete}
            isLoading={bulkBusy}
            disabled={bulkBusy}
          >
            <Trash className="mr-1 h-3 w-3" />
            Delete selected
          </Button>
          <Button
            size="small"
            variant="transparent"
            onClick={clearSelection}
            disabled={bulkBusy}
          >
            <XMark className="mr-1 h-3 w-3" />
            Clear
          </Button>
        </div>
      )}

      {error && (
        <div className="rounded-md border border-ui-tag-red-border bg-ui-tag-red-bg p-3">
          <Text size="small" className="text-ui-tag-red-text">
            {error}
          </Text>
        </div>
      )}

      {/* Summary */}
      <div className="flex flex-wrap items-stretch gap-3">
        <StatCard label="Total targets" value={summary.total} tone="grey" />
        <StatCard
          label="Ranked anywhere"
          value={summary.ranked}
          tone="grey"
          total={summary.total}
        />
        <StatCard
          label="Top 10"
          value={summary.top10}
          tone="orange"
          total={summary.total}
        />
        <StatCard
          label="Top 3"
          value={summary.top3}
          tone="green"
          total={summary.total}
        />
        <StatCard
          label="Won"
          value={summary.won}
          tone="green"
          total={summary.total}
        />
      </div>

      {/* Funnel-stage intent mix (Phase 8.D) */}
      <IntentMixPanel refreshKey={rows.length} />

      <AddForm groups={groups} onCreated={refresh} />

      <div className="overflow-hidden rounded-md border border-ui-border-base">
        <table className="w-full border-collapse text-left text-xs">
          <thead className="bg-ui-bg-subtle">
            <tr>
              <th className="px-3 py-2 w-8">
                <input
                  type="checkbox"
                  checked={allVisibleSelected}
                  ref={(el) => {
                    if (el)
                      el.indeterminate =
                        !allVisibleSelected && someSelected && filtered.length > 0
                  }}
                  onChange={(e) => toggleAllVisible(e.target.checked)}
                  aria-label="Select all visible"
                />
              </th>
              <Th onClick={() => onSortClick("priority")} active={sortKey === "priority"} dir={sortDir} label="P" />
              <Th onClick={() => onSortClick("keyword")} active={sortKey === "keyword"} dir={sortDir} label="Keyword" />
              <Th onClick={() => onSortClick("group")} active={sortKey === "group"} dir={sortDir} label="Group" />
              <Th onClick={() => onSortClick("status")} active={sortKey === "status"} dir={sortDir} label="Status" />
              <th className="px-3 py-2 font-semibold text-ui-fg-muted">Intent</th>
              <Th onClick={() => onSortClick("url")} active={sortKey === "url"} dir={sortDir} label="Target URL" />
              <Th onClick={() => onSortClick("position")} active={sortKey === "position"} dir={sortDir} label="Rank" alignRight />
              <Th onClick={() => onSortClick("clicks")} active={sortKey === "clicks"} dir={sortDir} label="Clicks (28d)" alignRight />
              <Th onClick={() => onSortClick("impressions")} active={sortKey === "impressions"} dir={sortDir} label="Impressions (28d)" alignRight />
              <th className="px-3 py-2 font-semibold text-ui-fg-muted text-right">CTR</th>
              <th className="px-3 py-2 font-semibold text-ui-fg-muted"></th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={12} className="px-3 py-6 text-center">
                  <Text size="small" className="text-ui-fg-muted">
                    {rows.length === 0
                      ? "No keyword targets yet. Use the form above to add your first."
                      : "No targets match the filter."}
                  </Text>
                </td>
              </tr>
            ) : (
              filtered.map((r) => (
                <tr
                  key={r.id}
                  className={
                    "border-t border-ui-border-base cursor-pointer hover:bg-ui-bg-base-hover " +
                    (selected.has(r.id) ? "bg-ui-bg-highlight" : "")
                  }
                  onClick={() => setDetailRow(r)}
                >
                  <td
                    className="px-3 py-2"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <input
                      type="checkbox"
                      checked={selected.has(r.id)}
                      onChange={(e) => toggleOne(r.id, e.target.checked)}
                      aria-label={`Select ${r.keyword}`}
                    />
                  </td>
                  <td className="px-3 py-2">
                    <PriorityBadge priority={r.priority} />
                  </td>
                  <td className="px-3 py-2 font-mono text-ui-fg-base">
                    {r.keyword}
                  </td>
                  <td className="px-3 py-2">
                    {r.keyword_group_id ? (
                      <Badge color="grey" size="2xsmall">
                        {groupNameById.get(r.keyword_group_id) ?? "(?)"}
                      </Badge>
                    ) : (
                      <Text size="xsmall" className="text-ui-fg-muted">
                        ungrouped
                      </Text>
                    )}
                  </td>
                  <td className="px-3 py-2">
                    <StatusBadge status={r.status} />
                  </td>
                  <td className="px-3 py-2">
                    <IntentChip intent={r.search_intent} />
                  </td>
                  <td
                    className="px-3 py-2"
                    onClick={(e) => e.stopPropagation()}
                  >
                    {r.url ? (
                      <a
                        href={r.url}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1 text-ui-fg-base underline-offset-2 hover:underline"
                      >
                        <span className="font-mono">{cleanPath(r.url)}</span>
                        <ArrowUpRightOnBox className="h-3 w-3" />
                      </a>
                    ) : (
                      <Text size="xsmall" className="text-ui-fg-muted">
                        unassigned
                      </Text>
                    )}
                  </td>
                  <td className="px-3 py-2 text-right">
                    <PositionCell
                      position={r.position}
                      target={r.target_position}
                    />
                  </td>
                  <td className="px-3 py-2 text-right font-mono">
                    {r.clicks ?? "—"}
                  </td>
                  <td className="px-3 py-2 text-right font-mono">
                    {r.impressions ?? "—"}
                  </td>
                  <td className="px-3 py-2 text-right font-mono">
                    {r.ctr != null ? `${(r.ctr * 100).toFixed(2)}%` : "—"}
                  </td>
                  <td
                    className="px-3 py-2"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <RowControls row={r} onChange={refresh} />
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <BulkImportDialog
        open={bulkOpen}
        onOpenChange={setBulkOpen}
        groups={groups}
        onImported={refresh}
      />
      <KeywordDetailDrawer
        row={detailRow}
        groups={groups}
        onClose={() => setDetailRow(null)}
        onChange={refresh}
      />
    </section>
  )
}

const Th: React.FC<{
  label: string
  onClick: () => void
  active: boolean
  dir: "asc" | "desc"
  alignRight?: boolean
}> = ({ label, onClick, active, dir, alignRight }) => (
  <th
    onClick={onClick}
    className={
      "cursor-pointer select-none px-3 py-2 font-semibold text-ui-fg-muted " +
      (alignRight ? "text-right" : "")
    }
  >
    {label} {active ? (dir === "asc" ? "↑" : "↓") : ""}
  </th>
)

const StatCard: React.FC<{
  label: string
  value: number
  tone: "green" | "orange" | "red" | "grey"
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

export default KeywordsTab
