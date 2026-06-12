import React, { useCallback, useEffect, useState } from "react"
import { defineRouteConfig } from "@medusajs/admin-sdk"
import {
  Button,
  Container,
  Heading,
  Input,
  Label,
  Select,
  StatusBadge,
  Table,
  Text,
  Textarea,
} from "@medusajs/ui"
import { Cash, ChevronDown, ChevronRight } from "@medusajs/icons"
import CustomerSearch from "../../components/CustomerSearch"

type HeldOrder = {
  id: string
  cart_id: string
  customer_id: string
  amount_inr: number
  wallet_balance_at_init: number
  shortfall_inr: number
  status: string
  created_at: string
}

type WebhookEvent = {
  id: string
  channel: string
  event_id: string
  event_type: string | null
  processing_status: string
  processing_error: string | null
  created_at: string
}

type SecureIdRow = {
  id: string
  customer_id: string
  kind: string
  status: string
  input_masked: string | null
  created_at: string
}

type WalletSummary = {
  customer_id: string
  balance_inr: number
  /** Non-withdrawable promo bucket (paise). Funded by referrals +
   *  points conversion. Spendable at checkout subject to the per-tx
   *  cap; admin can credit/debit via the manual-adjust form below. */
  promo_balance_inr: number
  status: string
  virtual_account: {
    virtual_account_number: string
    ifsc: string
    upi_id: string | null
  } | null
}

type WalletTx = {
  id: string
  direction: "credit" | "debit"
  amount_inr: number
  balance_after: number
  kind: string
  reference_id: string | null
  note: string | null
  created_at: string
}

type CustomerInfo = {
  id: string
  email: string
  first_name: string | null
  last_name: string | null
  phone: string | null
  pan_card_file_url: string | null
  aadhaar_card_file_url: string | null
} | null

type KycInfo = {
  overall: "not_started" | "in_progress" | "approved" | "rejected"
  pan_verified: boolean
  aadhaar_verified: boolean
  has_verified_bank: boolean
  has_primary_demat: boolean
  last_failure_reason?: string | null
} | null

type BankRow = {
  id: string
  account_holder_name: string
  account_number_last4: string
  ifsc: string
  bank_name: string | null
  verification_status: "pending" | "verified" | "failed" | "name_mismatch"
  is_primary: boolean
  verified_at: string | null
  bank_proof_file_url: string | null
  bank_proof_type: "cheque" | "passbook" | "statement" | null
}

type DematRow = {
  id: string
  depository: "NSDL" | "CDSL"
  dp_name: string
  account_holder_name: string
  cmr_file_url: string | null
  verification_status: "pending" | "verified" | "failed" | "name_mismatch"
  is_primary: boolean
}

const formatINR = (paise: number) =>
  new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 2,
  }).format((paise || 0) / 100)

type CashfreeSettingsView = {
  env: "sandbox" | "production"
  client_id: string | null
  client_secret_set: boolean
  client_secret_masked: string | null
  payouts_client_id: string | null
  payouts_client_secret_set: boolean
  payouts_client_secret_masked: string | null
  webhook_secret_set: boolean
  webhook_secret_masked: string | null
  verify_webhook_secret_set: boolean
  verify_webhook_secret_masked: string | null
  beneficiary_name: string | null
  updated_at: string | null
  env_fallback_active: {
    client_id: boolean
    client_secret: boolean
    payouts_client_id: boolean
    payouts_client_secret: boolean
    webhook_secret: boolean
    verify_webhook_secret: boolean
  }
}

type CashfreePingResult = {
  env: string
  configured: Record<string, boolean>
  ping: { ok: boolean; message?: string; reason?: string }
} | null

const WalletAdminPage = () => {
  const [tab, setTab] = useState<
    "held" | "webhooks" | "secureid" | "lookup"
  >("held")
  const [held, setHeld] = useState<HeldOrder[]>([])
  const [webhooks, setWebhooks] = useState<WebhookEvent[]>([])
  const [secureIds, setSecureIds] = useState<SecureIdRow[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // customer wallet lookup — id comes from the CustomerSearch picker
  // below. The optional `pickedLabel` is just the human-friendly label
  // so the admin can see who they're looking at after selection.
  const [customerId, setCustomerId] = useState("")
  const [pickedLabel, setPickedLabel] = useState<string | null>(null)
  const [adjustOpen, setAdjustOpen] = useState(false)
  const [walletSummary, setWalletSummary] = useState<WalletSummary | null>(null)
  const [walletTxs, setWalletTxs] = useState<WalletTx[]>([])
  const [walletCustomer, setWalletCustomer] = useState<CustomerInfo>(null)
  const [walletKyc, setWalletKyc] = useState<KycInfo>(null)
  const [walletBanks, setWalletBanks] = useState<BankRow[]>([])
  const [walletDemats, setWalletDemats] = useState<DematRow[]>([])
  const [manualReason, setManualReason] = useState("")
  const [adjustAmount, setAdjustAmount] = useState("")
  const [adjustReason, setAdjustReason] = useState("")
  const [adjustDirection, setAdjustDirection] = useState<"credit" | "debit">(
    "credit"
  )
  const [adjustBucket, setAdjustBucket] = useState<"main" | "promo">("main")
  const [adjustReasonCode, setAdjustReasonCode] =
    useState<"promo" | "goodwill" | "reconciliation" | "correction" | "other">(
      "goodwill",
    )

  // ── Cashfree Settings ──
  const [settings, setSettings] = useState<CashfreeSettingsView | null>(null)
  // Form drafts. Empty string means "leave existing value alone" for secrets.
  const [draftEnv, setDraftEnv] = useState<"sandbox" | "production">("sandbox")
  const [draftClientId, setDraftClientId] = useState("")
  const [draftClientSecret, setDraftClientSecret] = useState("")
  const [draftPayoutsClientId, setDraftPayoutsClientId] = useState("")
  const [draftPayoutsClientSecret, setDraftPayoutsClientSecret] = useState("")
  const [draftWebhookSecret, setDraftWebhookSecret] = useState("")
  const [draftVerifyWebhookSecret, setDraftVerifyWebhookSecret] = useState("")
  const [draftBeneficiaryName, setDraftBeneficiaryName] = useState("")
  const [savedFlash, setSavedFlash] = useState(false)
  const [pingResult, setPingResult] = useState<CashfreePingResult>(null)
  const [pinging, setPinging] = useState(false)

  const refreshHeld = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch("/admin/held-orders?limit=100", {
        credentials: "include",
      })
      const body = await res.json()
      if (!res.ok) throw new Error(body.message || "Failed to load held orders")
      setHeld(body.held_orders ?? [])
    } catch (e) {
      setError(e instanceof Error ? e.message : "failed")
    } finally {
      setLoading(false)
    }
  }, [])

  const refreshWebhooks = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch("/admin/webhook-events?limit=100", {
        credentials: "include",
      })
      const body = await res.json()
      setWebhooks(body.events ?? [])
    } finally {
      setLoading(false)
    }
  }, [])

  const refreshSecureId = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch(
        "/admin/secure-id-verifications?limit=100",
        { credentials: "include" }
      )
      const body = await res.json()
      setSecureIds(body.verifications ?? [])
    } finally {
      setLoading(false)
    }
  }, [])

  const refreshSettings = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch("/admin/cashfree-settings", {
        credentials: "include",
      })
      const body = await res.json()
      if (!res.ok) throw new Error(body.message || "Failed to load settings")
      setSettings(body)
      setDraftEnv(body.env)
      setDraftClientId(body.client_id ?? "")
      setDraftPayoutsClientId(body.payouts_client_id ?? "")
      setDraftBeneficiaryName(body.beneficiary_name ?? "")
      // Secret inputs always start blank — submitting blank means "leave as-is"
      setDraftClientSecret("")
      setDraftPayoutsClientSecret("")
      setDraftWebhookSecret("")
      setDraftVerifyWebhookSecret("")
    } catch (e) {
      setError(e instanceof Error ? e.message : "failed")
    } finally {
      setLoading(false)
    }
  }, [])

  const saveSettings = async () => {
    setLoading(true)
    setError(null)
    setSavedFlash(false)
    try {
      const payload: Record<string, unknown> = {
        env: draftEnv,
        client_id: draftClientId,
        payouts_client_id: draftPayoutsClientId,
        beneficiary_name: draftBeneficiaryName,
      }
      // Only include secrets when the admin actually typed something — empty
      // string means "no change".
      if (draftClientSecret.trim()) payload.client_secret = draftClientSecret
      if (draftPayoutsClientSecret.trim())
        payload.payouts_client_secret = draftPayoutsClientSecret
      if (draftWebhookSecret.trim())
        payload.webhook_secret = draftWebhookSecret
      if (draftVerifyWebhookSecret.trim())
        payload.verify_webhook_secret = draftVerifyWebhookSecret

      const res = await fetch("/admin/cashfree-settings", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      })
      const body = await res.json()
      if (!res.ok) throw new Error(body.message || "Save failed")
      setSettings(body)
      setSavedFlash(true)
      setTimeout(() => setSavedFlash(false), 2500)
      // Clear secret drafts so re-saving doesn't accidentally rewrite
      setDraftClientSecret("")
      setDraftPayoutsClientSecret("")
      setDraftWebhookSecret("")
      setDraftVerifyWebhookSecret("")
    } catch (e) {
      setError(e instanceof Error ? e.message : "failed")
    } finally {
      setLoading(false)
    }
  }

  const runPing = async () => {
    setPinging(true)
    setPingResult(null)
    try {
      const res = await fetch("/admin/dev/cashfree-ping", {
        credentials: "include",
      })
      const body = await res.json()
      setPingResult(body)
    } catch (e) {
      setPingResult({
        env: "unknown",
        configured: {},
        ping: { ok: false, reason: e instanceof Error ? e.message : "unknown" },
      })
    } finally {
      setPinging(false)
    }
  }

  const loadWallet = async () => {
    if (!customerId.trim()) return
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(
        `/admin/wallets/${encodeURIComponent(customerId.trim())}`,
        { credentials: "include" }
      )
      const body = await res.json()
      if (!res.ok) throw new Error(body.message || "Failed")
      setWalletSummary(body.wallet)
      setWalletTxs(body.transactions ?? [])
      setWalletCustomer(body.customer ?? null)
      setWalletKyc(body.kyc ?? null)
      setWalletBanks(body.banks ?? [])
      setWalletDemats(body.demats ?? [])
    } catch (e) {
      setError(e instanceof Error ? e.message : "failed")
      setWalletSummary(null)
      setWalletTxs([])
      setWalletCustomer(null)
      setWalletKyc(null)
      setWalletBanks([])
      setWalletDemats([])
    } finally {
      setLoading(false)
    }
  }

  /** Manual verify actions — all require a reason (enforced by backend too). */
  const manualPanAadhaar = async (
    kind: "pan" | "aadhaar",
    decision: "approved" | "rejected"
  ) => {
    if (!walletCustomer?.id) return
    if (!manualReason.trim()) {
      setError("Reason is required")
      return
    }
    setLoading(true)
    setError(null)
    try {
      const body: Record<string, unknown> = { reason: manualReason }
      if (kind === "pan") {
        body[decision === "approved" ? "pan_approve" : "pan_reject"] = true
      } else {
        body[decision === "approved" ? "aadhaar_approve" : "aadhaar_reject"] =
          true
      }
      const res = await fetch(
        `/admin/customers/${encodeURIComponent(walletCustomer.id)}/kyc/manual`,
        {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        }
      )
      const r = await res.json()
      if (!res.ok) throw new Error(r.message || "Failed")
      await loadWallet()
    } catch (e) {
      setError(e instanceof Error ? e.message : "failed")
    } finally {
      setLoading(false)
    }
  }

  const manualVerifyBank = async (
    bankId: string,
    decision: "approved" | "rejected"
  ) => {
    if (!manualReason.trim()) {
      setError("Reason is required")
      return
    }
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(
        `/admin/bank-accounts/${encodeURIComponent(bankId)}/verify`,
        {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            decision,
            reason: manualReason,
            provision_vba: decision === "approved",
          }),
        }
      )
      const r = await res.json()
      if (!res.ok) throw new Error(r.message || "Failed")
      await loadWallet()
    } catch (e) {
      setError(e instanceof Error ? e.message : "failed")
    } finally {
      setLoading(false)
    }
  }

  const manualVerifyDemat = async (
    dematId: string,
    decision: "approved" | "rejected",
    makePrimary: boolean
  ) => {
    if (!manualReason.trim()) {
      setError("Reason is required")
      return
    }
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(
        `/admin/demat-accounts/${encodeURIComponent(dematId)}/verify`,
        {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            decision,
            reason: manualReason,
            make_primary: makePrimary,
          }),
        }
      )
      const r = await res.json()
      if (!res.ok) throw new Error(r.message || "Failed")
      await loadWallet()
    } catch (e) {
      setError(e instanceof Error ? e.message : "failed")
    } finally {
      setLoading(false)
    }
  }

  const adjustWallet = async () => {
    if (
      !customerId.trim() ||
      !adjustAmount ||
      !adjustReason ||
      adjustReason.trim().length < 20
    )
      return
    setLoading(true)
    setError(null)
    try {
      const paise = Math.round(Number(adjustAmount) * 100)
      const res = await fetch(
        `/admin/wallets/${encodeURIComponent(customerId.trim())}/adjust`,
        {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            direction: adjustDirection,
            amount_inr: paise,
            note: adjustReason.trim(),
            reason_code: adjustReasonCode,
            bucket: adjustBucket,
          }),
        }
      )
      const body = await res.json()
      if (!res.ok)
        throw new Error(
          body.debit?.reason ||
            body.message ||
            body.reason ||
            "Failed",
        )
      setAdjustAmount("")
      setAdjustReason("")
      await loadWallet()
    } catch (e) {
      setError(e instanceof Error ? e.message : "failed")
    } finally {
      setLoading(false)
    }
  }

  const cancelHeld = async (id: string) => {
    if (!confirm("Cancel this held attempt?")) return
    try {
      const res = await fetch(`/admin/held-orders/${id}/cancel`, {
        method: "POST",
        credentials: "include",
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(body.message || "Failed")
      }
      await refreshHeld()
    } catch (e) {
      setError(e instanceof Error ? e.message : "failed")
    }
  }

  useEffect(() => {
    if (tab === "held") refreshHeld()
    else if (tab === "webhooks") refreshWebhooks()
    else if (tab === "secureid") refreshSecureId()
  }, [tab, refreshHeld, refreshWebhooks, refreshSecureId])

  const badgeColor = (s: string) =>
    s === "held" || s === "received" || s === "processing" || s === "pending"
      ? ("orange" as const)
      : s === "captured" || s === "processed" || s === "success" || s === "verified"
        ? ("green" as const)
        : s === "failed" || s === "rejected" || s === "cancelled"
          ? ("red" as const)
          : ("grey" as const)

  return (
    <Container>
      <div className="mb-4 flex items-center gap-2">
        <Cash />
        <Heading level="h1">Wallet</Heading>
      </div>
      <Text size="small" className="text-ui-fg-subtle mb-4">
        Operational view: held orders, customer wallets, Cashfree webhook
        events, and Secure ID audit trail. Cashfree integration credentials
        are configured on the separate <strong>Cashfree</strong> page.
      </Text>

      <div className="mb-6 flex gap-2">
        <Button
          variant={tab === "held" ? "primary" : "secondary"}
          onClick={() => setTab("held")}
        >
          Held orders
        </Button>
        <Button
          variant={tab === "lookup" ? "primary" : "secondary"}
          onClick={() => setTab("lookup")}
        >
          Customer wallet
        </Button>
        <Button
          variant={tab === "webhooks" ? "primary" : "secondary"}
          onClick={() => setTab("webhooks")}
        >
          Webhook events
        </Button>
        <Button
          variant={tab === "secureid" ? "primary" : "secondary"}
          onClick={() => setTab("secureid")}
        >
          Secure ID audit
        </Button>
      </div>

      {error && (
        <div className="mb-4 rounded border border-red-200 bg-red-50 px-3 py-2 text-red-700">
          <Text>{error}</Text>
        </div>
      )}

      {tab === "held" && (
        <Table>
          <Table.Header>
            <Table.Row>
              <Table.HeaderCell>When</Table.HeaderCell>
              <Table.HeaderCell>Customer</Table.HeaderCell>
              <Table.HeaderCell>Cart</Table.HeaderCell>
              <Table.HeaderCell>Amount</Table.HeaderCell>
              <Table.HeaderCell>Shortfall</Table.HeaderCell>
              <Table.HeaderCell>Status</Table.HeaderCell>
              <Table.HeaderCell>Action</Table.HeaderCell>
            </Table.Row>
          </Table.Header>
          <Table.Body>
            {held.map((h) => (
              <Table.Row key={h.id}>
                <Table.Cell>{new Date(h.created_at).toLocaleString()}</Table.Cell>
                <Table.Cell>
                  <code>{h.customer_id}</code>
                </Table.Cell>
                <Table.Cell>
                  <code>{h.cart_id}</code>
                </Table.Cell>
                <Table.Cell>{formatINR(h.amount_inr)}</Table.Cell>
                <Table.Cell>{formatINR(h.shortfall_inr)}</Table.Cell>
                <Table.Cell>
                  <StatusBadge color={badgeColor(h.status)}>{h.status}</StatusBadge>
                </Table.Cell>
                <Table.Cell>
                  {(h.status === "held" || h.status === "initiated") && (
                    <Button size="small" variant="secondary" onClick={() => cancelHeld(h.id)}>
                      Cancel
                    </Button>
                  )}
                </Table.Cell>
              </Table.Row>
            ))}
          </Table.Body>
        </Table>
      )}

      {tab === "webhooks" && (
        <Table>
          <Table.Header>
            <Table.Row>
              <Table.HeaderCell>When</Table.HeaderCell>
              <Table.HeaderCell>Channel</Table.HeaderCell>
              <Table.HeaderCell>Event ID</Table.HeaderCell>
              <Table.HeaderCell>Type</Table.HeaderCell>
              <Table.HeaderCell>Status</Table.HeaderCell>
              <Table.HeaderCell>Error</Table.HeaderCell>
            </Table.Row>
          </Table.Header>
          <Table.Body>
            {webhooks.map((w) => (
              <Table.Row key={w.id}>
                <Table.Cell>{new Date(w.created_at).toLocaleString()}</Table.Cell>
                <Table.Cell>{w.channel}</Table.Cell>
                <Table.Cell>
                  <code>{w.event_id}</code>
                </Table.Cell>
                <Table.Cell>{w.event_type ?? "—"}</Table.Cell>
                <Table.Cell>
                  <StatusBadge color={badgeColor(w.processing_status)}>
                    {w.processing_status}
                  </StatusBadge>
                </Table.Cell>
                <Table.Cell>{w.processing_error ?? ""}</Table.Cell>
              </Table.Row>
            ))}
          </Table.Body>
        </Table>
      )}

      {tab === "secureid" && (
        <Table>
          <Table.Header>
            <Table.Row>
              <Table.HeaderCell>When</Table.HeaderCell>
              <Table.HeaderCell>Customer</Table.HeaderCell>
              <Table.HeaderCell>Kind</Table.HeaderCell>
              <Table.HeaderCell>Status</Table.HeaderCell>
              <Table.HeaderCell>Input</Table.HeaderCell>
            </Table.Row>
          </Table.Header>
          <Table.Body>
            {secureIds.map((s) => (
              <Table.Row key={s.id}>
                <Table.Cell>{new Date(s.created_at).toLocaleString()}</Table.Cell>
                <Table.Cell>
                  <code>{s.customer_id}</code>
                </Table.Cell>
                <Table.Cell>{s.kind}</Table.Cell>
                <Table.Cell>
                  <StatusBadge color={badgeColor(s.status)}>{s.status}</StatusBadge>
                </Table.Cell>
                <Table.Cell>
                  <code>{s.input_masked ?? "—"}</code>
                </Table.Cell>
              </Table.Row>
            ))}
          </Table.Body>
        </Table>
      )}

      {tab === "lookup" && (
        <div className="space-y-4">
          {/* Customer picker — start typing email, name, phone, or id. */}
          <div className="flex flex-col gap-2">
            <div className="flex items-center gap-2">
              <CustomerSearch
                onPick={(c) => {
                  setCustomerId(c.id)
                  const name =
                    [c.first_name, c.last_name].filter(Boolean).join(" ") || "—"
                  const contact = [c.email, c.phone].filter(Boolean).join(" · ")
                  setPickedLabel(`${name} · ${contact || c.id}`)
                }}
              />
              <Button onClick={loadWallet} disabled={!customerId || loading}>
                Load
              </Button>
            </div>
            {pickedLabel && (
              <div className="flex items-center gap-2 rounded-md border border-ui-border-base bg-ui-bg-subtle px-3 py-1.5">
                <Text size="small" className="flex-1 truncate">
                  {pickedLabel}
                </Text>
                <code className="text-xs text-ui-fg-muted">{customerId}</code>
                <Button
                  variant="transparent"
                  size="small"
                  onClick={() => {
                    setCustomerId("")
                    setPickedLabel(null)
                    setWalletSummary(null)
                    setWalletTxs([])
                    setWalletCustomer(null)
                  }}
                >
                  Clear
                </Button>
              </div>
            )}
          </div>

          {walletSummary && (
            <div className="rounded-lg border border-ui-border-base bg-ui-bg-subtle p-5">
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1">
                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                    {/* Main balance */}
                    <div>
                      <Text size="small" className="mb-1 text-ui-fg-subtle">
                        Main balance
                      </Text>
                      <div className="flex items-baseline gap-3">
                        <Heading level="h1" className="text-ui-fg-base">
                          {formatINR(walletSummary.balance_inr)}
                        </Heading>
                        <StatusBadge color={badgeColor(walletSummary.status)}>
                          {walletSummary.status}
                        </StatusBadge>
                      </div>
                      <Text size="xsmall" className="mt-1 text-ui-fg-muted">
                        Withdrawable · NEFT/IMPS-funded
                      </Text>
                    </div>
                    {/* Promo balance */}
                    <div>
                      <Text size="small" className="mb-1 text-ui-fg-subtle">
                        Promo balance
                      </Text>
                      <div className="flex items-baseline gap-3">
                        <Heading level="h1" className="text-ui-fg-base">
                          {formatINR(
                            Number(walletSummary.promo_balance_inr ?? 0),
                          )}
                        </Heading>
                      </div>
                      <Text size="xsmall" className="mt-1 text-ui-fg-muted">
                        Non-withdrawable · referrals + points conversion
                      </Text>
                    </div>
                  </div>
                  {walletSummary.virtual_account && (
                    <Text size="xsmall" className="mt-3 text-ui-fg-muted">
                      VBA: {walletSummary.virtual_account.virtual_account_number}{" "}
                      · {walletSummary.virtual_account.ifsc}
                    </Text>
                  )}
                </div>
                <Button
                  variant="secondary"
                  size="small"
                  onClick={() => setAdjustOpen((v) => !v)}
                >
                  {adjustOpen ? (
                    <ChevronDown className="h-4 w-4" />
                  ) : (
                    <ChevronRight className="h-4 w-4" />
                  )}
                  Manual adjust
                </Button>
              </div>

              {adjustOpen && (
                <div className="mt-5 border-t border-ui-border-base pt-4">
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                    <Select
                      value={adjustBucket}
                      onValueChange={(v) =>
                        setAdjustBucket(v as "main" | "promo")
                      }
                    >
                      <Select.Trigger>
                        <Select.Value placeholder="Bucket" />
                      </Select.Trigger>
                      <Select.Content>
                        <Select.Item value="main">Main</Select.Item>
                        <Select.Item value="promo">Promo</Select.Item>
                      </Select.Content>
                    </Select>
                    <Select
                      value={adjustDirection}
                      onValueChange={(v) =>
                        setAdjustDirection(v as "credit" | "debit")
                      }
                    >
                      <Select.Trigger>
                        <Select.Value placeholder="Direction" />
                      </Select.Trigger>
                      <Select.Content>
                        <Select.Item value="credit">Credit</Select.Item>
                        <Select.Item value="debit">Debit</Select.Item>
                      </Select.Content>
                    </Select>
                    <Input
                      type="number"
                      value={adjustAmount}
                      onChange={(e) => setAdjustAmount(e.target.value)}
                      placeholder="Amount (INR)"
                    />
                    <Select
                      value={adjustReasonCode}
                      onValueChange={(v) =>
                        setAdjustReasonCode(
                          v as
                            | "promo"
                            | "goodwill"
                            | "reconciliation"
                            | "correction"
                            | "other",
                        )
                      }
                    >
                      <Select.Trigger>
                        <Select.Value placeholder="Reason code" />
                      </Select.Trigger>
                      <Select.Content>
                        <Select.Item value="promo">Promo</Select.Item>
                        <Select.Item value="goodwill">Goodwill</Select.Item>
                        <Select.Item value="reconciliation">
                          Reconciliation
                        </Select.Item>
                        <Select.Item value="correction">Correction</Select.Item>
                        <Select.Item value="other">Other</Select.Item>
                      </Select.Content>
                    </Select>
                  </div>
                  <div className="mt-3">
                    <Label>Note (min. 20 characters — required)</Label>
                    <Textarea
                      value={adjustReason}
                      onChange={(e) => setAdjustReason(e.target.value)}
                      rows={2}
                      placeholder="Why are you adjusting this wallet? (minimum 20 chars)"
                    />
                    <Text size="xsmall" className="mt-1 text-ui-fg-muted">
                      {adjustReason.trim().length}/20 chars
                    </Text>
                  </div>
                  <div className="mt-3 flex items-center justify-end gap-2">
                    <Text size="xsmall" className="text-ui-fg-muted">
                      Promo bucket: spendable at checkout (capped); not
                      withdrawable.
                    </Text>
                    <Button
                      onClick={adjustWallet}
                      disabled={
                        loading ||
                        !adjustAmount ||
                        adjustReason.trim().length < 20 ||
                        !customerId
                      }
                    >
                      Apply
                    </Button>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Manual KYC + verify pane — always shown after wallet loads */}
          {walletCustomer && (
            <ManualVerifyPane
              customer={walletCustomer}
              kyc={walletKyc}
              banks={walletBanks}
              demats={walletDemats}
              manualReason={manualReason}
              setManualReason={setManualReason}
              busy={loading}
              onPanAadhaar={manualPanAadhaar}
              onBank={manualVerifyBank}
              onDemat={manualVerifyDemat}
            />
          )}

          {walletTxs.length > 0 && (
            <Table>
              <Table.Header>
                <Table.Row>
                  <Table.HeaderCell>When</Table.HeaderCell>
                  <Table.HeaderCell>Kind</Table.HeaderCell>
                  <Table.HeaderCell>Dir</Table.HeaderCell>
                  <Table.HeaderCell>Amount</Table.HeaderCell>
                  <Table.HeaderCell>Balance after</Table.HeaderCell>
                  <Table.HeaderCell>Note</Table.HeaderCell>
                </Table.Row>
              </Table.Header>
              <Table.Body>
                {walletTxs.map((t) => (
                  <Table.Row key={t.id}>
                    <Table.Cell>{new Date(t.created_at).toLocaleString()}</Table.Cell>
                    <Table.Cell>{t.kind}</Table.Cell>
                    <Table.Cell>{t.direction}</Table.Cell>
                    <Table.Cell>{formatINR(t.amount_inr)}</Table.Cell>
                    <Table.Cell>{formatINR(t.balance_after)}</Table.Cell>
                    <Table.Cell>{t.note ?? ""}</Table.Cell>
                  </Table.Row>
                ))}
              </Table.Body>
            </Table>
          )}
        </div>
      )}

    </Container>
  )
}

// ─────────────────────────────────────────────────────────────────
// Cashfree Settings form — extracted into its own component so we can
// keep Medusa's design tokens (text-ui-fg-*, bg-ui-bg-*) consistent and
// avoid raw Tailwind colours that don't survive the admin's dark theme.
// ─────────────────────────────────────────────────────────────────

type SettingsFormProps = {
  mode: "pg" | "secureid"
  settings: CashfreeSettingsView | null
  draftEnv: "sandbox" | "production"
  setDraftEnv: (v: "sandbox" | "production") => void
  draftClientId: string
  setDraftClientId: (v: string) => void
  draftClientSecret: string
  setDraftClientSecret: (v: string) => void
  draftPayoutsClientId: string
  setDraftPayoutsClientId: (v: string) => void
  draftPayoutsClientSecret: string
  setDraftPayoutsClientSecret: (v: string) => void
  draftWebhookSecret: string
  setDraftWebhookSecret: (v: string) => void
  draftVerifyWebhookSecret: string
  setDraftVerifyWebhookSecret: (v: string) => void
  draftBeneficiaryName: string
  setDraftBeneficiaryName: (v: string) => void
  loading: boolean
  pinging: boolean
  savedFlash: boolean
  pingResult: CashfreePingResult
  onSave: () => void
  onPing: () => void
}

const HintText = ({
  children,
  tone = "muted",
}: {
  children: React.ReactNode
  tone?: "muted" | "warn" | "danger" | "ok"
}) => {
  const cls =
    tone === "warn"
      ? "txt-compact-xsmall text-ui-tag-orange-text"
      : tone === "danger"
        ? "txt-compact-xsmall text-ui-tag-red-text"
        : tone === "ok"
          ? "txt-compact-xsmall text-ui-tag-green-text"
          : "txt-compact-xsmall text-ui-fg-subtle"
  return <span className={cls}>{children}</span>
}

/** A single labelled field. Uses a stack of label + hint + input so all
 *  three are guaranteed to inherit the dashboard's foreground colour. */
const Field = ({
  label,
  hint,
  children,
}: {
  label: string
  hint?: React.ReactNode
  children: React.ReactNode
}) => (
  <div className="flex flex-col gap-y-1">
    <div className="flex items-center justify-between gap-2">
      <Label size="small" weight="plus">
        {label}
      </Label>
      {hint}
    </div>
    {children}
  </div>
)

const Section = ({
  title,
  description,
  children,
}: {
  title: string
  description?: string
  children: React.ReactNode
}) => (
  <div className="border-ui-border-base flex flex-col gap-y-3 border-t pt-4">
    <div>
      <Heading level="h3" className="text-ui-fg-base">
        {title}
      </Heading>
      {description && (
        <Text size="small" className="text-ui-fg-subtle">
          {description}
        </Text>
      )}
    </div>
    {children}
  </div>
)

const CashfreeSettingsForm = ({
  mode,
  settings,
  draftEnv,
  setDraftEnv,
  draftClientId,
  setDraftClientId,
  draftClientSecret,
  setDraftClientSecret,
  draftPayoutsClientId,
  setDraftPayoutsClientId,
  draftPayoutsClientSecret,
  setDraftPayoutsClientSecret,
  draftWebhookSecret,
  setDraftWebhookSecret,
  draftVerifyWebhookSecret,
  setDraftVerifyWebhookSecret,
  draftBeneficiaryName,
  setDraftBeneficiaryName,
  loading,
  pinging,
  savedFlash,
  pingResult,
  onSave,
  onPing,
}: SettingsFormProps) => {
  return (
    <div className="bg-ui-bg-base border-ui-border-base flex flex-col gap-y-5 rounded-lg border p-6">
      <div>
        <Heading level="h2" className="text-ui-fg-base">
          {mode === "pg"
            ? "Cashfree Payment Gateway"
            : "Cashfree Secure ID"}
        </Heading>
        <Text size="small" className="text-ui-fg-subtle">
          {mode === "pg"
            ? "Payment Gateway credentials. Covers wallet deposits via Virtual Bank Accounts (Auto-Collect — receiving UPI / NEFT / IMPS / RTGS) and any payouts. Cashfree dashboard → Developers → API Keys. Environment is shared with Secure ID."
            : "Verification Suite credentials, used for PAN / Aadhaar / bank-account verification. Cashfree dashboard → Verification Suite → Developers → API Keys. Environment is shared with Payment Gateway."}{" "}
          Secrets are encrypted at rest and stored per environment, so
          switching sandbox ↔ production preserves both sets. Empty secret
          fields are left unchanged on save. Env-var fallback is used only
          when a field is blank in the DB.
        </Text>
      </div>

      {/* General */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <Field
          label="Environment"
          hint={
            settings && draftEnv !== settings.env ? (
              <HintText tone="warn">
                switching from {settings.env} — secrets for both envs are kept
              </HintText>
            ) : (
              <HintText>shared across PG + Secure ID</HintText>
            )
          }
        >
          <Select
            value={draftEnv}
            onValueChange={(v) =>
              setDraftEnv(v as "sandbox" | "production")
            }
          >
            <Select.Trigger>
              <Select.Value />
            </Select.Trigger>
            <Select.Content>
              <Select.Item value="sandbox">Sandbox</Select.Item>
              <Select.Item value="production">Production</Select.Item>
            </Select.Content>
          </Select>
        </Field>
        {mode === "pg" && (
          <Field
            label="Default beneficiary name"
            hint={
              <HintText>
                fallback for shared VBAs only — per-customer VBAs always show the customer&apos;s PAN name
              </HintText>
            }
          >
            <Input
              value={draftBeneficiaryName}
              onChange={(e) => setDraftBeneficiaryName(e.target.value)}
              placeholder="POLEMARCH"
            />
          </Field>
        )}
      </div>

      {/* Verification — Secure ID only */}
      {mode === "secureid" && (
      <Section
        title="Verification / Secure ID"
        description="Cashfree dashboard → Verification Suite → Developers → API Keys"
      >
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <Field
            label="Client ID"
            hint={
              settings?.env_fallback_active.client_id ? (
                <HintText tone="warn">env fallback</HintText>
              ) : null
            }
          >
            <Input
              value={draftClientId}
              onChange={(e) => setDraftClientId(e.target.value)}
              placeholder="cashfree client id"
            />
          </Field>
          <Field
            label="Client Secret"
            hint={
              settings?.client_secret_set ? (
                <HintText>
                  current {settings.client_secret_masked}
                </HintText>
              ) : settings?.env_fallback_active.client_secret ? (
                <HintText tone="warn">env fallback</HintText>
              ) : (
                <HintText tone="danger">not set</HintText>
              )
            }
          >
            <Input
              type="password"
              value={draftClientSecret}
              onChange={(e) => setDraftClientSecret(e.target.value)}
              placeholder={
                settings?.client_secret_set
                  ? "leave blank to keep"
                  : "paste secret"
              }
            />
          </Field>
        </div>
      </Section>
      )}

      {/* Payment Gateway credentials — covers Auto-Collect / VBA + Payouts */}
      {mode === "pg" && (
      <Section
        title="Payment Gateway"
        description="Cashfree dashboard → Developers → API Keys. Same app key pair is used for Auto-Collect (VBA receiving) and outbound payouts."
      >
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <Field
            label="PG Client ID"
            hint={
              settings?.env_fallback_active.payouts_client_id ? (
                <HintText tone="warn">env fallback</HintText>
              ) : null
            }
          >
            <Input
              value={draftPayoutsClientId}
              onChange={(e) => setDraftPayoutsClientId(e.target.value)}
              placeholder="PG app client id"
            />
          </Field>
          <Field
            label="PG Client Secret"
            hint={
              settings?.payouts_client_secret_set ? (
                <HintText>
                  current {settings.payouts_client_secret_masked}
                </HintText>
              ) : settings?.env_fallback_active.payouts_client_secret ? (
                <HintText tone="warn">env fallback</HintText>
              ) : (
                <HintText tone="danger">not set</HintText>
              )
            }
          >
            <Input
              type="password"
              value={draftPayoutsClientSecret}
              onChange={(e) =>
                setDraftPayoutsClientSecret(e.target.value)
              }
              placeholder={
                settings?.payouts_client_secret_set
                  ? "leave blank to keep"
                  : "paste secret"
              }
            />
          </Field>
        </div>
      </Section>
      )}

      {/* Webhooks — only show the secret relevant to this product */}
      <Section
        title="Webhook Signing Secret"
        description="Cashfree dashboard → Developers → Webhooks → Signing secret. Used to verify incoming webhook signatures."
      >
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          {mode === "pg" && (
          <Field
            label="Payment Gateway Webhook Secret"
            hint={
              settings?.webhook_secret_set ? (
                <HintText>
                  current {settings.webhook_secret_masked}
                </HintText>
              ) : settings?.env_fallback_active.webhook_secret ? (
                <HintText tone="warn">env fallback</HintText>
              ) : (
                <HintText tone="danger">not set</HintText>
              )
            }
          >
            <Input
              type="password"
              value={draftWebhookSecret}
              onChange={(e) => setDraftWebhookSecret(e.target.value)}
              placeholder={
                settings?.webhook_secret_set
                  ? "leave blank to keep"
                  : "paste secret"
              }
            />
          </Field>
          )}
          {mode === "secureid" && (
          <Field
            label="Verification Webhook Secret"
            hint={
              settings?.verify_webhook_secret_set ? (
                <HintText>
                  current {settings.verify_webhook_secret_masked}
                </HintText>
              ) : settings?.env_fallback_active.verify_webhook_secret ? (
                <HintText tone="warn">env fallback</HintText>
              ) : (
                <HintText>falls back to VBA secret</HintText>
              )
            }
          >
            <Input
              type="password"
              value={draftVerifyWebhookSecret}
              onChange={(e) =>
                setDraftVerifyWebhookSecret(e.target.value)
              }
              placeholder={
                settings?.verify_webhook_secret_set
                  ? "leave blank to keep"
                  : "paste secret (or leave blank)"
              }
            />
          </Field>
          )}
        </div>
      </Section>

      {/* Actions */}
      <div className="border-ui-border-base flex flex-wrap items-center gap-3 border-t pt-4">
        <Button onClick={onSave} disabled={loading} isLoading={loading}>
          Save settings
        </Button>
        <Button
          variant="secondary"
          onClick={onPing}
          disabled={pinging}
          isLoading={pinging}
        >
          Test connection
        </Button>
        {savedFlash && (
          <StatusBadge color="green">Saved</StatusBadge>
        )}
        {settings?.updated_at && (
          <Text size="xsmall" className="text-ui-fg-subtle">
            last saved {new Date(settings.updated_at).toLocaleString()}
          </Text>
        )}
      </div>

      {/* Ping result */}
      {pingResult && (
        <div className="border-ui-border-base flex flex-col gap-y-2 rounded-md border p-4">
          <div className="flex items-center justify-between">
            <Text className="text-ui-fg-base" weight="plus">
              {pingResult.ping.ok
                ? "✓ Cashfree credentials work"
                : "✗ Cashfree call failed"}
            </Text>
            <StatusBadge color={pingResult.ping.ok ? "green" : "red"}>
              env: {pingResult.env}
            </StatusBadge>
          </div>
          <Text size="small" className="text-ui-fg-subtle">
            {pingResult.ping.message ?? pingResult.ping.reason ?? ""}
          </Text>
          <div className="flex flex-wrap gap-1">
            {Object.entries(pingResult.configured ?? {}).map(([k, v]) => (
              <StatusBadge key={k} color={v ? "green" : "red"}>
                {k}: {v ? "yes" : "no"}
              </StatusBadge>
            ))}
          </div>
        </div>
      )}

      {/* Webhook URL hint — product-specific */}
      <div className="border-ui-border-base bg-ui-bg-subtle flex flex-col gap-y-1 rounded-md border p-4">
        <Text size="small" weight="plus" className="text-ui-fg-base">
          Register this webhook URL in Cashfree
        </Text>
        {mode === "pg" ? (
          <Text size="small" className="text-ui-fg-subtle">
            Payment Gateway (Auto-Collect + Payouts):{" "}
            <code className="text-ui-fg-base">
              {`<your-host>/webhooks/cashfree/payment-gateway`}
            </code>
          </Text>
        ) : (
          <Text size="small" className="text-ui-fg-subtle">
            Verification:{" "}
            <code className="text-ui-fg-base">
              {`<your-host>/webhooks/cashfree/verification`}
            </code>
          </Text>
        )}
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────
// ManualVerifyPane — shows KYC state + all the customer's documents
// + manual approve/reject buttons for each item. Used when Cashfree
// Secure ID isn't available or a human override is needed.
// ─────────────────────────────────────────────────────────────────

const BACKEND_STATIC_URL = ""

const docLink = (u: string | null) => {
  if (!u) return null
  return u.startsWith("http") ? u : `${BACKEND_STATIC_URL}${u}`
}

const Checkmark = ({ ok }: { ok: boolean }) => (
  <StatusBadge color={ok ? "green" : "grey"}>
    {ok ? "Yes" : "No"}
  </StatusBadge>
)

const ManualVerifyPane = ({
  customer,
  kyc,
  banks,
  demats,
  manualReason,
  setManualReason,
  busy,
  onPanAadhaar,
  onBank,
  onDemat,
}: {
  customer: NonNullable<CustomerInfo>
  kyc: KycInfo
  banks: BankRow[]
  demats: DematRow[]
  manualReason: string
  setManualReason: (s: string) => void
  busy: boolean
  onPanAadhaar: (kind: "pan" | "aadhaar", decision: "approved" | "rejected") => void | Promise<void>
  onBank: (id: string, decision: "approved" | "rejected") => void | Promise<void>
  onDemat: (id: string, decision: "approved" | "rejected", makePrimary: boolean) => void | Promise<void>
}) => {
  return (
    <div className="bg-ui-bg-base border-ui-border-base flex flex-col gap-y-5 rounded-lg border p-5">
      <div>
        <Heading level="h3">Manual verification</Heading>
        <Text size="small" className="text-ui-fg-subtle">
          Use this panel when Cashfree Secure ID isn&apos;t available or a
          human decision is needed. Every action requires a reason and is
          audit-logged in <code>secure_id_verification</code>.
        </Text>
      </div>

      {/* Customer snapshot */}
      <div className="border-ui-border-base rounded-md border p-3">
        <div className="text-xs text-ui-fg-subtle">Customer</div>
        <div className="mt-1 font-semibold">
          {customer.first_name || ""} {customer.last_name || ""} ·{" "}
          {customer.email}
        </div>
        {customer.phone && (
          <div className="text-xs text-ui-fg-subtle">{customer.phone}</div>
        )}
        <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
          <span>KYC:</span>
          <StatusBadge
            color={
              kyc?.overall === "approved"
                ? "green"
                : kyc?.overall === "in_progress"
                  ? "orange"
                  : kyc?.overall === "rejected"
                    ? "red"
                    : "grey"
            }
          >
            {kyc?.overall ?? "unknown"}
          </StatusBadge>
          <span>PAN:</span>
          <Checkmark ok={!!kyc?.pan_verified} />
          <span>Aadhaar:</span>
          <Checkmark ok={!!kyc?.aadhaar_verified} />
          <span>Bank:</span>
          <Checkmark ok={!!kyc?.has_verified_bank} />
          <span>Primary demat:</span>
          <Checkmark ok={!!kyc?.has_primary_demat} />
        </div>
      </div>

      {/* Reason input — required for every action */}
      <div>
        <Label>Reason (required for every action)</Label>
        <Textarea
          value={manualReason}
          onChange={(e) => setManualReason(e.target.value)}
          rows={2}
          placeholder="e.g. Verified PAN against uploaded doc by ops team."
        />
      </div>

      {/* PAN */}
      <div className="border-ui-border-base rounded-md border p-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Text weight="plus">PAN</Text>
            <Checkmark ok={!!kyc?.pan_verified} />
          </div>
          <div className="flex items-center gap-2">
            {customer.pan_card_file_url ? (
              <a
                className="text-ui-fg-interactive underline text-sm"
                href={docLink(customer.pan_card_file_url) ?? "#"}
                target="_blank"
                rel="noopener noreferrer"
              >
                View PAN card
              </a>
            ) : (
              <Text size="small" className="text-ui-fg-subtle">
                No PAN card uploaded
              </Text>
            )}
            <Button
              size="small"
              variant="secondary"
              onClick={() => onPanAadhaar("pan", "approved")}
              disabled={busy}
            >
              Approve
            </Button>
            <Button
              size="small"
              variant="secondary"
              onClick={() => onPanAadhaar("pan", "rejected")}
              disabled={busy}
            >
              Reject
            </Button>
          </div>
        </div>
      </div>

      {/* Aadhaar */}
      <div className="border-ui-border-base rounded-md border p-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Text weight="plus">Aadhaar</Text>
            <Checkmark ok={!!kyc?.aadhaar_verified} />
          </div>
          <div className="flex items-center gap-2">
            {customer.aadhaar_card_file_url ? (
              <a
                className="text-ui-fg-interactive underline text-sm"
                href={docLink(customer.aadhaar_card_file_url) ?? "#"}
                target="_blank"
                rel="noopener noreferrer"
              >
                View Aadhaar
              </a>
            ) : (
              <Text size="small" className="text-ui-fg-subtle">
                No Aadhaar uploaded
              </Text>
            )}
            <Button
              size="small"
              variant="secondary"
              onClick={() => onPanAadhaar("aadhaar", "approved")}
              disabled={busy}
            >
              Approve
            </Button>
            <Button
              size="small"
              variant="secondary"
              onClick={() => onPanAadhaar("aadhaar", "rejected")}
              disabled={busy}
            >
              Reject
            </Button>
          </div>
        </div>
      </div>

      {/* Banks */}
      <div>
        <Heading level="h3">Banks</Heading>
        {banks.length === 0 ? (
          <Text size="small" className="text-ui-fg-subtle">
            No bank accounts.
          </Text>
        ) : (
          <div className="mt-2 space-y-2">
            {banks.map((b) => (
              <div
                key={b.id}
                className="border-ui-border-base rounded-md border p-3"
              >
                <div className="flex items-center justify-between gap-2">
                  <div>
                    <Text weight="plus">
                      {b.bank_name || "Bank"} · XXXX{b.account_number_last4}
                    </Text>
                    <Text size="small" className="text-ui-fg-subtle">
                      {b.ifsc} · {b.account_holder_name}
                    </Text>
                    <div className="mt-1 flex flex-wrap items-center gap-2 text-xs">
                      <StatusBadge
                        color={
                          b.verification_status === "verified"
                            ? "green"
                            : b.verification_status === "pending"
                              ? "orange"
                              : "red"
                        }
                      >
                        {b.verification_status}
                      </StatusBadge>
                      {b.is_primary && (
                        <StatusBadge color="blue">Primary</StatusBadge>
                      )}
                      {b.bank_proof_file_url ? (
                        <a
                          className="text-ui-fg-interactive underline"
                          href={docLink(b.bank_proof_file_url) ?? "#"}
                          target="_blank"
                          rel="noopener noreferrer"
                        >
                          View {b.bank_proof_type ?? "proof"}
                        </a>
                      ) : (
                        <span className="text-ui-fg-subtle">
                          No proof uploaded
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Button
                      size="small"
                      variant="secondary"
                      onClick={() => onBank(b.id, "approved")}
                      disabled={busy}
                    >
                      Approve
                    </Button>
                    <Button
                      size="small"
                      variant="secondary"
                      onClick={() => onBank(b.id, "rejected")}
                      disabled={busy}
                    >
                      Reject
                    </Button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Demats */}
      <div>
        <Heading level="h3">Demats</Heading>
        {demats.length === 0 ? (
          <Text size="small" className="text-ui-fg-subtle">
            No demat accounts.
          </Text>
        ) : (
          <div className="mt-2 space-y-2">
            {demats.map((d) => (
              <div
                key={d.id}
                className="border-ui-border-base rounded-md border p-3"
              >
                <div className="flex items-center justify-between gap-2">
                  <div>
                    <Text weight="plus">
                      {d.dp_name} · {d.depository}
                    </Text>
                    <Text size="small" className="text-ui-fg-subtle">
                      {d.account_holder_name}
                    </Text>
                    <div className="mt-1 flex flex-wrap items-center gap-2 text-xs">
                      <StatusBadge
                        color={
                          d.verification_status === "verified"
                            ? "green"
                            : d.verification_status === "pending"
                              ? "orange"
                              : "red"
                        }
                      >
                        {d.verification_status}
                      </StatusBadge>
                      {d.is_primary && (
                        <StatusBadge color="blue">Primary</StatusBadge>
                      )}
                      {d.cmr_file_url ? (
                        <a
                          className="text-ui-fg-interactive underline"
                          href={docLink(d.cmr_file_url) ?? "#"}
                          target="_blank"
                          rel="noopener noreferrer"
                        >
                          View CMR
                        </a>
                      ) : (
                        <span className="text-ui-fg-subtle">No CMR</span>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Button
                      size="small"
                      variant="secondary"
                      onClick={() => onDemat(d.id, "approved", !d.is_primary)}
                      disabled={busy}
                      title="Approve (and make primary if none set)"
                    >
                      Approve
                    </Button>
                    <Button
                      size="small"
                      variant="secondary"
                      onClick={() => onDemat(d.id, "rejected", false)}
                      disabled={busy}
                    >
                      Reject
                    </Button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

export const config = defineRouteConfig({
  label: "Wallet",
  icon: Cash,
})

export default WalletAdminPage
