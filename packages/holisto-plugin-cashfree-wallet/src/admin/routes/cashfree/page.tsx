import React, { useCallback, useEffect, useMemo, useState } from "react"
import { defineRouteConfig } from "@medusajs/admin-sdk"
import {
  Button,
  Container,
  Heading,
  Input,
  Label,
  Select,
  StatusBadge,
  Switch,
  Text,
} from "@medusajs/ui"
import { Bolt } from "@medusajs/icons"

/**
 * /app/cashfree — Cashfree integrations admin page.
 *
 * Each Cashfree product (Payment Gateway, Payouts, Subscriptions,
 * Cross-border, Verification Suite / Secure ID) has its own isolated
 * credential set + webhook signing secret. Verification Suite is
 * production-only (no test keys in the Cashfree merchant dashboard).
 *
 * Every save is per-product, per-env — flipping the env pointer keeps
 * both envs' secrets intact (the backend routes writes to
 * `{env}_<product>_*` columns only).
 */

type CashfreeProduct =
  | "payment_gateway"
  | "payouts"
  | "subscriptions"
  | "cross_border"
  | "verification_suite"

type Env = "sandbox" | "production"

type EnvView = {
  client_id: string | null
  client_secret_set: boolean
  client_secret_masked: string | null
  webhook_secret_set: boolean
  webhook_secret_masked: string | null
}

type VerificationKinds = {
  pan: boolean
  aadhaar: boolean
  bank: boolean
  cmr: boolean
}

type ProductView = {
  product: CashfreeProduct
  enabled: boolean
  active_env: Env
  production_only: boolean
  envs: Record<Env, EnvView>
  beneficiary_name: string | null
  pg_notification_group: string | null
  /** Verification-Suite-only. null for every other product. */
  verification_kinds: VerificationKinds | null
  updated_at: string | null
}

type PingResult = {
  product: CashfreeProduct
  env: Env
  configured: Record<string, boolean>
  ping: { ok: boolean; message?: string; reason?: string }
} | null

const PRODUCT_ORDER: CashfreeProduct[] = [
  "payment_gateway",
  "payouts",
  "subscriptions",
  "cross_border",
  "verification_suite",
]

const PRODUCT_META: Record<
  CashfreeProduct,
  {
    title: string
    blurb: string
    dashboardPath: string
    webhookUrl: string | null
    showBeneficiaryName: boolean
  }
> = {
  payment_gateway: {
    title: "Payment Gateway",
    blurb:
      "Checkout + Auto-Collect (Virtual Bank Accounts for receiving UPI / NEFT / IMPS / RTGS). Uses one app key pair for both.",
    dashboardPath: "Cashfree dashboard → Developers → Payment Gateway → API Keys",
    webhookUrl: "<your-host>/webhooks/cashfree/payment-gateway",
    showBeneficiaryName: true,
  },
  payouts: {
    title: "Payouts",
    blurb: "Outbound disbursements to customer bank accounts.",
    dashboardPath: "Cashfree dashboard → Developers → Payouts → API Keys",
    webhookUrl: "<your-host>/webhooks/cashfree/payouts",
    showBeneficiaryName: false,
  },
  subscriptions: {
    title: "Subscriptions",
    blurb: "Recurring payment mandates (eNACH / UPI AutoPay / card).",
    dashboardPath:
      "Cashfree dashboard → Developers → Subscriptions → API Keys",
    webhookUrl: "<your-host>/webhooks/cashfree/subscriptions",
    showBeneficiaryName: false,
  },
  cross_border: {
    title: "Cross-border",
    blurb: "International inbound collections.",
    dashboardPath:
      "Cashfree dashboard → Developers → Cross-border → API Keys",
    webhookUrl: "<your-host>/webhooks/cashfree/cross-border",
    showBeneficiaryName: false,
  },
  verification_suite: {
    title: "Secure ID (Verification Suite)",
    blurb:
      "KYC: PAN / Aadhaar / bank-account verification. Demat / CMR is reviewed manually — not part of the Cashfree path. Production-only — Cashfree does not issue test-mode keys for this product in the merchant dashboard.",
    dashboardPath:
      "Cashfree dashboard → Verification Suite → Developers → API Keys",
    webhookUrl: "<your-host>/webhooks/cashfree/verification",
    showBeneficiaryName: false,
  },
}

const CashfreePage = () => {
  const [active, setActive] = useState<CashfreeProduct>("payment_gateway")
  const [views, setViews] = useState<Record<CashfreeProduct, ProductView> | null>(
    null
  )
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const refreshAll = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch("/admin/cashfree-products", {
        credentials: "include",
      })
      const body = await res.json()
      if (!res.ok) throw new Error(body.message || "load_failed")
      const map: Record<string, ProductView> = {}
      for (const v of body.products as ProductView[]) map[v.product] = v
      setViews(map as Record<CashfreeProduct, ProductView>)
    } catch (e) {
      setError(e instanceof Error ? e.message : "failed")
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    refreshAll()
  }, [refreshAll])

  return (
    <Container>
      <div className="mb-4 flex items-center gap-2">
        <Bolt />
        <Heading level="h1">Cashfree</Heading>
      </div>
      <Text size="small" className="text-ui-fg-subtle mb-4">
        Each Cashfree product has its own API key pair and webhook signing
        secret. Credentials are encrypted at rest and stored per environment
        — switching sandbox ↔ production preserves both sets.
      </Text>

      {error && (
        <div className="mb-4 rounded border border-red-200 bg-red-50 px-3 py-2 text-red-700">
          <Text>{error}</Text>
        </div>
      )}

      <div className="mb-6 flex flex-wrap gap-2">
        {PRODUCT_ORDER.map((p) => (
          <Button
            key={p}
            variant={active === p ? "primary" : "secondary"}
            onClick={() => setActive(p)}
          >
            {PRODUCT_META[p].title}
            {views?.[p]?.enabled && (
              <StatusBadge color="green" className="ml-2">
                on
              </StatusBadge>
            )}
          </Button>
        ))}
      </div>

      {views && (
        <ProductForm
          key={active}
          view={views[active]}
          onSaved={(next) =>
            setViews((prev) => prev && { ...prev, [next.product]: next })
          }
        />
      )}
      {!views && loading && <Text>Loading…</Text>}
    </Container>
  )
}

// ─────────────────────────────────────────────────────────────────
// Per-product form. Every field is optional-on-save:
//   - Empty secret input  → "leave as-is"
//   - `null` (not used here, but supported by API) → "clear"
// Switching env only flips the `active_env` pointer — sandbox creds and
// production creds coexist in separate columns.
// ─────────────────────────────────────────────────────────────────

/* ─────────────────────────────────────────────────────────────
 * Canonical host for webhook URLs. The original admin UI hard-coded
 * `<your-host>` which tripped users up on the copy step. We now
 * auto-derive the absolute URL from `window.location.origin` so the
 * "Copy" button pastes a ready-to-register value into Cashfree.
 * ─────────────────────────────────────────────────────────────*/
function resolveWebhookUrl(relative: string | null): string | null {
  if (!relative) return null
  if (typeof window === "undefined") return relative
  const origin = window.location.origin
  return `${origin}${relative.replace(/^<your-host>/, "")}`
}

/* ─────────────────────────────────────────────────────────────
 * Per-env credential section.
 *
 * Owns its own drafts (client_id / client_secret / webhook_secret) and
 * its own Save button. Sibling `EnvSection` for the other env lives
 * in parallel — they never fight because each save only writes to its
 * own env's columns on the backend (see
 * `saveCashfreeProductSettings`).
 * ─────────────────────────────────────────────────────────────*/
const EnvSection = ({
  product,
  env,
  envView,
  isActive,
  canActivate,
  onSaved,
}: {
  product: CashfreeProduct
  env: Env
  envView: EnvView
  isActive: boolean
  canActivate: boolean
  onSaved: (next: ProductView) => void
}) => {
  const [clientId, setClientId] = useState(envView.client_id ?? "")
  const [clientSecret, setClientSecret] = useState("")
  const [webhookSecret, setWebhookSecret] = useState("")
  const [saving, setSaving] = useState(false)
  const [flash, setFlash] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)

  // Sync local drafts when the parent view changes (e.g. after a
  // sibling section saves and we get fresh masked values).
  useEffect(() => {
    setClientId(envView.client_id ?? "")
    setClientSecret("")
    setWebhookSecret("")
  }, [envView.client_id, envView.client_secret_masked, envView.webhook_secret_masked])

  const save = async (options?: { activate?: boolean }) => {
    setSaving(true)
    setErr(null)
    setFlash(null)
    try {
      const body: Record<string, unknown> = { env }
      if (clientId.trim() !== (envView.client_id ?? "").trim()) {
        body.client_id = clientId.trim() === "" ? null : clientId.trim()
      }
      if (clientSecret.trim()) body.client_secret = clientSecret.trim()
      if (webhookSecret.trim()) body.webhook_secret = webhookSecret.trim()
      if (options?.activate) body.active_env = env
      const res = await fetch(
        `/admin/cashfree-products/${encodeURIComponent(product)}`,
        {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        }
      )
      const next = await res.json()
      if (!res.ok) throw new Error(next.message || "save_failed")
      onSaved(next)
      setClientSecret("")
      setWebhookSecret("")
      setFlash(options?.activate ? "Saved + activated" : "Saved")
      setTimeout(() => setFlash(null), 2500)
    } catch (e) {
      setErr(e instanceof Error ? e.message : "failed")
    } finally {
      setSaving(false)
    }
  }

  const envLabel = env === "sandbox" ? "Sandbox / Test mode" : "Production / Live mode"
  const accent = env === "sandbox" ? "orange" : "green"

  return (
    <div
      className={
        "flex flex-col gap-y-4 rounded-lg border p-5 " +
        (isActive
          ? "border-ui-border-interactive bg-ui-bg-subtle"
          : "border-ui-border-base bg-ui-bg-base")
      }
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <StatusBadge color={accent as "orange" | "green"}>{envLabel}</StatusBadge>
          {isActive ? (
            <StatusBadge color="blue">Active</StatusBadge>
          ) : null}
        </div>
        {envView.client_secret_set && envView.client_id ? (
          <StatusBadge color="green">Configured</StatusBadge>
        ) : (
          <StatusBadge color="grey">Not configured</StatusBadge>
        )}
      </div>

      {err && (
        <div className="rounded border border-red-200 bg-red-50 px-3 py-2 text-red-700">
          <Text size="small">{err}</Text>
        </div>
      )}

      <div className="flex flex-col gap-y-1">
        <Label size="small" weight="plus">
          Client ID
        </Label>
        <Input
          value={clientId}
          onChange={(e) => setClientId(e.target.value)}
          placeholder="paste client id"
        />
      </div>

      <div className="flex flex-col gap-y-1">
        <div className="flex items-center justify-between gap-2">
          <Label size="small" weight="plus">
            Client Secret
          </Label>
          {envView.client_secret_set ? (
            <Text size="xsmall" className="text-ui-fg-subtle">
              current {envView.client_secret_masked}
            </Text>
          ) : (
            <Text size="xsmall" className="text-ui-tag-red-text">
              not set
            </Text>
          )}
        </div>
        <Input
          type="password"
          value={clientSecret}
          onChange={(e) => setClientSecret(e.target.value)}
          placeholder={
            envView.client_secret_set ? "leave blank to keep" : "paste secret"
          }
        />
      </div>

      {product === "verification_suite" ? (
        // Verification Suite signs webhooks with the API client_secret
        // itself — Cashfree does NOT issue a separate webhook signing
        // secret for VRS (unlike Payment Gateway / Payouts / etc.). See
        // https://www.cashfree.com/docs/api-reference/vrs/webhook-signature-verification
        // ("Generate an HMAC-SHA256 hash of this string using your
        // client secret"). The backend's verification-webhook handler
        // falls back to `client_secret` for this product, so no
        // additional paste-in is needed. Hiding the input avoids the
        // "why is this field empty?" confusion ops kept running into.
        <div className="border-ui-border-base bg-ui-bg-subtle flex flex-col gap-y-1 rounded-md border border-dashed px-3 py-2">
          <Text size="small" weight="plus">
            Webhook signing — uses client secret
          </Text>
          <Text size="xsmall" className="text-ui-fg-subtle">
            Cashfree&apos;s Verification Suite signs webhook deliveries
            with the API client secret above (HMAC-SHA256 over
            timestamp + raw body). There is no separate webhook
            secret on the merchant dashboard for this product — just
            configure the webhook URL and Cashfree will sign with the
            API key pair.
          </Text>
        </div>
      ) : (
        <div className="flex flex-col gap-y-1">
          <div className="flex items-center justify-between gap-2">
            <Label size="small" weight="plus">
              Webhook signing secret
            </Label>
            {envView.webhook_secret_set ? (
              <Text size="xsmall" className="text-ui-fg-subtle">
                current {envView.webhook_secret_masked}
              </Text>
            ) : (
              <Text size="xsmall" className="text-ui-tag-red-text">
                not set
              </Text>
            )}
          </div>
          <Input
            type="password"
            value={webhookSecret}
            onChange={(e) => setWebhookSecret(e.target.value)}
            placeholder={
              envView.webhook_secret_set ? "leave blank to keep" : "paste secret"
            }
          />
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2 pt-1">
        <Button
          size="small"
          onClick={() => save()}
          isLoading={saving}
          disabled={saving}
        >
          Save {env}
        </Button>
        {canActivate && !isActive && (
          <Button
            size="small"
            variant="secondary"
            onClick={() => save({ activate: true })}
            isLoading={saving}
            disabled={saving}
          >
            Save &amp; switch to {env}
          </Button>
        )}
        {flash && <StatusBadge color="green">{flash}</StatusBadge>}
      </div>
    </div>
  )
}

const ProductForm = ({
  view,
  onSaved,
}: {
  view: ProductView
  onSaved: (next: ProductView) => void
}) => {
  const meta = PRODUCT_META[view.product]
  const [enabled, setEnabled] = useState(view.enabled)
  const [beneficiaryName, setBeneficiaryName] = useState(view.beneficiary_name ?? "")
  const [notifGroup, setNotifGroup] = useState(view.pg_notification_group ?? "")
  const [savingProductMeta, setSavingProductMeta] = useState(false)
  const [pinging, setPinging] = useState(false)
  const [metaFlash, setMetaFlash] = useState<string | null>(null)
  const [ping, setPing] = useState<PingResult>(null)
  const [err, setErr] = useState<string | null>(null)
  const [webhookUrlCopied, setWebhookUrlCopied] = useState(false)

  // Keep local toggles in sync when a sibling EnvSection save returns an
  // updated view (enabled / beneficiary_name might have been touched inline).
  useEffect(() => {
    setEnabled(view.enabled)
    setBeneficiaryName(view.beneficiary_name ?? "")
    setNotifGroup(view.pg_notification_group ?? "")
  }, [view.enabled, view.beneficiary_name, view.pg_notification_group])

  const saveProductMeta = async (
    nextEnabled: boolean,
    nextVbaPrefix: string,
    nextNotifGroup?: string,
  ) => {
    setSavingProductMeta(true)
    setErr(null)
    try {
      const body: Record<string, unknown> = {
        // POST requires an `env`; pick the currently-active one —
        // product-level fields (enabled / beneficiary_name / notification_group)
        // are written once and not env-scoped.
        env: view.active_env,
        enabled: nextEnabled,
      }
      if (view.product === "payment_gateway" && nextVbaPrefix !== (view.beneficiary_name ?? "")) {
        body.beneficiary_name = nextVbaPrefix
      }
      if (
        view.product === "payment_gateway" &&
        nextNotifGroup !== undefined &&
        nextNotifGroup !== (view.pg_notification_group ?? "")
      ) {
        body.pg_notification_group = nextNotifGroup
      }
      const res = await fetch(
        `/admin/cashfree-products/${encodeURIComponent(view.product)}`,
        {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        }
      )
      const next = await res.json()
      if (!res.ok) throw new Error(next.message || "save_failed")
      onSaved(next)
      setMetaFlash("Saved")
      setTimeout(() => setMetaFlash(null), 2500)
    } catch (e) {
      setErr(e instanceof Error ? e.message : "failed")
    } finally {
      setSavingProductMeta(false)
    }
  }

  const runPing = async () => {
    setPinging(true)
    setPing(null)
    try {
      const res = await fetch(
        `/admin/dev/cashfree-ping?product=${encodeURIComponent(view.product)}`,
        { credentials: "include" }
      )
      const body = await res.json()
      setPing(body)
    } catch (e) {
      setPing({
        product: view.product,
        env: view.active_env,
        configured: {},
        ping: { ok: false, reason: e instanceof Error ? e.message : "unknown" },
      })
    } finally {
      setPinging(false)
    }
  }

  const copyWebhookUrl = async () => {
    const abs = resolveWebhookUrl(meta.webhookUrl)
    if (!abs) return
    try {
      await navigator.clipboard.writeText(abs)
      setWebhookUrlCopied(true)
      setTimeout(() => setWebhookUrlCopied(false), 2000)
    } catch {
      /* ignore — user can still copy manually */
    }
  }

  const webhookUrlAbsolute = resolveWebhookUrl(meta.webhookUrl)

  return (
    <div className="bg-ui-bg-base border-ui-border-base flex flex-col gap-y-5 rounded-lg border p-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <Heading level="h2">{meta.title}</Heading>
          <Text size="small" className="text-ui-fg-subtle">
            {meta.blurb}
          </Text>
        </div>
        {/* Big, clear status badge — readable at a glance */}
        {enabled ? (
          <StatusBadge color="green">Active</StatusBadge>
        ) : (
          <StatusBadge color="red">Disabled</StatusBadge>
        )}
      </div>

      {err && (
        <div className="rounded border border-red-200 bg-red-50 px-3 py-2 text-red-700">
          <Text>{err}</Text>
        </div>
      )}

      {/* Enable toggle — pill style with unmistakable ON/OFF label */}
      <div className="border-ui-border-base bg-ui-bg-subtle flex flex-col gap-y-3 rounded-md border p-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <Text weight="plus">
              {enabled
                ? "This product is enabled"
                : "This product is disabled"}
            </Text>
            <StatusBadge color={enabled ? "green" : "grey"}>
              {enabled ? "ON" : "OFF"}
            </StatusBadge>
          </div>
          <Text size="small" className="text-ui-fg-subtle">
            {enabled
              ? "Runtime will route calls to Cashfree using the active environment below."
              : "Runtime refuses calls for this product with a clear \"product disabled\" error."}
          </Text>
        </div>
        <div className="flex items-center gap-3">
          <Switch
            checked={enabled}
            onCheckedChange={(v) => {
              setEnabled(v)
              void saveProductMeta(v, beneficiaryName, notifGroup)
            }}
          />
          {metaFlash && <StatusBadge color="green">{metaFlash}</StatusBadge>}
          {savingProductMeta && (
            <Text size="xsmall" className="text-ui-fg-subtle">
              saving…
            </Text>
          )}
        </div>
      </div>

      {/* Verification Suite: per-kind toggles. Granular control over which
          of the four user-visible steps actually runs against Cashfree.
          Flipping a kind off hides the step on the storefront checklist
          AND causes the corresponding /store/kyc/* route to refuse with
          403. The master "This product is enabled" switch above overrides
          all four — when master is off, nothing is live regardless of
          these per-kind toggles. */}
      {view.product === "verification_suite" && (
        <VerificationKindsPanel view={view} onSaved={onSaved} />
      )}

      {/* Credentials dashboard hint */}
      <div>
        <Heading level="h3">Credentials</Heading>
        <Text size="small" className="text-ui-fg-subtle">
          {meta.dashboardPath}
        </Text>
      </div>

      {/* Side-by-side Sandbox + Production sections.
          Each section has its own Save button, its own Configured status,
          and keeps its secrets isolated from the other env. */}
      {view.production_only ? (
        <EnvSection
          product={view.product}
          env="production"
          envView={view.envs.production}
          isActive={true}
          canActivate={false}
          onSaved={onSaved}
        />
      ) : (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <EnvSection
            product={view.product}
            env="sandbox"
            envView={view.envs.sandbox}
            isActive={view.active_env === "sandbox"}
            canActivate={true}
            onSaved={onSaved}
          />
          <EnvSection
            product={view.product}
            env="production"
            envView={view.envs.production}
            isActive={view.active_env === "production"}
            canActivate={true}
            onSaved={onSaved}
          />
        </div>
      )}

      {/* Default beneficiary name (PG only) — fallback used when a
          per-customer VBA isn't being created. Per-customer VBAs
          override with the customer's PAN-verified name; this value
          is only consulted for shared / marketing VBA flows. */}
      {meta.showBeneficiaryName && (
        <div className="border-ui-border-base flex flex-col gap-y-2 rounded-md border p-4">
          <div className="flex items-center justify-between gap-2">
            <Label size="small" weight="plus">
              Default beneficiary name
            </Label>
            <Text size="xsmall" className="text-ui-fg-subtle">
              fallback for shared VBAs only — per-customer VBAs always show the customer's PAN name
            </Text>
          </div>
          <div className="flex items-center gap-2">
            <Input
              value={beneficiaryName}
              onChange={(e) => setBeneficiaryName(e.target.value)}
              placeholder="POLEMARCH"
            />
            <Button
              size="small"
              variant="secondary"
              onClick={() => saveProductMeta(enabled, beneficiaryName, notifGroup)}
              disabled={savingProductMeta || beneficiaryName === (view.beneficiary_name ?? "")}
            >
              Update
            </Button>
          </div>
        </div>
      )}

      {/* Notification group (PG only) — required by Cashfree's /pg/vba
          API (2024-07-10+). The admin pastes the group name exactly as
          they created it in Cashfree dashboard → Auto-Collect →
          Notifications. Without this, VBA provisioning fails with
          Cashfree's `notif_group_not_exists` error. */}
      {meta.showBeneficiaryName && (
        <div className="border-ui-border-base flex flex-col gap-y-2 rounded-md border p-4">
          <div className="flex items-center justify-between gap-2">
            <Label size="small" weight="plus">
              Auto-Collect notification group
            </Label>
            <Text size="xsmall" className="text-ui-fg-subtle">
              Cashfree dashboard → Auto-Collect → Notifications → Group name
            </Text>
          </div>
          <div className="flex items-center gap-2">
            <Input
              value={notifGroup}
              onChange={(e) => setNotifGroup(e.target.value)}
              placeholder="e.g. POLEMARCH_DEFAULT"
            />
            <Button
              size="small"
              variant="secondary"
              onClick={() => saveProductMeta(enabled, beneficiaryName, notifGroup)}
              disabled={
                savingProductMeta ||
                notifGroup === (view.pg_notification_group ?? "")
              }
            >
              Update
            </Button>
          </div>
          <Text size="xsmall" className="text-ui-fg-subtle">
            Required for VBA provisioning. Without it, wallet deposits via
            virtual accounts will fail.
          </Text>
        </div>
      )}

      {/* Webhook URL — copy button built in so the admin can paste
          directly into Cashfree without hand-rewriting the host. */}
      {webhookUrlAbsolute && (
        <div className="border-ui-border-base bg-ui-bg-subtle flex flex-col gap-y-2 rounded-md border p-4">
          <div className="flex items-center justify-between gap-2">
            <Text size="small" weight="plus">
              Webhook URL to register in Cashfree
            </Text>
            <Button
              size="small"
              variant="secondary"
              onClick={copyWebhookUrl}
              disabled={webhookUrlCopied}
            >
              {webhookUrlCopied ? "Copied" : "Copy URL"}
            </Button>
          </div>
          <code className="text-ui-fg-base break-all rounded bg-ui-bg-base px-2 py-1 text-xs">
            {webhookUrlAbsolute}
          </code>
          <Text size="xsmall" className="text-ui-fg-subtle">
            Cashfree dashboard → Developers → Webhooks → Add endpoint.
            Paste the signing secret shown there into the env section
            above before enabling the product.
          </Text>
        </div>
      )}

      {/* Test-connection row */}
      <div className="border-ui-border-base flex flex-wrap items-center gap-3 border-t pt-4">
        <Button
          variant="secondary"
          onClick={runPing}
          isLoading={pinging}
          disabled={pinging}
        >
          Test connection ({view.active_env})
        </Button>
        {view.updated_at && (
          <Text size="xsmall" className="text-ui-fg-subtle">
            last saved {new Date(view.updated_at).toLocaleString()}
          </Text>
        )}
      </div>

      {/* Ping result */}
      {ping && (
        <div className="border-ui-border-base flex flex-col gap-y-2 rounded-md border p-4">
          <div className="flex items-center justify-between">
            <Text weight="plus">
              {ping.ping.ok
                ? "✓ Cashfree credentials work"
                : "✗ Cashfree ping failed"}
            </Text>
            <StatusBadge color={ping.ping.ok ? "green" : "red"}>
              env: {ping.env}
            </StatusBadge>
          </div>
          <Text size="small" className="text-ui-fg-subtle">
            {ping.ping.message ?? ping.ping.reason ?? ""}
          </Text>
          <div className="flex flex-wrap gap-1">
            {Object.entries(ping.configured ?? {}).map(([k, v]) => (
              <StatusBadge key={k} color={v ? "green" : "red"}>
                {k}: {v ? "yes" : "no"}
              </StatusBadge>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

/**
 * Per-kind toggles for the Verification Suite. Each switch is saved
 * independently with an optimistic flip + rollback on error. The backend
 * accepts a partial `verification_kinds` map so we never accidentally
 * overwrite a sibling kind the admin didn't touch.
 */
const KIND_META: Array<{
  key: keyof VerificationKinds
  title: string
  blurb: string
}> = [
  {
    key: "pan",
    title: "PAN",
    blurb:
      "Live PAN validation + name-on-PAN match via Cashfree Secure ID. Customer sees step 1 on /dashboard/kyc.",
  },
  {
    key: "aadhaar",
    title: "Aadhaar OTP",
    blurb:
      "OTP-based Aadhaar verification (UIDAI via Cashfree). Customer sees step 2 on /dashboard/kyc.",
  },
  {
    key: "bank",
    title: "Bank penny-drop",
    blurb:
      "Penny-drop verification of bank accounts added from /dashboard/bank-accounts. Disabling turns off every new bank's auto-verify.",
  },
  // CMR / demat verification deliberately omitted — Cashfree's CMR
  // endpoint is no longer in our suite; demat is now manually
  // approved via /app/customer-360 → Accounts. Leaving the toggle
  // here would imply we support a Cashfree path that doesn't exist.
]

const VerificationKindsPanel = ({
  view,
  onSaved,
}: {
  view: ProductView
  onSaved: (next: ProductView) => void
}) => {
  const initial: VerificationKinds = view.verification_kinds ?? {
    pan: true,
    aadhaar: true,
    bank: true,
    cmr: true,
  }
  const [kinds, setKinds] = useState<VerificationKinds>(initial)
  const [savingKey, setSavingKey] = useState<keyof VerificationKinds | null>(
    null
  )
  const [err, setErr] = useState<string | null>(null)

  // Keep local state in sync when a sibling save returns a fresh view.
  useEffect(() => {
    if (view.verification_kinds) setKinds(view.verification_kinds)
  }, [view.verification_kinds])

  const toggleKind = async (key: keyof VerificationKinds, next: boolean) => {
    const prev = kinds[key]
    setSavingKey(key)
    setErr(null)
    setKinds((k) => ({ ...k, [key]: next }))
    try {
      const res = await fetch(
        `/admin/cashfree-products/${encodeURIComponent(view.product)}`,
        {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          // Partial map — only this one kind is written. Sibling kinds
          // are left alone by the backend's explicit-key check.
          body: JSON.stringify({
            env: view.active_env,
            verification_kinds: { [key]: next },
          }),
        }
      )
      const nextView = await res.json()
      if (!res.ok) throw new Error(nextView.message || "save_failed")
      onSaved(nextView)
    } catch (e) {
      // Roll back optimistic flip on error so the UI matches server state.
      setKinds((k) => ({ ...k, [key]: prev }))
      setErr(e instanceof Error ? e.message : "failed")
    } finally {
      setSavingKey(null)
    }
  }

  return (
    <div className="border-ui-border-base bg-ui-bg-subtle flex flex-col gap-y-3 rounded-md border p-4">
      <div className="flex items-center justify-between gap-2">
        <div>
          <Text weight="plus">Secure ID features on the storefront</Text>
          <Text size="small" className="text-ui-fg-subtle">
            Flip any step off to hide it from the customer checklist at
            /dashboard/kyc and refuse the matching /store/kyc/* call
            with 403. Each step is independent; the master toggle above
            overrides all four.
          </Text>
        </div>
      </div>
      {err && (
        <div className="rounded border border-red-200 bg-red-50 px-3 py-2 text-red-700">
          <Text size="small">{err}</Text>
        </div>
      )}
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        {KIND_META.map((k) => (
          <div
            key={k.key}
            className="border-ui-border-base bg-ui-bg-base flex items-start justify-between gap-3 rounded-md border p-3"
          >
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <Text weight="plus" size="small">
                  {k.title}
                </Text>
                <StatusBadge color={kinds[k.key] ? "green" : "grey"}>
                  {kinds[k.key] ? "ON" : "OFF"}
                </StatusBadge>
              </div>
              <Text size="xsmall" className="text-ui-fg-subtle">
                {k.blurb}
              </Text>
            </div>
            <Switch
              checked={kinds[k.key]}
              onCheckedChange={(v) => toggleKind(k.key, v)}
              disabled={savingKey !== null}
            />
          </div>
        ))}
      </div>
    </div>
  )
}

export const config = defineRouteConfig({
  label: "Cashfree",
  icon: Bolt,
})

export default CashfreePage
