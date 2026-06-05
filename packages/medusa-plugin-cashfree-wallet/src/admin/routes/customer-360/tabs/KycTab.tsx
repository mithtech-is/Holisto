import React, { useEffect, useState } from "react"
import {
  Button,
  Container,
  Heading,
  Input,
  Label,
  StatusBadge,
  Text,
  Textarea,
} from "@medusajs/ui"
import { adminFetch, formatDate, statusBadgeColor } from "../helpers"

type Props = { customerId: string }

type KycState = {
  metadata: Record<string, any>
  kyc: any | null
  manual_requests: any[]
}

/**
 * Sub-tab navigation inside the KYC section. PAN comes first
 * because it's the gating step — every later check (Aadhaar
 * cross-match, bank holder name) depends on the PAN holder name
 * being on file. Each tab carries both the automated flow
 * (Cashfree call buttons) and the manual override / approve-reject
 * paths so an admin can resolve a stuck customer in one place.
 */
type KycSubTab =
  | "pan"
  | "aadhaar"
  | "bank"
  | "demat"
  | "manual"
  | "audit"
const KYC_SUBTABS: ReadonlyArray<{ key: KycSubTab; label: string }> = [
  { key: "pan", label: "PAN" },
  { key: "aadhaar", label: "Aadhaar" },
  // Bank + Demat live on the dedicated "Bank & Demat" top-level tab too,
  // but the manual-override action is mirrored here so an admin handling
  // a name_mismatch case doesn't have to switch tabs to flip the bank
  // row from `name_mismatch` → `verified`. Same `/admin/bank-accounts/:id/verify`
  // and `/admin/demat-accounts/:id/verify` endpoints.
  { key: "bank", label: "Bank" },
  { key: "demat", label: "Demat" },
  { key: "manual", label: "Manual edit" },
  { key: "audit", label: "Audit log" },
]

type BankAccountRow = {
  id: string
  customer_id: string
  account_holder_name: string
  account_number_last4: string
  ifsc: string
  bank_name: string | null
  verification_status: string
  is_primary: boolean
  created_at: string
}

type DematAccountRow = {
  id: string
  customer_id: string
  depository: string
  dp_name: string
  dp_id: string | null
  client_id: string | null
  boid: string | null
  account_holder_name: string
  cmr_file_url: string | null
  verification_status: string
  is_primary: boolean
  created_at: string
}

/** Shape of /admin/customers/:id/pan-record. Mirrors the
 *  `pan_record` model exactly. Every field below the always-present
 *  identity cluster is optional — populated only when Cashfree
 *  (PAN 360 / Advance) returns it. */
type PanRecord = {
  id: string
  pan_hash: string
  pan_masked: string
  registered_name: string
  name_pan_card?: string | null
  first_name?: string | null
  last_name?: string | null
  pan_type?: string | null
  father_name?: string | null
  pan_status?: string | null
  last_updated_at_itd?: string | null
  aadhaar_linked?: boolean | null
  aadhaar_seeding_status?: string | null
  aadhaar_seeding_status_desc?: string | null
  masked_aadhaar?: string | null
  gender?: string | null
  date_of_birth?: string | null
  email_masked?: string | null
  phone_masked?: string | null
  address?: {
    full_address?: string
    street?: string
    city?: string
    state?: string
    pincode?: number | string
    country?: string
  } | null
  name_match_score_initial?: number | null
  name_match_result_initial?: string | null
  cashfree_reference_id?: string | null
  cashfree_verification_id?: string | null
  first_verified_at?: string
  last_refreshed_at?: string
}

/** Shape of /admin/customers/:id/aadhaar-record. Mirrors the
 *  `aadhaar_record` model. Same-as-PAN sparse-fill: only fields
 *  Cashfree returned are populated. */
type AadhaarRecord = {
  id: string
  aadhaar_hash: string
  aadhaar_masked: string
  aadhaar_full?: string | null
  name: string
  date_of_birth?: string | null
  gender?: string | null
  father_name?: string | null
  address?: Record<string, unknown> | null
  has_photo?: boolean | null
  photo_url?: string | null
  cashfree_ref_id?: string | null
  first_verified_at?: string
  last_refreshed_at?: string
}

/** Minimal shape of a `secure_id_verification` row as returned by
 *  `/admin/secure-id-verifications`. Used to show the last attempt per
 *  kind next to the badge in the KYC status panel. */
type VerificationSummary = {
  id: string
  customer_id: string
  kind: string
  status: "pending" | "success" | "failed"
  reference_id: string | null
  input_masked: string | null
  created_at: string
}

/** Response shape of POST /admin/customers/:id/kyc/live-verify. */
type LiveVerifyResponse = {
  ok: boolean
  kind: string
  verification_id?: string
  message?: string
  ref_id?: string
  expires_at?: string
  result?: Record<string, unknown>
}

const EDITABLE_FIELDS: Array<{
  key: string
  label: string
  placeholder?: string
}> = [
  { key: "kyc_full_name", label: "Full name (as per PAN)" },
  { key: "kyc_pan_number", label: "PAN number", placeholder: "ABCDE1234F" },
  { key: "kyc_aadhaar_number", label: "Aadhaar number (last 4)" },
  { key: "kyc_dp_name", label: "DP name (broker)" },
  { key: "kyc_demat_number", label: "Demat number / BOID" },
  { key: "kyc_pan_file_url", label: "PAN file URL" },
  { key: "kyc_cmr_file_url", label: "CMR file URL" },
]

export default function KycTab({ customerId }: Props) {
  const [state, setState] = useState<KycState | null>(null)
  const [form, setForm] = useState<Record<string, string>>({})
  const [reason, setReason] = useState("")
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)

  // Latest Secure ID attempt per kind — shown inline under each badge.
  const [latestByKind, setLatestByKind] = useState<
    Record<string, VerificationSummary | null>
  >({})
  // Aadhaar OTP flow is two-step; hold the ref_id between send + verify.
  const [aadhaarRefId, setAadhaarRefId] = useState<string | null>(null)
  const [aadhaarOtp, setAadhaarOtp] = useState("")
  const [liveBusy, setLiveBusy] = useState<string | null>(null)

  // Sub-tab nav. PAN is the default — first thing ops eyeball when
  // landing on a customer.
  const [subTab, setSubTab] = useState<KycSubTab>("pan")

  // Global PAN record — sourced from /admin/customers/:id/pan-record
  // which reads the `pan_record` table by customer.metadata.pan_hash.
  // 404 (no PAN ever verified) → null.
  const [panRecord, setPanRecord] = useState<PanRecord | null>(null)
  const [panRecordLoading, setPanRecordLoading] = useState(false)
  const loadPanRecord = async () => {
    setPanRecordLoading(true)
    try {
      const r = await adminFetch<{ verified: boolean; pan_record?: PanRecord }>(
        `/admin/customers/${customerId}/pan-record`,
      )
      setPanRecord(r.verified && r.pan_record ? r.pan_record : null)
    } catch {
      // 404 means "no PAN on file" — render the empty state, not an
      // error toast.
      setPanRecord(null)
    } finally {
      setPanRecordLoading(false)
    }
  }

  // Bank + Demat lists — fetched separately from the KYC payload so the
  // sub-tabs can render the manual-verify action against each row.
  // Mirrors the same /admin/{bank,demat}-accounts?customer_id call the
  // Bank & Demat top-level tab uses; intentionally redundant so the KYC
  // tab can act on a stuck name_mismatch without round-tripping.
  const [banks, setBanks] = useState<BankAccountRow[]>([])
  const [demats, setDemats] = useState<DematAccountRow[]>([])
  const [accountsLoading, setAccountsLoading] = useState(false)
  const [verifyBusy, setVerifyBusy] = useState<string | null>(null)

  const loadAccounts = async () => {
    setAccountsLoading(true)
    try {
      const [b, d] = await Promise.all([
        adminFetch<{ bank_accounts: BankAccountRow[] }>(
          `/admin/bank-accounts?customer_id=${customerId}`,
        ).catch(() => ({ bank_accounts: [] as BankAccountRow[] })),
        adminFetch<{ demat_accounts: DematAccountRow[] }>(
          `/admin/demat-accounts?customer_id=${customerId}`,
        ).catch(() => ({ demat_accounts: [] as DematAccountRow[] })),
      ])
      setBanks(b.bank_accounts ?? [])
      setDemats(d.demat_accounts ?? [])
    } finally {
      setAccountsLoading(false)
    }
  }

  /** Manual override for a bank row. Same endpoint as the Bank & Demat
   *  tab uses — kept here so an admin resolving a name_mismatch never
   *  has to leave the KYC tab. After success, refresh KYC + accounts so
   *  the status pills + bank table flip in lock-step. */
  const verifyBankFromKyc = async (
    id: string,
    decision: "approved" | "rejected",
  ) => {
    const r = prompt(`Reason for ${decision} (audit-logged, min 4 chars)?`)
    if (!r || r.trim().length < 4) return
    setVerifyBusy(id)
    setError(null)
    setSuccess(null)
    try {
      await adminFetch(`/admin/bank-accounts/${id}/verify`, {
        method: "POST",
        body: JSON.stringify({ decision, reason: r }),
      })
      setSuccess(`Bank ${decision}`)
      await Promise.all([load(), loadAccounts()])
      // Cross-tab notify so AccountsTab refreshes if open in the same view.
      if (typeof window !== "undefined") {
        window.dispatchEvent(
          new CustomEvent("polemarch:kyc-inputs-changed", {
            detail: { customerId },
          }),
        )
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Bank verify failed")
    } finally {
      setVerifyBusy(null)
    }
  }

  const verifyDematFromKyc = async (
    id: string,
    decision: "approved" | "rejected",
  ) => {
    const r = prompt(`Reason for ${decision} (audit-logged, min 4 chars)?`)
    if (!r || r.trim().length < 4) return
    setVerifyBusy(id)
    setError(null)
    setSuccess(null)
    try {
      await adminFetch(`/admin/demat-accounts/${id}/verify`, {
        method: "POST",
        body: JSON.stringify({ decision, reason: r }),
      })
      setSuccess(`Demat ${decision}`)
      await Promise.all([load(), loadAccounts()])
      if (typeof window !== "undefined") {
        window.dispatchEvent(
          new CustomEvent("polemarch:kyc-inputs-changed", {
            detail: { customerId },
          }),
        )
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Demat verify failed")
    } finally {
      setVerifyBusy(null)
    }
  }

  // Same shape as PAN — sourced from /admin/customers/:id/aadhaar-record
  // which reads `aadhaar_record` by customer.metadata.aadhaar_hash.
  const [aadhaarRecord, setAadhaarRecord] = useState<AadhaarRecord | null>(null)
  const [aadhaarRecordLoading, setAadhaarRecordLoading] = useState(false)
  const loadAadhaarRecord = async () => {
    setAadhaarRecordLoading(true)
    try {
      const r = await adminFetch<{
        verified: boolean
        aadhaar_record?: AadhaarRecord
      }>(`/admin/customers/${customerId}/aadhaar-record`)
      setAadhaarRecord(r.verified && r.aadhaar_record ? r.aadhaar_record : null)
    } catch {
      setAadhaarRecord(null)
    } finally {
      setAadhaarRecordLoading(false)
    }
  }

  const load = async () => {
    setLoading(true)
    try {
      const res = await adminFetch<KycState>(
        `/admin/customers/${customerId}/kyc`
      )
      setState(res)
      const init: Record<string, string> = {}
      for (const f of EDITABLE_FIELDS) {
        init[f.key] = (res.metadata?.[f.key] as string) ?? ""
      }
      setForm(init)
      // Pull the latest verification per kind in parallel. Cheap: each
      // call is a single DB row — LIMIT 1 with customer_id + kind index.
      await loadLatestVerifications()
      // Pull the global pan_record + aadhaar_record for this customer
      // (404 → empty state, surfaced in the respective sub-tab card).
      await loadPanRecord()
      await loadAadhaarRecord()
      // Bank + demat lists — drive the new Bank/Demat sub-tabs.
      await loadAccounts()
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed")
    } finally {
      setLoading(false)
    }
  }

  /** Shared fetch for the "last attempt" badges. Called on load + after
   *  any live-verify action to re-pull. Pulls all 5 kinds in parallel. */
  const loadLatestVerifications = async () => {
    const kinds = ["pan", "aadhaar_otp_send", "aadhaar_otp_verify", "bank_penny", "cmr"]
    const entries = await Promise.all(
      kinds.map(async (kind) => {
        try {
          const res = await adminFetch<{ verifications: VerificationSummary[] }>(
            `/admin/secure-id-verifications?customer_id=${encodeURIComponent(customerId)}&kind=${kind}&limit=1`
          )
          return [kind, res.verifications?.[0] ?? null] as const
        } catch {
          return [kind, null] as const
        }
      }),
    )
    setLatestByKind(Object.fromEntries(entries))
  }

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [customerId])

  // Cross-tab sync: AccountsTab dispatches this event whenever a bank
  // or demat row is verified / rejected / deleted / edited / added.
  // The `has_verified_bank` / `has_primary_demat` badges on this tab
  // are derived from those rows, so we reload on every such event.
  //
  // Guarded by the customerId match so a stray event from a different
  // Customer 360 window (the admin might have two open) doesn't
  // trigger spurious reloads.
  useEffect(() => {
    if (typeof window === "undefined") return
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail as
        | { customerId?: string }
        | undefined
      if (detail?.customerId && detail.customerId !== customerId) return
      load()
    }
    window.addEventListener(
      "polemarch:kyc-inputs-changed",
      handler as EventListener,
    )
    return () =>
      window.removeEventListener(
        "polemarch:kyc-inputs-changed",
        handler as EventListener,
      )
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [customerId])

  const save = async () => {
    if (reason.trim().length < 4) {
      setError("Reason must be at least 4 characters")
      return
    }
    setSaving(true)
    setError(null)
    setSuccess(null)
    try {
      const payload: Record<string, string> = { reason }
      for (const f of EDITABLE_FIELDS) {
        const v = (form[f.key] ?? "").trim()
        if (v) payload[f.key] = v
      }
      await adminFetch(`/admin/customers/${customerId}/kyc`, {
        method: "PATCH",
        body: JSON.stringify(payload),
      })
      setSuccess("Saved")
      setReason("")
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : "Save failed")
    } finally {
      setSaving(false)
    }
  }

  const decide = async (
    kind: "pan_approve" | "pan_reject" | "aadhaar_approve" | "aadhaar_reject"
  ) => {
    const r = prompt(`Reason for ${kind}?`)
    if (!r || r.trim().length < 4) return
    setSaving(true)
    setError(null)
    try {
      await adminFetch(`/admin/customers/${customerId}/kyc/manual`, {
        method: "POST",
        body: JSON.stringify({ [kind]: true, reason: r }),
      })
      setSuccess(`${kind} recorded`)
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : "Action failed")
    } finally {
      setSaving(false)
    }
  }

  /** Common wrapper for POSTing to /admin/customers/:id/kyc/live-verify.
   *  Handles the reason prompt, live button state, error surfacing, and
   *  the post-action reload. Returns the response body so the caller can
   *  chain (e.g. Aadhaar OTP: send → store ref_id → verify). */
  const runLiveVerify = async (
    bucket: string,
    body: Record<string, unknown>,
  ): Promise<LiveVerifyResponse | null> => {
    const r = prompt(
      `Reason for live ${bucket} verification? (min 4 chars, audit-logged)`,
    )
    if (!r || r.trim().length < 4) return null
    setLiveBusy(bucket)
    setError(null)
    setSuccess(null)
    try {
      const res = await adminFetch<LiveVerifyResponse>(
        `/admin/customers/${customerId}/kyc/live-verify`,
        {
          method: "POST",
          body: JSON.stringify({ ...body, reason: r }),
        },
      )
      if (res.ok) {
        setSuccess(`${bucket}: verified`)
      } else {
        setError(res.message || `${bucket}: verification failed`)
      }
      // Refresh everything the tab shows — the KYC derived status,
      // metadata, manual requests, and the per-kind history badges.
      await load()
      // Tell AccountsTab to refresh too (for bank_penny / cmr results).
      if (typeof window !== "undefined") {
        window.dispatchEvent(
          new CustomEvent("polemarch:kyc-inputs-changed", {
            detail: { customerId },
          }),
        )
      }
      return res
    } catch (e) {
      setError(e instanceof Error ? e.message : `${bucket}: action failed`)
      return null
    } finally {
      setLiveBusy(null)
    }
  }

  const runLivePan = async () => {
    const panRaw = (form.kyc_pan_number ?? "").trim()
    const nameRaw = (form.kyc_full_name ?? "").trim()
    if (!panRaw || !nameRaw) {
      setError("Fill in PAN number + Full name (Edit KYC fields) before running.")
      return
    }
    await runLiveVerify("pan", { kind: "pan", pan: panRaw, name: nameRaw })
  }

  const runSendAadhaarOtp = async () => {
    const aadhaarRaw = (form.kyc_aadhaar_number ?? "").trim()
    // The metadata field holds the masked/last-4 form; full 12-digit
    // Aadhaar comes via a prompt so ops doesn't need to store it long-
    // term. OTP goes to the customer's Aadhaar-linked phone.
    const aadhaar = prompt(
      "Enter the customer's 12-digit Aadhaar number to send an OTP. OTP will be delivered to the Aadhaar-linked phone — coordinate with the customer.",
      /^\d{12}$/.test(aadhaarRaw) ? aadhaarRaw : "",
    )
    if (!aadhaar) return
    if (!/^\d{12}$/.test(aadhaar.replace(/\s+/g, ""))) {
      setError("Aadhaar must be 12 digits.")
      return
    }
    const res = await runLiveVerify("aadhaar_otp_send", {
      kind: "aadhaar_otp_send",
      aadhaar: aadhaar.replace(/\s+/g, ""),
    })
    if (res?.ok && res.ref_id) {
      setAadhaarRefId(res.ref_id)
      setSuccess(
        `OTP sent. Ref: ${res.ref_id.slice(0, 8)}…  Paste the 6-digit OTP the customer received, then click Verify OTP.`,
      )
    }
  }

  const runVerifyAadhaarOtp = async () => {
    if (!aadhaarRefId) {
      setError("No active OTP session — click Send OTP first.")
      return
    }
    const otp = aadhaarOtp.trim()
    if (!/^\d{4,8}$/.test(otp)) {
      setError("Enter the 4–8 digit OTP the customer received.")
      return
    }
    const res = await runLiveVerify("aadhaar_otp_verify", {
      kind: "aadhaar_otp_verify",
      ref_id: aadhaarRefId,
      otp,
    })
    if (res?.ok) {
      setAadhaarRefId(null)
      setAadhaarOtp("")
    }
  }

  if (loading) return <Text>Loading…</Text>
  if (!state) return <Text className="text-ui-fg-error">{error}</Text>

  const kyc = state.kyc

  // Field names come from `CashfreeWalletService.getKycStatus` in
  // backend/src/modules/cashfree_wallet/service.ts. The canonical names
  // are `has_verified_bank` and `has_primary_demat` — not `bank_verified`
  // / `demat_verified` which was a typo that left these two badges
  // always showing "pending" regardless of the underlying state. The
  // storefront's `DerivedKycStatus` + the wallets admin page both use
  // the `has_*` names so we stay aligned here.
  return (
    <div className="flex flex-col gap-4">
      {/* Global status row — visible regardless of which sub-tab is
          active. Same 4 verification badges + summary as before. */}
      <Container className="p-6">
        <div className="flex items-center justify-between mb-4">
          <Heading level="h3">KYC status</Heading>
          <div className="flex items-center gap-2">
            <Button size="small" variant="transparent" onClick={load} disabled={loading}>
              Refresh
            </Button>
            <StatusBadge color={statusBadgeColor(kyc?.overall ?? "pending")}>
              {kyc?.overall ?? "not started"}
            </StatusBadge>
          </div>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
          <Field
            label="PAN"
            value={kyc?.pan_verified ? "verified" : "pending"}
            color={kyc?.pan_verified ? "green" : "orange"}
            latest={latestByKind["pan"]}
          />
          <Field
            label="Aadhaar"
            value={kyc?.aadhaar_verified ? "verified" : "pending"}
            color={kyc?.aadhaar_verified ? "green" : "orange"}
            latest={
              latestByKind["aadhaar_otp_verify"] ??
              latestByKind["aadhaar_otp_send"]
            }
          />
          <Field
            label="Bank"
            value={kyc?.has_verified_bank ? "verified" : "pending"}
            color={kyc?.has_verified_bank ? "green" : "orange"}
            latest={latestByKind["bank_penny"]}
          />
          <Field
            label="Demat"
            value={kyc?.has_primary_demat ? "verified" : "pending"}
            color={kyc?.has_primary_demat ? "green" : "orange"}
            latest={latestByKind["cmr"]}
          />
        </div>
      </Container>

      {/* Sub-tab strip. PAN first per the verification order +
          dependency chain. Bank + Demat have their own top-level
          tabs in Customer 360, so the KYC section here focuses on
          PAN / Aadhaar + the cross-cutting manual + audit views. */}
      <Container className="p-6">
        <div className="mb-4 flex flex-wrap gap-2">
          {KYC_SUBTABS.map((t) => (
            <Button
              key={t.key}
              size="small"
              variant={subTab === t.key ? "primary" : "secondary"}
              onClick={() => setSubTab(t.key)}
            >
              {t.label}
            </Button>
          ))}
        </div>

        {/* ── Tab 1 — PAN ─────────────────────────────────────────── */}
        {subTab === "pan" && (
          <div className="flex flex-col gap-4">
            <PanRecordCard
              record={panRecord}
              loading={panRecordLoading}
              onRefresh={loadPanRecord}
              latest={latestByKind["pan"]}
            />

            {/* Live Cashfree call — hits PAN 360 with the stored
                values in the Manual Edit tab below. */}
            <div className="border-t border-ui-border-base pt-4">
              <Text size="small" className="text-ui-fg-muted font-medium uppercase tracking-widest mb-2">
                Live verification (Cashfree PAN 360)
              </Text>
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  size="small"
                  variant="primary"
                  onClick={runLivePan}
                  isLoading={liveBusy === "pan"}
                  disabled={!!liveBusy}
                >
                  Run live PAN verify
                </Button>
                <Text size="small" className="text-ui-fg-subtle">
                  Cache hit re-uses the global pan_record · cache miss bills a Cashfree call.
                </Text>
              </div>
            </div>

            {/* Manual overrides — record an admin decision without
                hitting Cashfree. */}
            <div className="border-t border-ui-border-base pt-4">
              <Text size="small" className="text-ui-fg-muted font-medium uppercase tracking-widest mb-2">
                Manual override
              </Text>
              <div className="flex flex-wrap gap-2">
                <Button size="small" variant="secondary" onClick={() => decide("pan_approve")}>
                  Approve PAN
                </Button>
                <Button size="small" variant="secondary" onClick={() => decide("pan_reject")}>
                  Reject PAN
                </Button>
              </div>
            </div>
          </div>
        )}

        {/* ── Tab 2 — Aadhaar ─────────────────────────────────────── */}
        {subTab === "aadhaar" && (
          <div className="flex flex-col gap-4">
            {/* Aadhaar registry card — same shape as PanRecordCard.
                Sourced from /admin/customers/:id/aadhaar-record which
                joins customer.metadata.aadhaar_hash → aadhaar_record. */}
            <AadhaarRecordCard
              record={aadhaarRecord}
              loading={aadhaarRecordLoading}
              onRefresh={loadAadhaarRecord}
              latest={
                latestByKind["aadhaar_otp_verify"] ??
                latestByKind["aadhaar_otp_send"]
              }
            />

            <div className="border-t border-ui-border-base pt-4">
              <Text size="small" className="text-ui-fg-muted font-medium uppercase tracking-widest mb-2">
                Live verification (Cashfree OTP)
              </Text>
              <div className="flex flex-wrap items-start gap-2">
                {!aadhaarRefId ? (
                  <Button
                    size="small"
                    variant="primary"
                    onClick={runSendAadhaarOtp}
                    isLoading={liveBusy === "aadhaar_otp_send"}
                    disabled={!!liveBusy}
                  >
                    Send Aadhaar OTP
                  </Button>
                ) : (
                  <div className="flex items-start gap-2">
                    <Input
                      className="w-40"
                      placeholder="6-digit OTP"
                      value={aadhaarOtp}
                      onChange={(e) =>
                        setAadhaarOtp(e.target.value.replace(/\s+/g, ""))
                      }
                    />
                    <Button
                      size="small"
                      variant="primary"
                      onClick={runVerifyAadhaarOtp}
                      isLoading={liveBusy === "aadhaar_otp_verify"}
                      disabled={!!liveBusy}
                    >
                      Verify Aadhaar OTP
                    </Button>
                    <Button
                      size="small"
                      variant="transparent"
                      onClick={() => {
                        setAadhaarRefId(null)
                        setAadhaarOtp("")
                      }}
                      disabled={!!liveBusy}
                    >
                      Cancel
                    </Button>
                  </div>
                )}
              </div>
              <Text size="small" className="text-ui-fg-subtle mt-2">
                Customer receives the OTP on the mobile linked to their Aadhaar.
              </Text>
            </div>

            <div className="border-t border-ui-border-base pt-4">
              <Text size="small" className="text-ui-fg-muted font-medium uppercase tracking-widest mb-2">
                Manual override
              </Text>
              <div className="flex flex-wrap gap-2">
                <Button size="small" variant="secondary" onClick={() => decide("aadhaar_approve")}>
                  Approve Aadhaar
                </Button>
                <Button size="small" variant="secondary" onClick={() => decide("aadhaar_reject")}>
                  Reject Aadhaar
                </Button>
              </div>
            </div>

            <div className="border-t border-ui-border-base pt-4">
              <Text size="small" className="text-ui-fg-subtle">
                Latest attempt:{" "}
                {latestByKind["aadhaar_otp_verify"]
                  ? `${latestByKind["aadhaar_otp_verify"].status} · ${formatDate(latestByKind["aadhaar_otp_verify"].created_at)}`
                  : latestByKind["aadhaar_otp_send"]
                    ? `OTP sent · ${formatDate(latestByKind["aadhaar_otp_send"].created_at)}`
                    : "no attempts"}
              </Text>
            </div>
          </div>
        )}

        {/* ── Tab 3 — Bank (manual override for name_mismatch) ───── */}
        {subTab === "bank" && (
          <div className="flex flex-col gap-4">
            <Text size="small" className="text-ui-fg-muted">
              Manual override for the customer's bank rows. Use this when
              Cashfree's penny-drop returned a soft fail like
              `name_mismatch` and you've eyeballed the bank-proof PDF — the
              same `/admin/bank-accounts/:id/verify` endpoint as the Bank
              & Demat tab. After approval the row flips to{" "}
              <code className="font-mono">verified</code>, the audit log
              records the reason, and any held payment attempts drain.
            </Text>
            {accountsLoading && banks.length === 0 ? (
              <Text size="small" className="text-ui-fg-subtle">
                Loading…
              </Text>
            ) : banks.length === 0 ? (
              <Text size="small" className="text-ui-fg-subtle">
                Customer has no bank rows on file.
              </Text>
            ) : (
              <div className="rounded border border-ui-border-base">
                {banks.map((b) => (
                  <div
                    key={b.id}
                    className="flex flex-wrap items-center gap-3 border-b border-ui-border-base p-3 last:border-b-0"
                  >
                    <div className="min-w-0 flex-1">
                      <Text className="font-medium">
                        {b.account_holder_name}
                      </Text>
                      <Text size="xsmall" className="text-ui-fg-subtle">
                        {b.bank_name ?? "Bank"} · …{b.account_number_last4} ·{" "}
                        {b.ifsc}
                      </Text>
                    </div>
                    <StatusBadge color={statusBadgeColor(b.verification_status)}>
                      {b.verification_status}
                    </StatusBadge>
                    {b.is_primary && (
                      <StatusBadge color="blue">primary</StatusBadge>
                    )}
                    <Button
                      size="small"
                      variant="secondary"
                      disabled={
                        verifyBusy === b.id ||
                        b.verification_status === "verified"
                      }
                      onClick={() => verifyBankFromKyc(b.id, "approved")}
                    >
                      Manual verify
                    </Button>
                    <Button
                      size="small"
                      variant="secondary"
                      disabled={verifyBusy === b.id}
                      onClick={() => verifyBankFromKyc(b.id, "rejected")}
                    >
                      Reject
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* ── Tab 4 — Demat (manual override) ──────────────────────── */}
        {subTab === "demat" && (
          <div className="flex flex-col gap-4">
            <Text size="small" className="text-ui-fg-muted">
              Manual override for the customer's demat rows. Cashfree's
              CMR path is no longer in production — every demat is reviewed
              against the uploaded CMR PDF. Approving here flips the row to{" "}
              <code className="font-mono">verified</code> and is_primary=true
              if no other primary exists.
            </Text>
            {accountsLoading && demats.length === 0 ? (
              <Text size="small" className="text-ui-fg-subtle">
                Loading…
              </Text>
            ) : demats.length === 0 ? (
              <Text size="small" className="text-ui-fg-subtle">
                Customer has no demat rows on file.
              </Text>
            ) : (
              <div className="rounded border border-ui-border-base">
                {demats.map((d) => (
                  <div
                    key={d.id}
                    className="flex flex-wrap items-center gap-3 border-b border-ui-border-base p-3 last:border-b-0"
                  >
                    <div className="min-w-0 flex-1">
                      <Text className="font-medium">
                        {d.account_holder_name}
                      </Text>
                      <Text size="xsmall" className="text-ui-fg-subtle">
                        {d.depository} · {d.dp_name}
                        {d.boid ? ` · BOID ${d.boid}` : ""}
                        {d.dp_id ? ` · DP-ID ${d.dp_id}` : ""}
                        {d.client_id ? ` · Client ${d.client_id}` : ""}
                      </Text>
                    </div>
                    {d.cmr_file_url && (
                      <a
                        href={d.cmr_file_url}
                        target="_blank"
                        rel="noreferrer"
                        className="text-ui-fg-interactive text-xs underline"
                      >
                        View CMR
                      </a>
                    )}
                    <StatusBadge color={statusBadgeColor(d.verification_status)}>
                      {d.verification_status}
                    </StatusBadge>
                    {d.is_primary && (
                      <StatusBadge color="blue">primary</StatusBadge>
                    )}
                    <Button
                      size="small"
                      variant="secondary"
                      disabled={
                        verifyBusy === d.id ||
                        d.verification_status === "verified"
                      }
                      onClick={() => verifyDematFromKyc(d.id, "approved")}
                    >
                      Manual verify
                    </Button>
                    <Button
                      size="small"
                      variant="secondary"
                      disabled={verifyBusy === d.id}
                      onClick={() => verifyDematFromKyc(d.id, "rejected")}
                    >
                      Reject
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* ── Tab 3 — Manual edit (full edit form) ──────────────── */}
        {subTab === "manual" && (
          <div className="flex flex-col gap-4">
            <Text size="small" className="text-ui-fg-muted">
              Full-edit access for every KYC field on the customer
              record. Each change is logged to the audit trail. Use for
              sandbox-mode customers, upstream outages, or one-off
              corrections — the live verify path on the PAN / Aadhaar
              tabs is the canonical flow.
            </Text>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {EDITABLE_FIELDS.map((f) => (
                <div key={f.key}>
                  <Label size="small">{f.label}</Label>
                  <Input
                    value={form[f.key] ?? ""}
                    onChange={(e) =>
                      setForm((prev) => ({ ...prev, [f.key]: e.target.value }))
                    }
                    placeholder={f.placeholder ?? ""}
                  />
                </div>
              ))}
            </div>

            <div>
              <Label size="small">
                Reason for edit (audit required) <span className="text-ui-fg-error">*</span>
              </Label>
              <Textarea
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="Why are you making this change?"
                rows={2}
              />
            </div>

            {error && <Text className="text-ui-fg-error">{error}</Text>}
            {success && <Text className="text-ui-fg-interactive">{success}</Text>}

            <div>
              <Button onClick={save} isLoading={saving} disabled={saving || reason.trim().length < 4}>
                Save changes
              </Button>
            </div>
          </div>
        )}

        {/* ── Tab 4 — Audit log ────────────────────────────────── */}
        {subTab === "audit" && (
          <div className="flex flex-col gap-4">
            <Text size="small" className="text-ui-fg-muted">
              Every manual KYC review request the customer has
              submitted. Documents tab shows the actual files; this is
              the request-state timeline.
            </Text>
            {state?.manual_requests && state.manual_requests.length > 0 ? (
              <div className="flex flex-col gap-2">
                {state.manual_requests.map((r: any) => (
                  <div
                    key={r.id}
                    className="flex items-center justify-between py-2 border-b border-ui-border-base last:border-0"
                  >
                    <div className="flex flex-col">
                      <Text size="small" weight="plus">
                        {r.status ?? "pending"}
                      </Text>
                      <Text size="xsmall" className="text-ui-fg-subtle">
                        {formatDate(r.created_at)}
                      </Text>
                    </div>
                    <StatusBadge color={statusBadgeColor(r.status ?? "pending")}>
                      {r.status ?? "pending"}
                    </StatusBadge>
                  </div>
                ))}
              </div>
            ) : (
              <Text size="small" className="text-ui-fg-subtle">
                No manual KYC requests on file.
              </Text>
            )}
          </div>
        )}
      </Container>

    </div>
  )
}

/**
 * Rich PAN record card — sourced from the global `pan_record` table
 * via GET /admin/customers/:id/pan-record. Renders every field
 * Cashfree returns (PAN 360 / Advance), gracefully omitting cells
 * that are absent on the response (PAN Basic = ~3 fields, 360 =
 * the full set).
 *
 * The card is always present on the PAN sub-tab; an "empty" record
 * (customer never verified PAN) shows a placeholder instead of the
 * field grid.
 */
const PanRecordCard: React.FC<{
  record: PanRecord | null
  loading: boolean
  onRefresh: () => void
  latest?: VerificationSummary | null
}> = ({ record, loading, onRefresh, latest }) => {
  if (loading && !record) {
    return (
      <div className="rounded-md border border-ui-border-base bg-ui-bg-subtle p-4">
        <Text size="small" className="text-ui-fg-subtle">
          Loading PAN record…
        </Text>
      </div>
    )
  }
  if (!record) {
    return (
      <div className="rounded-md border border-dashed border-ui-border-base bg-ui-bg-subtle p-6">
        <Text weight="plus" size="small">
          No PAN on record
        </Text>
        <Text size="small" className="text-ui-fg-subtle mt-1">
          The customer hasn&apos;t completed PAN verification. They submit a
          PAN via /dashboard/kyc on the storefront, which writes a row to the
          global <code>pan_record</code> table and links it to this customer
          via metadata. Use the Run live PAN verify button below to trigger
          the call on the customer&apos;s behalf.
        </Text>
      </div>
    )
  }

  const Row: React.FC<{ label: string; value?: React.ReactNode }> = ({
    label,
    value,
  }) =>
    value === null || value === undefined || value === "" ? null : (
      <div className="flex flex-col">
        <Text size="xsmall" className="text-ui-fg-subtle uppercase tracking-widest">
          {label}
        </Text>
        <Text size="small">{value}</Text>
      </div>
    )

  const addressLine = record.address?.full_address
    ? record.address.full_address
    : [
        record.address?.street,
        record.address?.city,
        record.address?.state,
        record.address?.pincode,
        record.address?.country,
      ]
        .filter(Boolean)
        .join(", ") || null

  return (
    <div className="rounded-md border border-ui-border-base bg-ui-bg-subtle p-4">
      <div className="flex items-start justify-between gap-2 mb-3">
        <div>
          <Text weight="plus" size="small">
            PAN {record.pan_masked}
          </Text>
          <Text size="xsmall" className="text-ui-fg-subtle">
            Cached on{" "}
            {record.first_verified_at
              ? formatDate(record.first_verified_at)
              : "—"}
            {record.last_refreshed_at &&
              record.last_refreshed_at !== record.first_verified_at && (
                <> · refreshed {formatDate(record.last_refreshed_at)}</>
              )}
          </Text>
        </div>
        <Button size="small" variant="transparent" onClick={onRefresh} disabled={loading}>
          Refresh
        </Button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <Row label="Registered name" value={record.registered_name} />
        <Row label="Name on PAN card" value={record.name_pan_card} />
        <Row label="First name" value={record.first_name} />
        <Row label="Last name" value={record.last_name} />
        <Row label="Father's name" value={record.father_name} />
        <Row label="Type" value={record.pan_type} />
        <Row label="PAN status" value={record.pan_status} />
        <Row label="Date of birth" value={record.date_of_birth} />
        <Row label="Gender" value={record.gender} />
        <Row
          label="Aadhaar linked"
          value={
            typeof record.aadhaar_linked === "boolean"
              ? record.aadhaar_linked
                ? "Yes"
                : "No"
              : record.aadhaar_seeding_status_desc ??
                record.aadhaar_seeding_status ??
                undefined
          }
        />
        <Row label="Masked Aadhaar" value={record.masked_aadhaar} />
        <Row label="Email (masked)" value={record.email_masked} />
        <Row label="Mobile (masked)" value={record.phone_masked} />
        <Row label="Address" value={addressLine} />
        <Row label="ITD last updated" value={record.last_updated_at_itd} />
        <Row
          label="Name match (initial)"
          value={
            record.name_match_result_initial
              ? `${record.name_match_result_initial}${
                  record.name_match_score_initial
                    ? ` (${(record.name_match_score_initial * 100).toFixed(0)}%)`
                    : ""
                }`
              : undefined
          }
        />
        <Row label="Cashfree reference" value={record.cashfree_reference_id} />
      </div>

      {latest && (
        <div className="mt-3 pt-3 border-t border-ui-border-base">
          <Text size="xsmall" className="text-ui-fg-subtle">
            Latest verify attempt for this customer:{" "}
            <strong>{latest.status}</strong> · {formatDate(latest.created_at)}
          </Text>
        </div>
      )}
    </div>
  )
}

/**
 * Aadhaar registry card — mirror of PanRecordCard. Shows everything
 * persisted on `aadhaar_record` for this customer: holder name,
 * father / care-of, DOB, gender, address, holder photo, and (when
 * the masking flow has run) the masked-card image.
 *
 * Empty state mirrors PAN: dashed-border placeholder telling ops the
 * customer hasn't completed the OTP verify yet, so the run-OTP
 * controls below are the canonical path.
 */
const AadhaarRecordCard: React.FC<{
  record: AadhaarRecord | null
  loading: boolean
  onRefresh: () => void
  latest?: VerificationSummary | null
}> = ({ record, loading, onRefresh, latest }) => {
  if (loading && !record) {
    return (
      <div className="rounded-md border border-ui-border-base bg-ui-bg-subtle p-4">
        <Text size="small" className="text-ui-fg-subtle">
          Loading Aadhaar record…
        </Text>
      </div>
    )
  }
  if (!record) {
    return (
      <div className="rounded-md border border-dashed border-ui-border-base bg-ui-bg-subtle p-6">
        <Text weight="plus" size="small">
          No Aadhaar on record
        </Text>
        <Text size="small" className="text-ui-fg-subtle mt-1">
          The customer hasn&apos;t completed Aadhaar OTP verification —
          no row in the global <code>aadhaar_record</code> table is
          linked via <code>customer.metadata.aadhaar_hash</code>. Use
          the OTP controls below to send + verify on their behalf.
        </Text>
      </div>
    )
  }

  const Row: React.FC<{ label: string; value?: React.ReactNode }> = ({
    label,
    value,
  }) =>
    value === null || value === undefined || value === "" ? null : (
      <div className="flex flex-col">
        <Text size="xsmall" className="text-ui-fg-subtle uppercase tracking-widest">
          {label}
        </Text>
        <Text size="small">{value}</Text>
      </div>
    )

  // Address fallback chain — Cashfree returns it as a structured
  // object; we render `full_address` if present, else stitch the
  // structured fields into a single line.
  const a = (record.address ?? {}) as Record<string, string | number | undefined>
  const fullAddr = a.full_address as string | undefined
  const stitched = [
    a.house,
    a.street,
    a.locality,
    a.vtc,
    a.district,
    a.state,
    a.pincode,
    a.country,
  ]
    .filter(Boolean)
    .join(", ")
  const addressLine = fullAddr ? fullAddr : stitched || null

  return (
    <div className="rounded-md border border-ui-border-base bg-ui-bg-subtle p-4">
      <div className="flex items-start justify-between gap-2 mb-3">
        <div className="flex items-start gap-3">
          {record.photo_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={record.photo_url}
              alt={`Aadhaar photo of ${record.name}`}
              className="h-16 w-16 rounded-md border border-ui-border-base bg-ui-bg-base object-cover"
            />
          ) : null}
          <div>
            <Text weight="plus" size="small" className="font-mono">
              {record.aadhaar_full ?? record.aadhaar_masked}
            </Text>
            <Text size="xsmall" className="text-ui-fg-subtle">
              Cached on{" "}
              {record.first_verified_at
                ? formatDate(record.first_verified_at)
                : "—"}
              {record.last_refreshed_at &&
                record.last_refreshed_at !== record.first_verified_at && (
                  <> · refreshed {formatDate(record.last_refreshed_at)}</>
                )}
            </Text>
          </div>
        </div>
        <Button size="small" variant="transparent" onClick={onRefresh} disabled={loading}>
          Refresh
        </Button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <Row label="Holder name" value={record.name} />
        <Row label="Father / care-of" value={record.father_name} />
        <Row label="Date of birth" value={record.date_of_birth} />
        <Row label="Gender" value={record.gender} />
        <Row label="Address" value={addressLine} />
        <Row label="Cashfree reference" value={record.cashfree_ref_id} />
      </div>

      {latest && (
        <div className="mt-3 pt-3 border-t border-ui-border-base">
          <Text size="xsmall" className="text-ui-fg-subtle">
            Latest verify attempt for this customer:{" "}
            <strong>{latest.status}</strong> · {formatDate(latest.created_at)}
          </Text>
        </div>
      )}
    </div>
  )
}

function Field({
  label,
  value,
  color,
  latest,
}: {
  label: string
  value: string
  color: "green" | "orange" | "red" | "grey" | "blue"
  latest?: VerificationSummary | null
}) {
  return (
    <div>
      <Text className="text-ui-fg-muted text-xs uppercase tracking-widest mb-1">
        {label}
      </Text>
      <StatusBadge color={color}>{value}</StatusBadge>
      {latest && (
        <Text size="xsmall" className="text-ui-fg-subtle mt-1 block">
          Last {latest.kind.replace(/_/g, " ")}:{" "}
          <span
            className={
              latest.status === "success"
                ? "text-ui-fg-interactive font-medium"
                : latest.status === "failed"
                  ? "text-ui-fg-error font-medium"
                  : "text-ui-fg-muted"
            }
          >
            {latest.status}
          </span>{" "}
          · {new Date(latest.created_at).toLocaleString()}
        </Text>
      )}
    </div>
  )
}
