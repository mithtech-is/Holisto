import React, { useCallback, useEffect, useState } from "react"
import {
  Badge,
  Button,
  Heading,
  Input,
  Label,
  Text,
  Textarea,
  toast,
} from "@medusajs/ui"
import { PlaySolid as Play } from "@medusajs/icons"
import {
  loadCredentials,
  saveCredentials,
  type ApiCredentialsView,
  type CredentialFieldSummary,
} from "./types"

/**
 * Run a metric-ingest for a single engine via the manual trigger.
 * Returns a short toast-friendly summary. Used by the per-credential
 * "Run ingest now" buttons.
 */
async function runIngestForEngine(
  engine: "gsc" | "bing" | "yandex" | "crux",
): Promise<string> {
  const r = await fetch("/admin/ovo/seo/ingest", {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ engine }),
  })
  if (!r.ok) {
    const e = (await r.json().catch(() => ({}))) as { message?: string }
    throw new Error(e.message || `Ingest failed (${r.status})`)
  }
  const out = (await r.json()) as Record<string, unknown>
  // Pull the most relevant `written` count for a concise toast.
  const pickWritten = (v: unknown): number | null =>
    v && typeof v === "object" && "written" in v
      ? Number((v as { written: number }).written)
      : null
  switch (engine) {
    case "gsc": {
      const w = pickWritten(out.gsc) ?? 0
      return `GSC: ${w} metric row${w === 1 ? "" : "s"}`
    }
    case "bing": {
      const w = pickWritten(out.bing) ?? 0
      return `Bing: ${w} metric row${w === 1 ? "" : "s"}`
    }
    case "yandex": {
      const w = pickWritten(out.yandex) ?? 0
      return `Yandex: ${w} metric row${w === 1 ? "" : "s"}`
    }
    case "crux": {
      const w = pickWritten(out.crux) ?? 0
      return `CrUX: ${w} CWV row${w === 1 ? "" : "s"}`
    }
  }
}

async function runAiCitationsNow(): Promise<string> {
  const r = await fetch("/admin/ovo/ai/run", {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({}),
  })
  if (!r.ok) {
    const e = (await r.json().catch(() => ({}))) as { message?: string }
    throw new Error(e.message || `Run failed (${r.status})`)
  }
  const out = (await r.json()) as { prompts?: number; citations?: number; errors?: number }
  return `Cited ${out.citations ?? 0} / ${out.prompts ?? 0} prompts (${out.errors ?? 0} errors)`
}

/**
 * Integrations card on the OVO Submit tab.
 *
 * Lets ops paste / rotate / clear the three external-API credentials
 * without a redeploy. Each credential shows:
 *
 *   - "Ready" or "Not configured" badge driven by `configured`.
 *   - Source label ("Saved in admin" / "Using env var" / "Empty").
 *   - last4 of the resolved plaintext when present (drift check).
 *   - An input — blank = leave unchanged; non-empty = encrypt + save.
 *   - A "Clear" button for db-sourced rows that wipes the column (falls
 *     back to env if present).
 *
 * The GSC field is a textarea since the service-account JSON spans
 * many lines when pretty-printed. The component accepts either
 * pretty-printed or single-line JSON.
 *
 * Plaintext NEVER leaves the backend — even after saving the input is
 * cleared and we re-fetch the masked view.
 */
export const IntegrationsCard: React.FC = () => {
  const [view, setView] = useState<ApiCredentialsView | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  // Local input state — populated only while the operator is typing.
  // We clear after a successful save so the masked view alone reflects
  // what's stored.
  const [gscInput, setGscInput] = useState("")
  const [bingInput, setBingInput] = useState("")
  const [openaiInput, setOpenaiInput] = useState("")
  const [anthropicInput, setAnthropicInput] = useState("")
  const [perplexityInput, setPerplexityInput] = useState("")
  const [googleAiInput, setGoogleAiInput] = useState("")
  const [yandexInput, setYandexInput] = useState("")
  const [yandexUserIdInput, setYandexUserIdInput] = useState("")
  const [yandexHostIdInput, setYandexHostIdInput] = useState("")
  const [rediscovering, setRediscovering] = useState(false)
  const [cruxInput, setCruxInput] = useState("")
  // Per-credential "Run now" busy state. Each key maps to whichever
  // button is currently firing — only one ingest runs at a time so the
  // backend doesn't hold open multiple concurrent GSC quota windows.
  const [running, setRunning] = useState<
    | "gsc"
    | "bing"
    | "yandex"
    | "crux"
    | "ai"
    | null
  >(null)

  const runIngest = useCallback(
    async (engine: "gsc" | "bing" | "yandex" | "crux") => {
      if (running) return
      setRunning(engine)
      try {
        const summary = await runIngestForEngine(engine)
        toast.success("Ingest complete", { description: summary })
      } catch (err) {
        toast.error("Ingest failed", { description: (err as Error).message })
      } finally {
        setRunning(null)
      }
    },
    [running],
  )

  const runAi = useCallback(async () => {
    if (running) return
    setRunning("ai")
    try {
      const summary = await runAiCitationsNow()
      toast.success("AI citation run complete", { description: summary })
    } catch (err) {
      toast.error("AI citation run failed", {
        description: (err as Error).message,
      })
    } finally {
      setRunning(null)
    }
  }, [running])

  const refresh = useCallback(async () => {
    setLoading(true)
    try {
      const v = await loadCredentials()
      setView(v)
    } catch (err) {
      toast.error("Credentials load failed", {
        description: (err as Error).message,
      })
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    refresh()
  }, [refresh])

  const onSave = useCallback(async () => {
    const patch: {
      gsc_service_account_json?: string
      bing_api_key?: string
      openai_api_key?: string
      anthropic_api_key?: string
      perplexity_api_key?: string
      google_ai_api_key?: string
      yandex_oauth_token?: string
      yandex_user_id?: string
      yandex_host_id?: string
      crux_api_key?: string
    } = {}
    if (gscInput.trim()) patch.gsc_service_account_json = gscInput.trim()
    if (bingInput.trim()) patch.bing_api_key = bingInput.trim()
    if (openaiInput.trim()) patch.openai_api_key = openaiInput.trim()
    if (anthropicInput.trim()) patch.anthropic_api_key = anthropicInput.trim()
    if (perplexityInput.trim())
      patch.perplexity_api_key = perplexityInput.trim()
    if (googleAiInput.trim()) patch.google_ai_api_key = googleAiInput.trim()
    if (yandexInput.trim()) patch.yandex_oauth_token = yandexInput.trim()
    if (yandexUserIdInput.trim()) patch.yandex_user_id = yandexUserIdInput.trim()
    if (yandexHostIdInput.trim()) patch.yandex_host_id = yandexHostIdInput.trim()
    if (cruxInput.trim()) patch.crux_api_key = cruxInput.trim()
    if (Object.keys(patch).length === 0) {
      toast.warning("Nothing to save", {
        description: "Paste a value into at least one field.",
      })
      return
    }
    setSaving(true)
    try {
      const v = await saveCredentials(patch)
      setView(v)
      setGscInput("")
      setBingInput("")
      setOpenaiInput("")
      setAnthropicInput("")
      setPerplexityInput("")
      setGoogleAiInput("")
      setYandexInput("")
      setYandexUserIdInput("")
      setYandexHostIdInput("")
      setCruxInput("")
      toast.success("Credentials saved", {
        description:
          "GSC/Bing/Yandex values apply on the next 00:30 UTC ingest. AI keys apply on the next Sunday 02:00 UTC citation run — or hit the manual buttons in their tabs.",
      })
    } catch (err) {
      toast.error("Save failed", {
        description: (err as Error).message,
      })
    } finally {
      setSaving(false)
    }
  }, [
    gscInput,
    bingInput,
    openaiInput,
    anthropicInput,
    perplexityInput,
    googleAiInput,
    yandexInput,
    yandexUserIdInput,
    yandexHostIdInput,
    cruxInput,
  ])

  type ClearField =
    | "gsc"
    | "bing"
    | "openai"
    | "anthropic"
    | "perplexity"
    | "google_ai"
    | "yandex"
    | "crux"
  const onClear = useCallback(async (field: ClearField) => {
    const labelMap: Record<ClearField, string> = {
      gsc: "GSC service account",
      bing: "Bing API key",
      openai: "OpenAI API key",
      anthropic: "Anthropic API key",
      perplexity: "Perplexity API key",
      google_ai: "Google AI / Gemini API key",
      yandex: "Yandex OAuth token",
      crux: "Chrome UX Report API key",
    }
    if (
      !confirm(
        `Clear the saved ${labelMap[field]}? Falls back to env var if present.`,
      )
    )
      return
    setSaving(true)
    try {
      const patchMap: Record<ClearField, Parameters<typeof saveCredentials>[0]> = {
        gsc: { gsc_service_account_json: null },
        bing: { bing_api_key: null },
        openai: { openai_api_key: null },
        anthropic: { anthropic_api_key: null },
        perplexity: { perplexity_api_key: null },
        google_ai: { google_ai_api_key: null },
        yandex: {
          yandex_oauth_token: null,
          yandex_user_id: null,
          yandex_host_id: null,
        },
        crux: { crux_api_key: null },
      }
      const v = await saveCredentials(patchMap[field])
      setView(v)
      toast.success(`${labelMap[field]} cleared`)
    } catch (err) {
      toast.error("Clear failed", { description: (err as Error).message })
    } finally {
      setSaving(false)
    }
  }, [])

  const onRediscoverYandex = useCallback(async () => {
    setRediscovering(true)
    try {
      const r = await fetch("/admin/ovo/yandex/discover", {
        method: "POST",
        credentials: "include",
      })
      if (!r.ok) {
        const e = (await r.json().catch(() => ({}))) as { message?: string }
        throw new Error(e.message || `Discover failed (${r.status})`)
      }
      const out = (await r.json()) as {
        user_id: string | null
        host_id: string | null
      }
      await refresh()
      if (out.user_id && out.host_id) {
        toast.success("Yandex IDs resolved", {
          description: `user_id=${out.user_id} · host_id=${out.host_id}`,
        })
      } else {
        toast.warning("Discovery returned no match", {
          description:
            "The token has no verified site matching NEXT_PUBLIC_SITE_URL. Verify on webmaster.yandex.com or enter the host_id manually below.",
        })
      }
    } catch (err) {
      toast.error("Discover failed", { description: (err as Error).message })
    } finally {
      setRediscovering(false)
    }
  }, [refresh])

  if (loading || !view) {
    return (
      <div className="rounded-lg border border-ui-border-base p-4">
        <Text className="text-ui-fg-muted">Loading credentials…</Text>
      </div>
    )
  }

  return (
    <section className="flex flex-col gap-4 rounded-lg border border-ui-border-base p-5">
      <div>
        <Heading level="h2">Integrations &mdash; API credentials</Heading>
        <Text size="small" className="text-ui-fg-muted">
          Paste keys here to enable GSC + Bing daily metrics. Encrypted at
          rest with AES-256-GCM. Each field falls back to the matching env
          var when empty &mdash; leaving everything blank keeps the legacy
          env-var setup.
        </Text>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-1">
        {/* GSC service account */}
        <div className="rounded-md border border-ui-border-base p-3">
          <CredentialHeader
            label="Google Search Console service account"
            summary={view.gsc_service_account_json}
          />
          <Text size="xsmall" className="text-ui-fg-muted">
            Single-line JSON from{" "}
            <a
              className="underline"
              href="https://console.cloud.google.com/iam-admin/serviceaccounts"
              target="_blank"
              rel="noreferrer"
            >
              Cloud Console &rarr; IAM &rarr; Service accounts
            </a>
            . The service account email must be added as an Owner of the
            your property in Search Console.
            {view.gsc_site_url && (
              <>
                {" "}Currently scoped to{" "}
                <code className="font-mono">{view.gsc_site_url}</code>.
              </>
            )}
          </Text>
          <Textarea
            value={gscInput}
            onChange={(e) => setGscInput(e.target.value)}
            rows={3}
            placeholder='{"type":"service_account","client_email":"…","private_key":"-----BEGIN PRIVATE KEY-----…"}'
            className="mt-2 font-mono text-xs"
          />
          <div className="mt-1 flex flex-wrap items-center gap-2">
            {view.gsc_service_account_json.configured && (
              <Button
                variant="secondary"
                size="small"
                onClick={() => runIngest("gsc")}
                isLoading={running === "gsc"}
                disabled={running !== null}
              >
                <Play className="mr-1 h-3 w-3" />
                Run ingest now
              </Button>
            )}
            {view.gsc_service_account_json.source === "db" && (
              <Button
                variant="transparent"
                size="small"
                onClick={() => onClear("gsc")}
                disabled={saving}
              >
                Clear saved value
              </Button>
            )}
          </div>
        </div>

        {/* Bing API key */}
        <div className="rounded-md border border-ui-border-base p-3">
          <CredentialHeader
            label="Bing Webmaster API key"
            summary={view.bing_api_key}
          />
          <Text size="xsmall" className="text-ui-fg-muted">
            From{" "}
            <a
              className="underline"
              href="https://www.bing.com/webmasters/api-access"
              target="_blank"
              rel="noreferrer"
            >
              Bing Webmaster &rarr; Settings &rarr; API access
            </a>
            . Click Generate.
            {view.bing_site_url && (
              <>
                {" "}Scoped to{" "}
                <code className="font-mono">{view.bing_site_url}</code>.
              </>
            )}
          </Text>
          <Input
            value={bingInput}
            onChange={(e) => setBingInput(e.target.value)}
            placeholder="Paste new key to replace; leave blank to keep current"
            className="mt-2 font-mono text-xs"
          />
          <div className="mt-1 flex flex-wrap items-center gap-2">
            {view.bing_api_key.configured && (
              <Button
                variant="secondary"
                size="small"
                onClick={() => runIngest("bing")}
                isLoading={running === "bing"}
                disabled={running !== null}
              >
                <Play className="mr-1 h-3 w-3" />
                Run ingest now
              </Button>
            )}
            {view.bing_api_key.source === "db" && (
              <Button
                variant="transparent"
                size="small"
                onClick={() => onClear("bing")}
                disabled={saving}
              >
                Clear saved value
              </Button>
            )}
          </div>
        </div>

        {/* SpaceSerp removed — the provider was abandoned in 2025. See
          * Migration20260515220000 for the timeline. */}

        {/* ── AI citation tracker (Phase 4) ─────────────────────── */}
        <div className="mt-2 rounded-md border border-dashed border-ui-border-base p-3">
          <Text size="small" weight="plus" className="text-ui-fg-base">
            AI answer-engine APIs (Phase 4)
          </Text>
          <Text size="xsmall" className="text-ui-fg-muted">
            Used by the weekly AI-citation cron (Sundays 02:00 UTC) to ask
            each provider a curated prompt set and track when the brand
            gets mentioned. Each key is optional — providers with empty
            keys are silently skipped.
          </Text>
        </div>

        {/* OpenAI */}
        <div className="rounded-md border border-ui-border-base p-3">
          <CredentialHeader
            label="OpenAI API key"
            summary={view.openai_api_key}
          />
          <Text size="xsmall" className="text-ui-fg-muted">
            Generate at{" "}
            <a
              className="underline"
              href="https://platform.openai.com/api-keys"
              target="_blank"
              rel="noreferrer"
            >
              platform.openai.com &rarr; API keys
            </a>
            . Cron uses `gpt-4o-mini` (~$0.01/week).
          </Text>
          <Input
            value={openaiInput}
            onChange={(e) => setOpenaiInput(e.target.value)}
            placeholder="sk-…"
            className="mt-2 font-mono text-xs"
          />
          <div className="mt-1 flex flex-wrap items-center gap-2">
            {view.openai_api_key.configured && (
              <Button
                variant="secondary"
                size="small"
                onClick={runAi}
                isLoading={running === "ai"}
                disabled={running !== null}
                title="Runs all configured AI providers (citation cron parity)"
              >
                <Play className="mr-1 h-3 w-3" />
                Run citation now
              </Button>
            )}
            {view.openai_api_key.source === "db" && (
              <Button
                variant="transparent"
                size="small"
                onClick={() => onClear("openai")}
                disabled={saving}
              >
                Clear saved value
              </Button>
            )}
          </div>
        </div>

        {/* Anthropic */}
        <div className="rounded-md border border-ui-border-base p-3">
          <CredentialHeader
            label="Anthropic API key"
            summary={view.anthropic_api_key}
          />
          <Text size="xsmall" className="text-ui-fg-muted">
            Generate at{" "}
            <a
              className="underline"
              href="https://console.anthropic.com/settings/keys"
              target="_blank"
              rel="noreferrer"
            >
              console.anthropic.com &rarr; Settings &rarr; API keys
            </a>
            . Cron uses `claude-haiku-4-5` (~$0.05/week).
          </Text>
          <Input
            value={anthropicInput}
            onChange={(e) => setAnthropicInput(e.target.value)}
            placeholder="sk-ant-…"
            className="mt-2 font-mono text-xs"
          />
          {view.anthropic_api_key.source === "db" && (
            <Button
              variant="transparent"
              size="small"
              onClick={() => onClear("anthropic")}
              disabled={saving}
              className="mt-1"
            >
              Clear saved value
            </Button>
          )}
        </div>

        {/* Perplexity */}
        <div className="rounded-md border border-ui-border-base p-3">
          <CredentialHeader
            label="Perplexity API key"
            summary={view.perplexity_api_key}
          />
          <Text size="xsmall" className="text-ui-fg-muted">
            Generate at{" "}
            <a
              className="underline"
              href="https://www.perplexity.ai/settings/api"
              target="_blank"
              rel="noreferrer"
            >
              perplexity.ai &rarr; Settings &rarr; API
            </a>
            . Cron uses `sonar` (~$0.15/week). Perplexity is the only
            provider that returns citations — strongest grounding signal.
          </Text>
          <Input
            value={perplexityInput}
            onChange={(e) => setPerplexityInput(e.target.value)}
            placeholder="pplx-…"
            className="mt-2 font-mono text-xs"
          />
          {view.perplexity_api_key.source === "db" && (
            <Button
              variant="transparent"
              size="small"
              onClick={() => onClear("perplexity")}
              disabled={saving}
              className="mt-1"
            >
              Clear saved value
            </Button>
          )}
        </div>

        {/* Google AI Studio (Gemini) */}
        <div className="rounded-md border border-ui-border-base p-3">
          <CredentialHeader
            label="Google AI Studio (Gemini) API key"
            summary={view.google_ai_api_key}
          />
          <Text size="xsmall" className="text-ui-fg-muted">
            Generate at{" "}
            <a
              className="underline"
              href="https://aistudio.google.com/apikey"
              target="_blank"
              rel="noreferrer"
            >
              aistudio.google.com/apikey
            </a>
            . Cron uses `gemini-2.0-flash-lite` (free tier, 15 req/min).
          </Text>
          <Input
            value={googleAiInput}
            onChange={(e) => setGoogleAiInput(e.target.value)}
            placeholder="AIza…"
            className="mt-2 font-mono text-xs"
          />
          {view.google_ai_api_key.source === "db" && (
            <Button
              variant="transparent"
              size="small"
              onClick={() => onClear("google_ai")}
              disabled={saving}
              className="mt-1"
            >
              Clear saved value
            </Button>
          )}
        </div>

        {/* Yandex Webmaster (Phase 11) */}
        <div className="rounded-md border border-ui-border-base p-3 md:col-span-2">
          <CredentialHeader
            label="Yandex Webmaster OAuth token"
            summary={view.yandex_oauth_token}
          />
          <Text size="xsmall" className="text-ui-fg-muted">
            Generate at{" "}
            <a
              className="underline"
              href="https://oauth.yandex.com/"
              target="_blank"
              rel="noreferrer"
            >
              oauth.yandex.com
            </a>{" "}
            → register an app with scopes{" "}
            <code className="font-mono">webmaster:hosts.info</code> +{" "}
            <code className="font-mono">webmaster:verify</code> +{" "}
            <code className="font-mono">webmaster:hosts.indexing</code>. Save
            the token here; auto-discovery resolves <code className="font-mono">user_id</code>{" "}
            + <code className="font-mono">host_id</code> on save.
          </Text>
          <Input
            value={yandexInput}
            onChange={(e) => setYandexInput(e.target.value)}
            placeholder="y0_…"
            className="mt-2 font-mono text-xs"
          />
          <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-2">
            <div>
              <Label className="text-[11px]">
                user_id{" "}
                <span className="font-normal text-ui-fg-muted">
                  (auto-discovered;{" "}
                  {view.yandex_user_id ? (
                    <code className="font-mono">{view.yandex_user_id}</code>
                  ) : (
                    "not set"
                  )}
                  )
                </span>
              </Label>
              <Input
                value={yandexUserIdInput}
                onChange={(e) => setYandexUserIdInput(e.target.value)}
                placeholder="manual override (rare)"
                className="mt-1 font-mono text-xs"
              />
            </div>
            <div>
              <Label className="text-[11px]">
                host_id{" "}
                <span className="font-normal text-ui-fg-muted">
                  (auto-discovered;{" "}
                  {view.yandex_host_id ? (
                    <code className="font-mono">{view.yandex_host_id}</code>
                  ) : (
                    "not set"
                  )}
                  )
                </span>
              </Label>
              <Input
                value={yandexHostIdInput}
                onChange={(e) => setYandexHostIdInput(e.target.value)}
                placeholder="manual override (rare)"
                className="mt-1 font-mono text-xs"
              />
            </div>
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            {view.yandex_oauth_token.configured && (
              <Button
                variant="secondary"
                size="small"
                onClick={() => runIngest("yandex")}
                isLoading={running === "yandex"}
                disabled={running !== null}
              >
                <Play className="mr-1 h-3 w-3" />
                Run ingest now
              </Button>
            )}
            {view.yandex_oauth_token.source !== "none" && (
              <Button
                variant="secondary"
                size="small"
                onClick={onRediscoverYandex}
                isLoading={rediscovering}
                disabled={rediscovering || saving}
              >
                Re-discover IDs
              </Button>
            )}
            {view.yandex_oauth_token.source === "db" && (
              <Button
                variant="transparent"
                size="small"
                onClick={() => onClear("yandex")}
                disabled={saving}
              >
                Clear saved value
              </Button>
            )}
            <Text size="xsmall" className="text-ui-fg-muted">
              Daily cron at 00:30 UTC populates `engine="yandex"` rows in{" "}
              <code className="font-mono">ovo_seo_metric</code>.
            </Text>
          </div>
        </div>

        {/* Chrome UX Report (Phase 12) */}
        <div className="rounded-md border border-ui-border-base p-3 md:col-span-2">
          <CredentialHeader
            label="Chrome UX Report (CrUX) API key"
            summary={view.crux_api_key}
          />
          <Text size="xsmall" className="text-ui-fg-muted">
            Real-user Core Web Vitals (LCP / CLS / INP / FCP / TTFB) for{" "}
            <code className="font-mono">{view.gsc_site_url || "not configured"}</code>
            . Create a Google Cloud API key at{" "}
            <a
              className="underline"
              href="https://console.cloud.google.com/apis/credentials"
              target="_blank"
              rel="noreferrer"
            >
              console.cloud.google.com/apis/credentials
            </a>{" "}
            after enabling the{" "}
            <a
              className="underline"
              href="https://console.cloud.google.com/apis/library/chromeuxreport.googleapis.com"
              target="_blank"
              rel="noreferrer"
            >
              CrUX API
            </a>
            . Same Cloud project as GSC is fine. Low-traffic origins return 404
            (insufficient data) — that's normal until organic traffic accrues.
          </Text>
          <Input
            value={cruxInput}
            onChange={(e) => setCruxInput(e.target.value)}
            placeholder="AIza…"
            className="mt-2 font-mono text-xs"
          />
          <div className="mt-1 flex flex-wrap items-center gap-2">
            {view.crux_api_key.configured && (
              <Button
                variant="secondary"
                size="small"
                onClick={() => runIngest("crux")}
                isLoading={running === "crux"}
                disabled={running !== null}
              >
                <Play className="mr-1 h-3 w-3" />
                Run ingest now
              </Button>
            )}
            {view.crux_api_key.source === "db" && (
              <Button
                variant="transparent"
                size="small"
                onClick={() => onClear("crux")}
                disabled={saving}
              >
                Clear saved value
              </Button>
            )}
          </div>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3 border-t border-ui-border-base pt-3">
        <Button onClick={onSave} isLoading={saving} disabled={saving}>
          Save credentials
        </Button>
        <Button variant="transparent" size="small" onClick={refresh}>
          Refresh
        </Button>
        <Text size="xsmall" className="text-ui-fg-muted">
          Plaintext never leaves the backend — saved values are masked above
          and never echoed back.
        </Text>
      </div>
    </section>
  )
}

const CredentialHeader: React.FC<{
  label: string
  summary: CredentialFieldSummary
}> = ({ label, summary }) => {
  const sourceCopy =
    summary.source === "db"
      ? "Saved in admin"
      : summary.source === "env"
        ? "Using env var"
        : "Empty"
  return (
    <div className="mb-1 flex flex-wrap items-center gap-2">
      <Label className="font-bold">{label}</Label>
      {summary.configured ? (
        <Badge color="green">Ready</Badge>
      ) : (
        <Badge color="orange">Not configured</Badge>
      )}
      <Text size="xsmall" className="text-ui-fg-muted">
        {sourceCopy}
        {summary.last4 && (
          <>
            {" · ends in "}
            <code className="font-mono">{summary.last4}</code>
          </>
        )}
      </Text>
    </div>
  )
}

export default IntegrationsCard
