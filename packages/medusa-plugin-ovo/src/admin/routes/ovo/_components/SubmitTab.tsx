import React, { useCallback, useEffect, useMemo, useRef, useState } from "react"
import {
  Badge,
  Button,
  Heading,
  Input,
  Label,
  Select,
  Switch,
  Text,
  toast,
} from "@medusajs/ui"
import {
  inspectGscUrl,
  loadSubmissionLog,
  loadSubmissionStats,
  loadSubmissionStatus,
  pushSubmission,
  type SubmissionDayBucket,
  type SubmissionDestination,
  type SubmissionDestinationStats,
  type SubmissionLogRow,
  type SubmissionResult,
  type SubmissionStatsResponse,
  type SubmissionStatus,
} from "./types"
import IntegrationsCard from "./IntegrationsCard"

/**
 * Convert an array of SubmissionLogRow into a CSV string the operator
 * can save / open in a spreadsheet. Pure function — fed by whatever
 * the filter dropdowns are currently showing, so the export matches
 * the visible view (not the unfiltered total).
 */
function logRowsToCsv(rows: SubmissionLogRow[]): string {
  const headers = [
    "created_at",
    "destination",
    "action",
    "status",
    "http_status",
    "url_count",
    "duration_ms",
    "target",
    "coverage",
    "error_message",
    "triggered_by_user_id",
    "id",
  ]
  const esc = (v: unknown): string => {
    if (v === null || v === undefined) return ""
    const s = String(v)
    // Wrap in quotes if it contains comma/quote/newline; double internal quotes.
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
  }
  const lines = [headers.join(",")]
  for (const r of rows) {
    lines.push(
      [
        r.created_at,
        r.destination,
        r.action,
        r.status,
        r.http_status,
        r.url_count,
        r.duration_ms,
        r.target,
        r.coverage ?? "",
        r.error_message ?? "",
        r.triggered_by_user_id ?? "",
        r.id,
      ]
        .map(esc)
        .join(","),
    )
  }
  return lines.join("\n")
}

function downloadCsv(filename: string, csv: string): void {
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" })
  const url = URL.createObjectURL(blob)
  const a = document.createElement("a")
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  // The URL is created off the heap; release it on next tick so the
  // browser has time to start the download before we revoke.
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

/**
 * Submit tab — manual "push to discovery surfaces now" controls +
 * status of each destination + recent submission log.
 *
 * Background note: every OVO save and every product webhook already
 * triggers IndexNow via the storefront revalidate webhook. This tab
 * exists for the cases that don't fit that automatic loop:
 *
 *   - First-time setup ("we just deployed — push everything now")
 *   - Catalogue bulk-import ("we just added 50 companies — sweep them")
 *   - Bing / Google sitemap submission (NOT covered by IndexNow's URL
 *     push — those need the GSC / Bing Webmaster APIs)
 *   - Spot-checking GSC index status for a single URL
 *
 * Skipped destinations show a "not configured" hint with the env var
 * to set — no surprise 500 toasts.
 */

const DESTINATION_LABEL: Record<
  SubmissionResult["destination"],
  string
> = {
  indexnow: "IndexNow (Bing + Yandex)",
  gsc: "Google Search Console",
  bing: "Bing Webmaster",
  yandex: "Yandex (via IndexNow)",
}

const ENV_HINT: Record<SubmissionResult["destination"], string> = {
  indexnow: "OVO_INDEXNOW_KEY",
  gsc: "OVO_GSC_SERVICE_ACCOUNT_JSON + OVO_GSC_PROPERTY",
  bing: "OVO_BING_API_KEY + OVO_BING_SITE_URL",
  yandex: "OVO_INDEXNOW_KEY (Yandex is notified via IndexNow)",
}

type LogFilterDestination = SubmissionDestination | "all"
type LogFilterStatus = "all" | "success" | "error" | "skipped"

const SubmitTab: React.FC = () => {
  const [status, setStatus] = useState<SubmissionStatus | null>(null)
  const [stats, setStats] = useState<SubmissionStatsResponse | null>(null)
  const [log, setLog] = useState<SubmissionLogRow[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState<SubmissionDestination | null>(null)
  const [inspectUrl, setInspectUrl] = useState("")
  const [inspectResult, setInspectResult] = useState<
    SubmissionResult | null
  >(null)
  const [inspecting, setInspecting] = useState(false)
  // Submissions log filters — destination / status / row limit. Filters
  // are server-side (the API supports both), so each change triggers a
  // refresh.
  const [filterDest, setFilterDest] = useState<LogFilterDestination>("all")
  const [filterStatus, setFilterStatus] = useState<LogFilterStatus>("all")
  const [filterLimit, setFilterLimit] = useState<string>("50")
  // 30s auto-refresh while the tab is in view. Polls both stats and
  // log. Off by default to keep idle traffic low; flip on when actively
  // watching pushes land.
  const [autoRefresh, setAutoRefresh] = useState(false)
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const fetchLog = useCallback(async (): Promise<void> => {
    try {
      const limitNum = Math.max(
        1,
        Math.min(200, Number.parseInt(filterLimit, 10) || 50),
      )
      const rows = await loadSubmissionLog({
        ...(filterDest !== "all" ? { destination: filterDest } : {}),
        ...(filterStatus !== "all" ? { status: filterStatus } : {}),
        limit: limitNum,
      })
      setLog(rows)
    } catch (err) {
      toast.error("Failed to load log", {
        description: (err as Error).message,
      })
    }
  }, [filterDest, filterStatus, filterLimit])

  const fetchStats = useCallback(async (): Promise<void> => {
    try {
      const s = await loadSubmissionStats()
      setStats(s)
    } catch (err) {
      // Stats failure is non-fatal — the rest of the tab still works.
      toast.warning("Stats unavailable", {
        description: (err as Error).message,
      })
    }
  }, [])

  const refreshLog = useCallback(async (): Promise<void> => {
    await Promise.all([fetchLog(), fetchStats()])
  }, [fetchLog, fetchStats])

  // Initial load — runs once on mount. Subsequent log refreshes are
  // driven by filter changes via the next effect.
  useEffect(() => {
    Promise.all([
      loadSubmissionStatus(),
      loadSubmissionStats(),
      loadSubmissionLog({ limit: 50 }),
    ])
      .then(([s, st, l]) => {
        setStatus(s)
        setStats(st)
        setLog(l)
      })
      .catch((err) =>
        toast.error("Submit tab load failed", {
          description: (err as Error).message,
        }),
      )
      .finally(() => setLoading(false))
  }, [])

  // Re-fetch log when filters change. Stats don't refetch here — they
  // only update on push success + manual refresh + auto-refresh tick.
  useEffect(() => {
    if (loading) return
    void fetchLog()
  }, [fetchLog, loading])

  // Auto-refresh toggle: poll every 30s when on, cancel cleanly on
  // unmount or when the operator flips it off.
  useEffect(() => {
    if (!autoRefresh) {
      if (pollRef.current) {
        clearInterval(pollRef.current)
        pollRef.current = null
      }
      return
    }
    pollRef.current = setInterval(() => {
      void refreshLog()
    }, 30_000)
    return () => {
      if (pollRef.current) {
        clearInterval(pollRef.current)
        pollRef.current = null
      }
    }
  }, [autoRefresh, refreshLog])

  const handlePush = useCallback(
    async (destination: SubmissionDestination) => {
      setBusy(destination)
      try {
        const results = await pushSubmission(destination)
        for (const r of results) {
          if (r.status === "success") {
            toast.success(`${DESTINATION_LABEL[r.destination]} — accepted`, {
              description:
                r.action === "submit-urls"
                  ? `${r.url_count} URL${r.url_count === 1 ? "" : "s"} submitted (HTTP ${r.http_status ?? "—"})`
                  : `${r.action} → HTTP ${r.http_status ?? "—"}`,
            })
          } else if (r.status === "skipped") {
            toast.warning(`${DESTINATION_LABEL[r.destination]} not configured`, {
              description: `Set ${ENV_HINT[r.destination]} on the Medusa backend env.`,
            })
          } else {
            toast.error(`${DESTINATION_LABEL[r.destination]} — failed`, {
              description:
                r.error_message ?? `HTTP ${r.http_status ?? "(network)"}`,
            })
          }
        }
        await refreshLog()
      } catch (err) {
        toast.error("Push failed", {
          description: (err as Error).message,
        })
      } finally {
        setBusy(null)
      }
    },
    [refreshLog],
  )

  const handleInspect = useCallback(async () => {
    if (!inspectUrl.trim()) return
    setInspecting(true)
    setInspectResult(null)
    try {
      const result = await inspectGscUrl(inspectUrl.trim())
      setInspectResult(result)
      if (result.status === "success") {
        toast.success("Inspection complete", {
          description: result.coverage ?? "(no coverage state)",
        })
      } else if (result.status === "skipped") {
        toast.warning("GSC not configured", {
          description: `Set ${ENV_HINT.gsc} on the Medusa backend env.`,
        })
      } else {
        toast.error("Inspection failed", {
          description:
            result.error_message ?? `HTTP ${result.http_status ?? "(network)"}`,
        })
      }
      await refreshLog()
    } catch (err) {
      toast.error("Inspection failed", {
        description: (err as Error).message,
      })
    } finally {
      setInspecting(false)
    }
  }, [inspectUrl, refreshLog])

  const destinations = useMemo<
    Array<{ key: "indexnow" | "gsc" | "bing"; cfg: { configured: boolean; site_url?: string | null; host?: string | null } }>
  >(() => {
    if (!status) return []
    return [
      { key: "indexnow", cfg: { configured: status.indexnow.configured, host: status.indexnow.host } },
      { key: "gsc", cfg: status.gsc },
      { key: "bing", cfg: status.bing },
    ]
  }, [status])

  if (loading || !status) {
    return <Text>Loading…</Text>
  }

  return (
    <div className="flex flex-col gap-8">
      {/* Credential admin — sits at the top because operators who land
          here typically arrive because something is "Not configured".
          Letting them paste a key in-place is the fastest path to flip
          the per-destination status badges green. */}
      <IntegrationsCard />

      {/* ── Per-destination rollups — top of tab ─────────────────────
          One card per destination with: last-success-at + 7d success
          rate + lifetime URLs pushed + a 7-day sparkline. Source of
          truth is /admin/ovo/submissions/stats (computed from
          ovo_submission_log in memory; cap-bounded so the call is
          O(<200)). */}
      <section className="flex flex-col gap-3">
        <div className="flex items-center justify-between gap-2">
          <Heading level="h2">Discovery surface status</Heading>
          <Button variant="transparent" size="small" onClick={refreshLog}>
            Refresh
          </Button>
        </div>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
          <DestinationStatCard
            label={DESTINATION_LABEL.indexnow}
            cfg={status.indexnow}
            stats={stats?.indexnow ?? null}
          />
          <DestinationStatCard
            label={DESTINATION_LABEL.gsc}
            cfg={status.gsc}
            stats={stats?.gsc ?? null}
          />
          <DestinationStatCard
            label={DESTINATION_LABEL.bing}
            cfg={status.bing}
            stats={stats?.bing ?? null}
          />
        </div>
      </section>

      <section className="flex flex-col gap-3">
        <Heading level="h2">Push to discovery surfaces</Heading>
        <Text className="text-ui-fg-muted">
          Manual triggers. Every OVO save and product webhook already
          fires IndexNow on its own — use the buttons below for first-
          time setup, bulk catalogue updates, or to submit the sitemap
          to Google / Bing (which IndexNow doesn&apos;t cover).
        </Text>

        <div className="rounded-lg border border-ui-border-base bg-ui-bg-subtle px-3 py-2 text-xs">
          <span className="text-ui-fg-muted">Sitemap index:</span>{" "}
          <code className="font-mono">{status.sitemap_index_url}</code>
        </div>

        <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
          {destinations.map(({ key, cfg }) => (
            <div
              key={key}
              className="flex flex-col gap-2 rounded-lg border border-ui-border-base p-3"
            >
              <div className="flex items-center justify-between gap-2">
                <Label className="font-bold">{DESTINATION_LABEL[key]}</Label>
                {cfg.configured ? (
                  <Badge color="green">Ready</Badge>
                ) : (
                  <Badge color="orange">Not configured</Badge>
                )}
              </div>
              <Text size="small" className="text-ui-fg-muted">
                {key === "indexnow" &&
                  "Pushes every URL from the live sitemap. Picked up by Bing + Yandex within ~10 minutes."}
                {key === "gsc" &&
                  "Submits / refreshes the sitemap-index in Google Search Console."}
                {key === "bing" &&
                  "Submits the sitemap-index to Bing Webmaster Tools (redundant with IndexNow for URL push)."}
              </Text>
              {!cfg.configured && (
                <Text size="xsmall" className="text-ui-fg-muted">
                  Set <code className="font-mono">{ENV_HINT[key]}</code>.
                </Text>
              )}
              <Button
                size="small"
                variant="secondary"
                disabled={!cfg.configured || busy !== null}
                isLoading={busy === key}
                onClick={() => handlePush(key)}
              >
                Push now
              </Button>
            </div>
          ))}
        </div>

        <div>
          <Button
            disabled={busy !== null}
            isLoading={busy === "all"}
            onClick={() => handlePush("all")}
          >
            Push to ALL configured surfaces
          </Button>
        </div>
      </section>

      <section className="flex flex-col gap-3">
        <Heading level="h2">Inspect a URL on Google Search Console</Heading>
        <Text className="text-ui-fg-muted">
          Spot-check whether Google has indexed a specific URL and why.
          Returns the <code className="font-mono">coverageState</code>{" "}
          (e.g. &quot;Submitted and indexed&quot;, &quot;Crawled — currently not
          indexed&quot;, &quot;URL is unknown to Google&quot;).
        </Text>
        <div className="flex flex-col gap-2 md:flex-row md:items-end">
          <div className="flex flex-1 flex-col gap-1">
            <Label htmlFor="inspect_url">URL</Label>
            <Input
              id="inspect_url"
              placeholder="https://your-domain.example/products/example-product"
              value={inspectUrl}
              onChange={(e) => setInspectUrl(e.target.value)}
            />
          </div>
          <Button
            onClick={handleInspect}
            disabled={!inspectUrl.trim() || inspecting || !status.gsc.configured}
            isLoading={inspecting}
          >
            Inspect
          </Button>
        </div>
        {inspectResult && (
          <div className="rounded-lg border border-ui-border-base bg-ui-bg-subtle px-3 py-2 text-xs">
            <div>
              <span className="text-ui-fg-muted">Status:</span>{" "}
              <code className="font-mono">{inspectResult.status}</code>
              {inspectResult.http_status ? (
                <>
                  {" · "}
                  <span className="text-ui-fg-muted">HTTP:</span>{" "}
                  <code className="font-mono">
                    {inspectResult.http_status}
                  </code>
                </>
              ) : null}
            </div>
            {inspectResult.coverage && (
              <div className="mt-1">
                <span className="text-ui-fg-muted">Coverage:</span>{" "}
                <code className="font-mono">{inspectResult.coverage}</code>
              </div>
            )}
            {inspectResult.error_message && (
              <div className="mt-1 text-ui-fg-error">
                {inspectResult.error_message}
              </div>
            )}
          </div>
        )}
      </section>

      <section className="flex flex-col gap-3">
        <div className="flex items-center justify-between gap-2">
          <Heading level="h2">Recent submissions</Heading>
          <div className="flex items-center gap-3">
            <label className="flex items-center gap-2 text-xs">
              <Switch
                checked={autoRefresh}
                onCheckedChange={setAutoRefresh}
              />
              <span className="text-ui-fg-muted">Auto-refresh (30s)</span>
            </label>
            <Button
              variant="secondary"
              size="small"
              onClick={() => {
                if (log.length === 0) {
                  toast.warning("Nothing to export", {
                    description: "Adjust filters or refresh first.",
                  })
                  return
                }
                const csv = logRowsToCsv(log)
                const stamp = new Date()
                  .toISOString()
                  .replace(/[:.]/g, "-")
                  .slice(0, 19)
                downloadCsv(`ovo-submission-log-${stamp}.csv`, csv)
                toast.success(`Exported ${log.length} row${log.length === 1 ? "" : "s"}`)
              }}
              disabled={log.length === 0}
              title="Export the rows currently visible (filters applied) as CSV"
            >
              Export CSV
            </Button>
            <Button variant="transparent" size="small" onClick={refreshLog}>
              Refresh
            </Button>
          </div>
        </div>
        <Text className="text-ui-fg-muted">
          Last {filterLimit} push events. Includes auto-triggered
          submissions (from OVO saves + product webhooks) and manual
          button clicks. Logs are pruned to 200 rows on each insert.
        </Text>

        <div className="flex flex-wrap items-end gap-3">
          <div className="flex flex-col gap-1">
            <Label size="small">Destination</Label>
            <Select
              value={filterDest}
              onValueChange={(v) => setFilterDest(v as LogFilterDestination)}
            >
              <Select.Trigger className="w-40">
                <Select.Value />
              </Select.Trigger>
              <Select.Content>
                <Select.Item value="all">All destinations</Select.Item>
                <Select.Item value="indexnow">IndexNow</Select.Item>
                <Select.Item value="gsc">GSC</Select.Item>
                <Select.Item value="bing">Bing</Select.Item>
                <Select.Item value="yandex">Yandex</Select.Item>
              </Select.Content>
            </Select>
          </div>
          <div className="flex flex-col gap-1">
            <Label size="small">Status</Label>
            <Select
              value={filterStatus}
              onValueChange={(v) => setFilterStatus(v as LogFilterStatus)}
            >
              <Select.Trigger className="w-32">
                <Select.Value />
              </Select.Trigger>
              <Select.Content>
                <Select.Item value="all">All statuses</Select.Item>
                <Select.Item value="success">Success</Select.Item>
                <Select.Item value="error">Error</Select.Item>
                <Select.Item value="skipped">Skipped</Select.Item>
              </Select.Content>
            </Select>
          </div>
          <div className="flex flex-col gap-1">
            <Label size="small">Limit</Label>
            <Select
              value={filterLimit}
              onValueChange={setFilterLimit}
            >
              <Select.Trigger className="w-24">
                <Select.Value />
              </Select.Trigger>
              <Select.Content>
                <Select.Item value="25">25</Select.Item>
                <Select.Item value="50">50</Select.Item>
                <Select.Item value="100">100</Select.Item>
                <Select.Item value="200">200</Select.Item>
              </Select.Content>
            </Select>
          </div>
        </div>
        {log.length === 0 ? (
          <div className="rounded-lg border border-ui-border-base bg-ui-bg-subtle px-3 py-4 text-sm text-ui-fg-muted">
            No submissions logged yet. Click a Push button above to fire
            the first one.
          </div>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-ui-border-base">
            <table className="min-w-full text-left text-xs">
              <thead className="bg-ui-bg-subtle text-ui-fg-muted">
                <tr>
                  <th className="px-3 py-2">When</th>
                  <th className="px-3 py-2">Destination</th>
                  <th className="px-3 py-2">Action</th>
                  <th className="px-3 py-2">Target</th>
                  <th className="px-3 py-2">URLs</th>
                  <th className="px-3 py-2">Status</th>
                  <th className="px-3 py-2">HTTP</th>
                  <th className="px-3 py-2">Duration</th>
                </tr>
              </thead>
              <tbody>
                {log.map((r) => (
                  <tr key={r.id} className="border-t border-ui-border-base">
                    <td className="px-3 py-2 font-mono text-[11px]">
                      {new Date(r.created_at).toLocaleString()}
                    </td>
                    <td className="px-3 py-2 font-semibold">{r.destination}</td>
                    <td className="px-3 py-2">{r.action}</td>
                    <td className="px-3 py-2 max-w-xs truncate font-mono text-[11px]">
                      {r.target}
                    </td>
                    <td className="px-3 py-2 tabular-nums">{r.url_count}</td>
                    <td className="px-3 py-2">
                      {r.status === "success" && (
                        <Badge color="green">success</Badge>
                      )}
                      {r.status === "error" && <Badge color="red">error</Badge>}
                      {r.status === "skipped" && (
                        <Badge color="grey">skipped</Badge>
                      )}
                    </td>
                    <td className="px-3 py-2 tabular-nums">
                      {r.http_status ?? "—"}
                    </td>
                    <td className="px-3 py-2 tabular-nums">
                      {r.duration_ms}ms
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  )
}

/* ── DestinationStatCard ─────────────────────────────────────────────
   One card per destination, top of the Submit tab. Configuration
   badge + rollups + 7-day sparkline.
   ──────────────────────────────────────────────────────────────────── */
type DestinationStatCardProps = {
  label: string
  cfg: { configured: boolean; site_url?: string | null; host?: string | null }
  stats: SubmissionDestinationStats | null
}

const DestinationStatCard: React.FC<DestinationStatCardProps> = ({
  label,
  cfg,
  stats,
}) => {
  const successRatePct =
    stats?.success_rate_7d != null
      ? Math.round(stats.success_rate_7d * 100)
      : null
  const lastSuccessLabel = stats?.last_success_at
    ? timeAgo(stats.last_success_at)
    : "—"
  return (
    <div className="flex flex-col gap-3 rounded-lg border border-ui-border-base p-3">
      <div className="flex items-start justify-between gap-2">
        <Label className="font-bold">{label}</Label>
        {cfg.configured ? (
          <Badge color="green">Ready</Badge>
        ) : (
          <Badge color="orange">Not configured</Badge>
        )}
      </div>
      <div className="grid grid-cols-3 gap-2 text-xs">
        <Stat label="Last success" value={lastSuccessLabel} />
        <Stat
          label="7d rate"
          value={successRatePct == null ? "—" : `${successRatePct}%`}
        />
        <Stat
          label="URLs pushed"
          value={(stats?.lifetime_urls_pushed ?? 0).toLocaleString("en-IN")}
        />
      </div>
      <Sparkline buckets={stats?.events_by_day ?? []} />
      {stats && stats.lifetime_event_count > 0 ? (
        <Text size="xsmall" className="text-ui-fg-muted">
          7d:{" "}
          <span className="text-emerald-600 dark:text-emerald-400">
            {stats.success_count_7d}✓
          </span>{" "}
          <span className="text-red-600 dark:text-red-400">
            {stats.error_count_7d}✗
          </span>{" "}
          <span className="text-ui-fg-muted">
            {stats.skipped_count_7d}skipped
          </span>{" "}
          · lifetime {stats.lifetime_event_count} events
        </Text>
      ) : (
        <Text size="xsmall" className="text-ui-fg-muted">
          No events yet. Fire a push below to see this surface fill in.
        </Text>
      )}
    </div>
  )
}

const Stat: React.FC<{ label: string; value: React.ReactNode }> = ({
  label,
  value,
}) => (
  <div>
    <div className="text-[10px] uppercase tracking-widest text-ui-fg-muted">
      {label}
    </div>
    <div className="font-semibold tabular-nums">{value}</div>
  </div>
)

/* Simple inline-SVG sparkline. Renders the total event count per day
   over the last 7 days (success + error + skipped). No external chart
   lib — keeps the admin bundle lean. */
const Sparkline: React.FC<{ buckets: SubmissionDayBucket[] }> = ({
  buckets,
}) => {
  if (!buckets.length) return null
  const w = 220
  const h = 32
  const pad = 2
  const maxV = Math.max(1, ...buckets.map((b) => b.success + b.error + b.skipped))
  const stepX = (w - 2 * pad) / Math.max(1, buckets.length - 1)
  const points = buckets
    .map((b, i) => {
      const total = b.success + b.error + b.skipped
      const x = pad + i * stepX
      const y = h - pad - ((h - 2 * pad) * total) / maxV
      return `${x.toFixed(1)},${y.toFixed(1)}`
    })
    .join(" ")
  return (
    <svg
      viewBox={`0 0 ${w} ${h}`}
      width="100%"
      height={h}
      className="block"
      preserveAspectRatio="none"
      aria-label={`7-day activity sparkline, peak ${maxV} events/day`}
    >
      <polyline
        points={points}
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        className="text-ui-fg-interactive"
      />
      {buckets.map((b, i) => {
        const total = b.success + b.error + b.skipped
        const x = pad + i * stepX
        const y = h - pad - ((h - 2 * pad) * total) / maxV
        return (
          <circle
            key={b.date}
            cx={x}
            cy={y}
            r={1.5}
            fill="currentColor"
            className="text-ui-fg-interactive"
          >
            <title>
              {b.date}: {b.success} ok · {b.error} err · {b.skipped} skipped
            </title>
          </circle>
        )
      })}
    </svg>
  )
}

/* Compact "12m ago" / "3h ago" / "2d ago" formatter for the
   last-success cell. Mirrors the helper in the referral admin
   to keep date copy consistent across OVO and referral surfaces. */
function timeAgo(iso: string | null): string {
  if (!iso) return "—"
  const ms = Date.now() - new Date(iso).getTime()
  if (ms < 0) return "just now"
  if (ms < 60_000) return "just now"
  if (ms < 3_600_000) return `${Math.round(ms / 60_000)}m ago`
  if (ms < 86_400_000) return `${Math.round(ms / 3_600_000)}h ago`
  return `${Math.round(ms / 86_400_000)}d ago`
}

export default SubmitTab
