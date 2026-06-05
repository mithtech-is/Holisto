import React, { useCallback, useEffect, useMemo, useState } from "react"
import {
  Badge,
  Button,
  Heading,
  Input,
  Select,
  Text,
  Textarea,
  toast,
} from "@medusajs/ui"
import {
  ArrowPathMini,
  ChevronDown,
  ChevronRight,
  Plus,
  Trash,
  CheckCircleSolid,
  XMarkMini,
} from "@medusajs/icons"

/**
 * AI citation tracker tab — `/app/ovo?tab=ai-citations`.
 *
 * Layout (top → bottom):
 *   1. Header + "Run all prompts now" button + summary chips.
 *   2. Per-prompt × per-provider matrix. Each cell shows the latest
 *      citation: green dot = mentions the brand, red dot = doesn't,
 *      grey = no run yet. Cell click → drill-down panel with the
 *      raw answer, extracted signals, competitor mentions list.
 *   3. Prompt manager — list with edit / toggle-active / delete +
 *      "Add new prompt" form at the bottom.
 *
 * Backed by:
 *   GET  /admin/ovo/ai/prompts             - prompt list
 *   POST /admin/ovo/ai/prompts             - add prompt
 *   PATCH/DELETE /admin/ovo/ai/prompts/:id - edit/remove
 *   GET  /admin/ovo/ai/citations           - latest answers
 *   POST /admin/ovo/ai/run                 - manual fire (all or one)
 *
 * The "what's the cost?" question is answered upfront in the header
 * copy so an ops person doesn't have to wonder before clicking "Run".
 */

type AiPrompt = {
  id: string
  prompt: string
  category: string | null
  active: boolean
  notes: string | null
  created_at: string
  updated_at: string
}

type AiProvider = "openai" | "anthropic" | "perplexity" | "gemini"

type AiCitation = {
  id: string
  prompt_id: string
  prompt_text: string
  provider: AiProvider
  model_name: string
  answer: string
  latency_ms: number
  mentions_brand: boolean
  links_brand: boolean
  competitor_mentions: string[] | null
  sentiment: "positive" | "neutral" | "negative" | null
  position: number | null
  raw_response: unknown
  captured_at: string
}

const PROVIDERS: AiProvider[] = ["openai", "anthropic", "perplexity", "gemini"]
const PROVIDER_LABEL: Record<AiProvider, string> = {
  openai: "OpenAI",
  anthropic: "Anthropic",
  perplexity: "Perplexity",
  gemini: "Gemini",
}

const PROMPTS_API = "/admin/ovo/ai/prompts"
const CITATIONS_API = "/admin/ovo/ai/citations"
const RUN_API = "/admin/ovo/ai/run"

/* ── data layer ───────────────────────────────────────────────────── */

async function loadPrompts(): Promise<AiPrompt[]> {
  const r = await fetch(PROMPTS_API, { credentials: "include" })
  if (!r.ok) {
    const e = (await r.json().catch(() => ({}))) as { message?: string }
    throw new Error(e.message || `Prompts load failed (${r.status})`)
  }
  return ((await r.json()) as { rows: AiPrompt[] }).rows
}

async function loadCitations(): Promise<AiCitation[]> {
  // Last 1000 citations across the last 90 days — plenty for the
  // per-(prompt, provider) latest matrix; older rows get pruned by
  // the service automatically.
  const r = await fetch(`${CITATIONS_API}?limit=1000`, {
    credentials: "include",
  })
  if (!r.ok) {
    const e = (await r.json().catch(() => ({}))) as { message?: string }
    throw new Error(e.message || `Citations load failed (${r.status})`)
  }
  return ((await r.json()) as { rows: AiCitation[] }).rows
}

async function runAll(): Promise<{
  prompts: number
  citations: number
  errors: number
}> {
  const r = await fetch(RUN_API, {
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
    prompts: number
    citations: number
    errors: number
  }
}

async function runOne(
  promptId: string,
): Promise<{ success: number; errors: number }> {
  const r = await fetch(RUN_API, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ prompt_id: promptId }),
  })
  if (!r.ok) {
    const e = (await r.json().catch(() => ({}))) as { message?: string }
    throw new Error(e.message || `Run failed (${r.status})`)
  }
  return (await r.json()) as { success: number; errors: number }
}

async function createPrompt(input: {
  prompt: string
  category?: string | null
  notes?: string | null
}): Promise<AiPrompt> {
  const r = await fetch(PROMPTS_API, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  })
  if (!r.ok) {
    const e = (await r.json().catch(() => ({}))) as { message?: string }
    throw new Error(e.message || `Create failed (${r.status})`)
  }
  return ((await r.json()) as { prompt: AiPrompt }).prompt
}

async function updatePrompt(
  id: string,
  patch: Partial<Pick<AiPrompt, "prompt" | "category" | "notes" | "active">>,
): Promise<void> {
  const r = await fetch(`${PROMPTS_API}/${id}`, {
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

async function deletePrompt(id: string): Promise<void> {
  const r = await fetch(`${PROMPTS_API}/${id}`, {
    method: "DELETE",
    credentials: "include",
  })
  if (!r.ok) {
    const e = (await r.json().catch(() => ({}))) as { message?: string }
    throw new Error(e.message || `Delete failed (${r.status})`)
  }
}

/**
 * Bulk-patch N prompts in one call. Hits the dedicated bulk route
 * rather than fanning N PATCHes from the client — keeps the admin
 * rate-limit budget intact when an ops person pauses 30 prompts at
 * once. Server-side the implementation is sequential (one Medusa
 * `updateOvoAiPrompts` per id) so per-row failures don't poison the
 * batch — the response surfaces both `updated` and per-id `errors`.
 */
async function bulkPatchPrompts(
  ids: string[],
  patch: { active?: boolean; category?: string | null },
): Promise<{ updated: number; errors: Array<{ id: string; error: string }> }> {
  const r = await fetch(`${PROMPTS_API}/bulk`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ids, patch }),
  })
  if (!r.ok) {
    const e = (await r.json().catch(() => ({}))) as { message?: string }
    throw new Error(e.message || `Bulk update failed (${r.status})`)
  }
  return (await r.json()) as {
    updated: number
    errors: Array<{ id: string; error: string }>
  }
}

/* ── sub-components ───────────────────────────────────────────────── */

/** Single cell in the prompt × provider matrix. */
const CitationCell: React.FC<{
  cite: AiCitation | undefined
  onClick: () => void
  active: boolean
}> = ({ cite, onClick, active }) => {
  if (!cite) {
    return (
      <td
        className="cursor-default px-2 py-2 text-center text-ui-fg-muted"
        title="No run yet"
      >
        <span className="font-mono text-[10px]">—</span>
      </td>
    )
  }
  const errored = cite.model_name === "error"
  let color: "green" | "red" | "orange" | "grey"
  let icon: string
  if (errored) {
    color = "orange"
    icon = "!"
  } else if (cite.mentions_brand) {
    color = "green"
    icon = cite.position ? `#${cite.position}` : "✓"
  } else {
    color = "red"
    icon = "—"
  }
  const compCount = cite.competitor_mentions?.length ?? 0
  return (
    <td
      onClick={onClick}
      className={
        "cursor-pointer px-2 py-2 text-center hover:bg-ui-bg-base-hover " +
        (active ? "bg-ui-bg-base-hover" : "")
      }
    >
      <div className="flex flex-col items-center gap-0.5">
        <Badge color={color} size="2xsmall">
          {icon}
        </Badge>
        {compCount > 0 && (
          <Text size="xsmall" className="font-mono text-ui-fg-muted">
            +{compCount} comp
          </Text>
        )}
      </div>
    </td>
  )
}

const SentimentBadge: React.FC<{
  sentiment: AiCitation["sentiment"]
}> = ({ sentiment }) => {
  if (!sentiment) return null
  const tone =
    sentiment === "positive"
      ? "green"
      : sentiment === "negative"
        ? "red"
        : "grey"
  return (
    <Badge color={tone} size="2xsmall">
      {sentiment}
    </Badge>
  )
}

const CitationDetail: React.FC<{ cite: AiCitation; onClose: () => void }> = ({
  cite,
  onClose,
}) => {
  const errored = cite.model_name === "error"
  return (
    <div className="flex flex-col gap-3 rounded-md border border-ui-border-base bg-ui-bg-subtle p-4 text-xs">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <Text size="small" weight="plus" className="text-ui-fg-base">
            {PROVIDER_LABEL[cite.provider]} · {cite.model_name}
          </Text>
          <Text size="xsmall" className="text-ui-fg-muted">
            Captured {new Date(cite.captured_at).toLocaleString()} ·{" "}
            {cite.latency_ms}ms
          </Text>
        </div>
        <Button variant="transparent" size="small" onClick={onClose}>
          Close
        </Button>
      </div>

      {/* Signal chips */}
      {!errored && (
        <div className="flex flex-wrap items-center gap-2">
          <Badge
            color={cite.mentions_brand ? "green" : "red"}
            size="2xsmall"
          >
            {cite.mentions_brand
              ? "mentions brand"
              : "no brand mention"}
          </Badge>
          {cite.links_brand && (
            <Badge color="blue" size="2xsmall">
              links brand domain
            </Badge>
          )}
          {cite.position != null && (
            <Badge color="green" size="2xsmall">
              ranked #{cite.position}
            </Badge>
          )}
          <SentimentBadge sentiment={cite.sentiment} />
        </div>
      )}

      {/* Competitor list */}
      {cite.competitor_mentions && cite.competitor_mentions.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          <Text size="xsmall" className="text-ui-fg-muted">
            Competitors mentioned:
          </Text>
          {cite.competitor_mentions.map((c) => (
            <span
              key={c}
              className="rounded-full border border-ui-border-base bg-ui-bg-base px-2 py-0.5 text-[10px]"
            >
              {c}
            </span>
          ))}
        </div>
      )}

      {/* Raw answer */}
      <div>
        <Text size="xsmall" className="text-ui-fg-muted">
          Answer
        </Text>
        <div
          className={
            "mt-1 max-h-96 overflow-auto whitespace-pre-wrap break-words rounded-md p-3 " +
            (errored
              ? "border border-ui-tag-red-border bg-ui-tag-red-bg text-ui-tag-red-text"
              : "border border-ui-border-base bg-ui-bg-base text-ui-fg-base")
          }
        >
          {cite.answer || "(empty response)"}
        </div>
      </div>
    </div>
  )
}

const NewPromptForm: React.FC<{
  onCreated: () => void
}> = ({ onCreated }) => {
  const [prompt, setPrompt] = useState("")
  const [category, setCategory] = useState<string>("category-buy")
  const [notes, setNotes] = useState("")
  const [submitting, setSubmitting] = useState(false)

  const submit = useCallback(async () => {
    if (prompt.trim().length < 8) {
      toast.warning("Prompt is too short", {
        description: "At least 8 characters.",
      })
      return
    }
    setSubmitting(true)
    try {
      await createPrompt({
        prompt: prompt.trim(),
        category: category || null,
        notes: notes.trim() || null,
      })
      toast.success("Prompt added")
      setPrompt("")
      setNotes("")
      onCreated()
    } catch (err) {
      toast.error("Couldn't add prompt", {
        description: (err as Error).message,
      })
    } finally {
      setSubmitting(false)
    }
  }, [prompt, category, notes, onCreated])

  return (
    <div className="flex flex-col gap-2 rounded-md border border-dashed border-ui-border-base p-3">
      <Text size="small" weight="plus" className="text-ui-fg-base">
        Add a new prompt
      </Text>
      <Textarea
        value={prompt}
        onChange={(e) => setPrompt(e.target.value)}
        rows={2}
        placeholder='e.g. "best online store for everyday essentials"'
        className="text-xs"
      />
      <div className="flex flex-wrap items-center gap-2">
        <Select value={category} onValueChange={setCategory}>
          <Select.Trigger className="max-w-xs">
            <Select.Value placeholder="Category" />
          </Select.Trigger>
          <Select.Content>
            <Select.Item value="brand-direct">brand-direct</Select.Item>
            <Select.Item value="category-buy">category-buy</Select.Item>
            <Select.Item value="comparison">comparison</Select.Item>
            <Select.Item value="task-flow">task-flow</Select.Item>
          </Select.Content>
        </Select>
        <Input
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="Optional notes (internal — not sent to AI)"
          className="flex-1 text-xs"
        />
        <Button
          onClick={submit}
          isLoading={submitting}
          disabled={submitting}
          size="small"
        >
          <Plus className="mr-1 h-3 w-3" />
          Add
        </Button>
      </div>
    </div>
  )
}

/* ── AI citation trend chart (Phase 8.E) ─────────────────────────── */

type TrendBucket = {
  bucket_start: string
  total: number
  mentioned: number
  linked: number
  missed: number
  avg_position: number | null
  sentiment: { positive: number; neutral: number; negative: number }
  by_provider: Record<
    string,
    { total: number; mentioned: number; linked: number; missed: number }
  >
}

type TrendResponse = {
  prompt_id: string
  prompt_text: string | null
  window_weeks: number
  buckets: TrendBucket[]
}

const PROVIDER_TREND_COLOURS: Record<string, string> = {
  openai: "#10a37f",
  anthropic: "#cc785c",
  perplexity: "#20808d",
  gemini: "#1a73e8",
}

/**
 * Per-prompt mention-rate trend chart. One line per provider, plus a
 * thick overall line. X-axis is ISO Monday of each weekly bucket.
 *
 * Pure inline SVG — keeps the admin SPA bundle slim (no recharts /
 * d3 dependency).
 */
const PromptTrendChart: React.FC<{ promptId: string }> = ({ promptId }) => {
  const [data, setData] = useState<TrendResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [hover, setHover] = useState<number | null>(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    fetch(`/admin/ovo/ai/trend?prompt_id=${encodeURIComponent(promptId)}&window_weeks=12`, {
      credentials: "include",
    })
      .then(async (r) => {
        if (!r.ok) {
          const e = (await r.json().catch(() => ({}))) as { message?: string }
          throw new Error(e.message || `Trend load failed (${r.status})`)
        }
        const json = (await r.json()) as TrendResponse
        if (!cancelled) setData(json)
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
  }, [promptId])

  if (loading) {
    return (
      <div className="rounded-md border border-ui-border-base bg-ui-bg-subtle p-3">
        <Text size="xsmall" className="text-ui-fg-muted">
          Loading trend…
        </Text>
      </div>
    )
  }
  if (error) {
    return (
      <div className="rounded-md border border-ui-border-base bg-ui-bg-subtle p-3">
        <Text size="xsmall" className="text-ui-tag-red-text">
          {error}
        </Text>
      </div>
    )
  }
  if (!data || data.buckets.length === 0) {
    return (
      <div className="rounded-md border border-dashed border-ui-border-base bg-ui-bg-subtle p-3">
        <Text size="xsmall" className="text-ui-fg-muted">
          No citation data in the last 12 weeks. Run the prompt to seed the trend.
        </Text>
      </div>
    )
  }

  const providers = new Set<string>()
  for (const b of data.buckets) {
    for (const p of Object.keys(b.by_provider)) providers.add(p)
  }
  const providerList = Array.from(providers).sort()

  const W = 600
  const H = 140
  const PAD = { l: 32, r: 12, t: 8, b: 24 }
  const innerW = W - PAD.l - PAD.r
  const innerH = H - PAD.t - PAD.b
  const n = data.buckets.length
  const stepX = n > 1 ? innerW / (n - 1) : 0
  const px = (i: number) => PAD.l + stepX * i
  const py = (rate: number) => PAD.t + innerH * (1 - rate)

  const overallLine = data.buckets
    .map((b, i) => {
      const rate = b.total > 0 ? b.mentioned / b.total : 0
      return `${i === 0 ? "M" : "L"} ${px(i).toFixed(1)} ${py(rate).toFixed(1)}`
    })
    .join(" ")

  const providerLines = providerList.map((p) => {
    const path = data.buckets
      .map((b, i) => {
        const pp = b.by_provider[p]
        if (!pp || pp.total === 0) return null
        const rate = pp.mentioned / pp.total
        return { i, rate }
      })
      .filter((x): x is { i: number; rate: number } => x !== null)
    const d = path
      .map(
        ({ i, rate }, idx) =>
          `${idx === 0 ? "M" : "L"} ${px(i).toFixed(1)} ${py(rate).toFixed(1)}`,
      )
      .join(" ")
    return { provider: p, d }
  })

  const hovered = hover != null ? data.buckets[hover] : null

  return (
    <div className="flex flex-col gap-2 rounded-md border border-ui-border-base bg-ui-bg-subtle p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Text size="xsmall" weight="plus" className="text-ui-fg-base">
          Mention rate — last {data.window_weeks} weeks
        </Text>
        <div className="flex flex-wrap items-center gap-2">
          {providerList.map((p) => (
            <span
              key={p}
              className="inline-flex items-center gap-1 text-[10px] text-ui-fg-base"
            >
              <span
                className="inline-block h-2 w-3 rounded"
                style={{
                  backgroundColor: PROVIDER_TREND_COLOURS[p] ?? "#888",
                }}
              />
              {p}
            </span>
          ))}
          <span className="inline-flex items-center gap-1 text-[10px] text-ui-fg-base">
            <span className="inline-block h-2 w-3 rounded bg-ui-fg-base" />
            overall
          </span>
        </div>
      </div>

      <svg
        viewBox={`0 0 ${W} ${H}`}
        width="100%"
        height={H}
        className="rounded bg-ui-bg-base"
      >
        {/* y-axis grid */}
        {[0, 0.25, 0.5, 0.75, 1].map((r) => (
          <g key={r}>
            <line
              x1={PAD.l}
              x2={W - PAD.r}
              y1={py(r)}
              y2={py(r)}
              stroke="currentColor"
              strokeOpacity={0.08}
            />
            <text
              x={PAD.l - 4}
              y={py(r) + 3}
              fontSize={9}
              textAnchor="end"
              fill="currentColor"
              fillOpacity={0.5}
            >
              {Math.round(r * 100)}%
            </text>
          </g>
        ))}

        {/* x-axis labels (every 3rd bucket) */}
        {data.buckets.map((b, i) => {
          if (n > 6 && i % 3 !== 0 && i !== n - 1) return null
          return (
            <text
              key={b.bucket_start}
              x={px(i)}
              y={H - 6}
              fontSize={9}
              textAnchor="middle"
              fill="currentColor"
              fillOpacity={0.5}
            >
              {b.bucket_start.slice(5, 10)}
            </text>
          )
        })}

        {/* provider lines */}
        {providerLines.map(({ provider, d }) => (
          <path
            key={provider}
            d={d}
            fill="none"
            stroke={PROVIDER_TREND_COLOURS[provider] ?? "#888"}
            strokeWidth={1.5}
            strokeOpacity={0.9}
          />
        ))}

        {/* overall line (thicker) */}
        <path
          d={overallLine}
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
          strokeOpacity={0.7}
        />

        {/* hover hitboxes */}
        {data.buckets.map((b, i) => (
          <rect
            key={b.bucket_start}
            x={px(i) - stepX / 2}
            y={PAD.t}
            width={Math.max(stepX, 8)}
            height={innerH}
            fill="transparent"
            onMouseEnter={() => setHover(i)}
            onMouseLeave={() => setHover(null)}
          />
        ))}

        {/* hover crosshair */}
        {hovered && hover != null && (
          <g>
            <line
              x1={px(hover)}
              x2={px(hover)}
              y1={PAD.t}
              y2={H - PAD.b}
              stroke="currentColor"
              strokeOpacity={0.3}
              strokeDasharray="2 2"
            />
            <circle
              cx={px(hover)}
              cy={py(hovered.total ? hovered.mentioned / hovered.total : 0)}
              r={3}
              fill="currentColor"
            />
          </g>
        )}
      </svg>

      {hovered && (
        <div className="rounded-md border border-ui-border-base bg-ui-bg-base p-2 text-[11px]">
          <div className="flex items-center justify-between">
            <span className="font-mono text-ui-fg-base">
              Week of {hovered.bucket_start.slice(0, 10)}
            </span>
            <span className="text-ui-fg-muted">
              {hovered.total} run{hovered.total === 1 ? "" : "s"} ·{" "}
              {hovered.mentioned}/{hovered.total} mentioned ·{" "}
              {hovered.linked} linked
              {hovered.avg_position != null
                ? ` · avg position ${hovered.avg_position}`
                : ""}
            </span>
          </div>
          {Object.entries(hovered.by_provider).length > 0 && (
            <div className="mt-1 flex flex-wrap gap-2">
              {Object.entries(hovered.by_provider).map(([p, s]) => (
                <span
                  key={p}
                  className="inline-flex items-center gap-1 rounded bg-ui-bg-subtle px-1.5 py-0.5"
                  style={{
                    color: PROVIDER_TREND_COLOURS[p] ?? "currentColor",
                  }}
                >
                  {p}: {s.mentioned}/{s.total}
                </span>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

const PromptRow: React.FC<{
  prompt: AiPrompt
  selected: boolean
  onSelectedChange: (checked: boolean) => void
  onChange: () => void
  onRun: (id: string) => Promise<void>
  isRunning: boolean
}> = ({ prompt, selected, onSelectedChange, onChange, onRun, isRunning }) => {
  const [editing, setEditing] = useState(false)
  const [text, setText] = useState(prompt.prompt)
  const [saving, setSaving] = useState(false)
  const [showTrend, setShowTrend] = useState(false)

  const save = useCallback(async () => {
    if (text.trim().length < 8) return
    setSaving(true)
    try {
      await updatePrompt(prompt.id, { prompt: text.trim() })
      onChange()
      setEditing(false)
    } catch (err) {
      toast.error("Update failed", { description: (err as Error).message })
    } finally {
      setSaving(false)
    }
  }, [text, prompt.id, onChange])

  const toggleActive = useCallback(async () => {
    try {
      await updatePrompt(prompt.id, { active: !prompt.active })
      onChange()
    } catch (err) {
      toast.error("Toggle failed", { description: (err as Error).message })
    }
  }, [prompt, onChange])

  const remove = useCallback(async () => {
    if (!confirm(`Delete prompt: "${prompt.prompt.slice(0, 60)}…"?`)) return
    try {
      await deletePrompt(prompt.id)
      toast.success("Prompt deleted")
      onChange()
    } catch (err) {
      toast.error("Delete failed", { description: (err as Error).message })
    }
  }, [prompt, onChange])

  return (
    <div
      className={
        "flex flex-col gap-2 rounded-md border p-3 " +
        (selected
          ? "border-ui-border-interactive bg-ui-bg-highlight"
          : "border-ui-border-base")
      }
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <input
            type="checkbox"
            checked={selected}
            onChange={(e) => onSelectedChange(e.target.checked)}
            aria-label={`Select prompt ${prompt.prompt.slice(0, 30)}`}
            className="mr-1"
          />
          {prompt.category && (
            <Badge color="grey" size="2xsmall">
              {prompt.category}
            </Badge>
          )}
          <Badge color={prompt.active ? "green" : "grey"} size="2xsmall">
            {prompt.active ? "active" : "paused"}
          </Badge>
        </div>
        <div className="flex items-center gap-1">
          <Button
            variant="transparent"
            size="small"
            onClick={() => onRun(prompt.id)}
            disabled={isRunning || !prompt.active}
          >
            <ArrowPathMini className="mr-1 h-3 w-3" />
            {isRunning ? "Running…" : "Run now"}
          </Button>
          <Button
            variant="transparent"
            size="small"
            onClick={() => setShowTrend((v) => !v)}
          >
            {showTrend ? "Hide trend" : "Show trend"}
          </Button>
          <Button variant="transparent" size="small" onClick={toggleActive}>
            {prompt.active ? "Pause" : "Resume"}
          </Button>
          <Button
            variant="transparent"
            size="small"
            onClick={() => setEditing(!editing)}
          >
            {editing ? "Cancel" : "Edit"}
          </Button>
          <Button variant="transparent" size="small" onClick={remove}>
            <Trash className="h-3 w-3" />
          </Button>
        </div>
      </div>
      {editing ? (
        <div className="flex flex-col gap-2">
          <Textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={2}
            className="text-xs"
          />
          <Button onClick={save} size="small" isLoading={saving}>
            Save
          </Button>
        </div>
      ) : (
        <Text size="small" className="text-ui-fg-base">
          {prompt.prompt}
        </Text>
      )}
      {prompt.notes && !editing && (
        <Text size="xsmall" className="italic text-ui-fg-muted">
          {prompt.notes}
        </Text>
      )}
      {showTrend && <PromptTrendChart promptId={prompt.id} />}
    </div>
  )
}

/* ── main ─────────────────────────────────────────────────────────── */

const AiCitationsTab: React.FC = () => {
  const [prompts, setPrompts] = useState<AiPrompt[]>([])
  const [citations, setCitations] = useState<AiCitation[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [running, setRunning] = useState(false)
  const [runningPromptId, setRunningPromptId] = useState<string>("")
  const [activeCell, setActiveCell] = useState<{
    promptId: string
    provider: AiProvider
  } | null>(null)
  // Phase H — bulk multi-select. Drives the toolbar that appears
  // above the prompt manager whenever ≥1 row is checked.
  const [selectedPrompts, setSelectedPrompts] = useState<Set<string>>(
    new Set(),
  )
  const [bulkCategory, setBulkCategory] = useState<string>("")
  const [bulkBusy, setBulkBusy] = useState(false)

  const refresh = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [p, c] = await Promise.all([loadPrompts(), loadCitations()])
      setPrompts(p)
      setCitations(c)
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
      const r = await runAll()
      toast.success("Citation run complete", {
        description: `${r.citations} citations across ${r.prompts} prompts · ${r.errors} errors`,
      })
      await refresh()
    } catch (err) {
      toast.error("Run failed", { description: (err as Error).message })
    } finally {
      setRunning(false)
    }
  }, [refresh])

  const onRunOne = useCallback(
    async (promptId: string) => {
      setRunningPromptId(promptId)
      try {
        const r = await runOne(promptId)
        toast.success("Prompt re-run", {
          description: `${r.success} success · ${r.errors} errors`,
        })
        await refresh()
      } catch (err) {
        toast.error("Run failed", { description: (err as Error).message })
      } finally {
        setRunningPromptId("")
      }
    },
    [refresh],
  )

  // Phase H — bulk-select handlers. Drop selection IDs that no longer
  // exist on refresh so the toolbar count never lies after a delete.
  useEffect(() => {
    setSelectedPrompts((prev) => {
      const live = new Set(prompts.map((p) => p.id))
      const next = new Set<string>()
      for (const id of prev) if (live.has(id)) next.add(id)
      return next
    })
  }, [prompts])

  const togglePromptSelected = useCallback(
    (id: string, checked: boolean) => {
      setSelectedPrompts((prev) => {
        const next = new Set(prev)
        if (checked) next.add(id)
        else next.delete(id)
        return next
      })
    },
    [],
  )

  const toggleAllPromptsSelected = useCallback(
    (checked: boolean) => {
      setSelectedPrompts(
        checked ? new Set(prompts.map((p) => p.id)) : new Set(),
      )
    },
    [prompts],
  )

  const allPromptsSelected =
    prompts.length > 0 && selectedPrompts.size === prompts.length
  const somePromptsSelected = selectedPrompts.size > 0

  const doBulkPatch = useCallback(
    async (patch: { active?: boolean; category?: string | null }) => {
      if (selectedPrompts.size === 0) return
      setBulkBusy(true)
      try {
        const ids = Array.from(selectedPrompts)
        const r = await bulkPatchPrompts(ids, patch)
        const what = patch.active === true
          ? "resumed"
          : patch.active === false
            ? "paused"
            : "recategorised"
        toast.success(`${r.updated} ${what}`, {
          description:
            r.errors.length > 0 ? `${r.errors.length} failed` : undefined,
        })
        if (r.errors.length === 0) setSelectedPrompts(new Set())
        await refresh()
      } catch (err) {
        toast.error("Bulk update failed", {
          description: (err as Error).message,
        })
      } finally {
        setBulkBusy(false)
      }
    },
    [selectedPrompts, refresh],
  )

  // Build the matrix: for each prompt × provider, the latest citation.
  const matrix = useMemo(() => {
    const m: Record<string, Record<AiProvider, AiCitation>> = {}
    // citations already sorted DESC by captured_at — first seen wins.
    for (const c of citations) {
      if (!m[c.prompt_id]) {
        m[c.prompt_id] = {} as Record<AiProvider, AiCitation>
      }
      if (!m[c.prompt_id][c.provider]) {
        m[c.prompt_id][c.provider] = c
      }
    }
    return m
  }, [citations])

  // Top-level summary: how often the brand gets mentioned?
  const summary = useMemo(() => {
    const latest: AiCitation[] = []
    for (const promptId of Object.keys(matrix)) {
      for (const p of PROVIDERS) {
        const c = matrix[promptId]?.[p]
        if (c) latest.push(c)
      }
    }
    const total = latest.length
    const mentions = latest.filter((c) => c.mentions_brand).length
    const links = latest.filter((c) => c.links_brand).length
    const errors = latest.filter((c) => c.model_name === "error").length
    return { total, mentions, links, errors }
  }, [matrix])

  const activeCitation = activeCell
    ? matrix[activeCell.promptId]?.[activeCell.provider]
    : null

  return (
    <section className="flex flex-col gap-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <Heading level="h2">AI citation tracker</Heading>
          <Text size="small" className="text-ui-fg-muted">
            Tracks whether ChatGPT / Claude / Perplexity / Gemini mention
            the brand when asked your curated prompts. Weekly cron at
            Sundays 02:00 UTC; ~$0.20-0.50/week with default models.
            Paste provider keys in the Submit tab's Integrations card to
            light up each column.
          </Text>
        </div>
        <Button onClick={onRunAll} isLoading={running} disabled={running}>
          {running ? "Running…" : "Run all prompts now"}
        </Button>
      </div>

      {error && (
        <div className="rounded-md border border-ui-tag-red-border bg-ui-tag-red-bg p-3">
          <Text size="small" className="text-ui-tag-red-text">
            {error}
          </Text>
        </div>
      )}

      {/* Summary cards */}
      {summary.total > 0 && (
        <div className="flex flex-wrap items-stretch gap-3">
          <SummaryCard label="Total cells (latest)" value={summary.total} tone="grey" />
          <SummaryCard
            label="Mentions brand"
            value={summary.mentions}
            tone="green"
            total={summary.total}
          />
          <SummaryCard
            label="Links brand domain"
            value={summary.links}
            tone="blue"
            total={summary.total}
          />
          {summary.errors > 0 && (
            <SummaryCard
              label="Provider errors"
              value={summary.errors}
              tone="red"
              total={summary.total}
            />
          )}
        </div>
      )}

      {/* Matrix */}
      <div className="overflow-hidden rounded-md border border-ui-border-base">
        <table className="w-full border-collapse text-left text-xs">
          <thead className="bg-ui-bg-subtle">
            <tr>
              <th className="px-3 py-2 font-semibold text-ui-fg-muted">
                Prompt
              </th>
              {PROVIDERS.map((p) => (
                <th
                  key={p}
                  className="px-2 py-2 text-center font-semibold text-ui-fg-muted"
                >
                  {PROVIDER_LABEL[p]}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {prompts.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-3 py-4 text-center">
                  <Text size="small" className="text-ui-fg-muted">
                    No prompts yet. Add one below, then hit{" "}
                    <span className="font-semibold">Run all</span>.
                  </Text>
                </td>
              </tr>
            ) : (
              prompts.map((p) => (
                <tr
                  key={p.id}
                  className={
                    "border-t border-ui-border-base " +
                    (!p.active ? "opacity-50" : "")
                  }
                >
                  <td className="px-3 py-2">
                    <Text size="xsmall" className="text-ui-fg-base">
                      {p.prompt}
                    </Text>
                    {p.category && (
                      <Text size="xsmall" className="text-ui-fg-muted">
                        {p.category}
                      </Text>
                    )}
                  </td>
                  {PROVIDERS.map((prov) => (
                    <CitationCell
                      key={`${p.id}-${prov}`}
                      cite={matrix[p.id]?.[prov]}
                      onClick={() =>
                        setActiveCell(
                          activeCell?.promptId === p.id &&
                            activeCell?.provider === prov
                            ? null
                            : { promptId: p.id, provider: prov },
                        )
                      }
                      active={
                        activeCell?.promptId === p.id &&
                        activeCell?.provider === prov
                      }
                    />
                  ))}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {activeCitation && (
        <CitationDetail
          cite={activeCitation}
          onClose={() => setActiveCell(null)}
        />
      )}

      {/* Prompt manager */}
      <div className="flex flex-col gap-3">
        <div className="flex items-center justify-between gap-2">
          <Heading level="h3">Prompts</Heading>
          {/* Select-all spans the visible prompt set — same source as the
              `prompts.map(...)` below so the checkbox count stays honest
              regardless of any future filtering. */}
          <label className="flex items-center gap-2 text-xs text-ui-fg-muted">
            <input
              type="checkbox"
              checked={allPromptsSelected}
              ref={(el) => {
                if (el)
                  el.indeterminate =
                    !allPromptsSelected && somePromptsSelected
              }}
              onChange={(e) => toggleAllPromptsSelected(e.target.checked)}
              aria-label="Select all prompts"
            />
            <span>Select all</span>
          </label>
        </div>

        {/* Bulk toolbar — only visible when ≥1 prompt is checked. */}
        {somePromptsSelected && (
          <div className="flex flex-wrap items-center gap-3 rounded-md border border-ui-border-base bg-ui-bg-subtle px-3 py-2">
            <Text size="small" weight="plus">
              {selectedPrompts.size} selected
            </Text>
            <span className="text-ui-fg-muted">·</span>
            <Button
              size="small"
              variant="secondary"
              onClick={() => doBulkPatch({ active: false })}
              disabled={bulkBusy}
            >
              Pause
            </Button>
            <Button
              size="small"
              variant="secondary"
              onClick={() => doBulkPatch({ active: true })}
              disabled={bulkBusy}
            >
              Resume
            </Button>
            <span className="text-ui-fg-muted">·</span>
            <Input
              value={bulkCategory}
              onChange={(e) => setBulkCategory(e.target.value)}
              placeholder="Category (blank = clear)"
              className="w-48 text-xs"
            />
            <Button
              size="small"
              onClick={() =>
                doBulkPatch({
                  category: bulkCategory.trim() || null,
                })
              }
              isLoading={bulkBusy}
              disabled={bulkBusy}
            >
              Apply category
            </Button>
            <Button
              size="small"
              variant="transparent"
              onClick={() => setSelectedPrompts(new Set())}
              disabled={bulkBusy}
            >
              Clear
            </Button>
          </div>
        )}

        <NewPromptForm onCreated={refresh} />
        {prompts.map((p) => (
          <PromptRow
            key={p.id}
            prompt={p}
            selected={selectedPrompts.has(p.id)}
            onSelectedChange={(checked) =>
              togglePromptSelected(p.id, checked)
            }
            onChange={refresh}
            onRun={onRunOne}
            isRunning={runningPromptId === p.id}
          />
        ))}
      </div>
    </section>
  )
}

const SummaryCard: React.FC<{
  label: string
  value: number
  tone: "green" | "red" | "blue" | "grey"
  total?: number
}> = ({ label, value, tone, total }) => {
  const pct = total && total > 0 ? Math.round((value / total) * 100) : null
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

export default AiCitationsTab
