// @ts-nocheck — admin UI view copied verbatim from the host app. It uses
// `<Table.Cell colSpan={n}>`, which is valid HTML but not typed by
// @medusajs/ui@4.0.4 (Table.Cell uses HTMLAttributes, not TdHTMLAttributes).
// The admin bundler (swc/vite) strips types, so this is runtime-safe; the
// directive only silences the server-side tsc gate. TODO: drop once the
// plugin's @medusajs/ui is bumped to a version that types colSpan.
import React, { useCallback, useEffect, useMemo, useState } from "react"
import { defineRouteConfig } from "@medusajs/admin-sdk"
import {
  Badge,
  Button,
  Container,
  Heading,
  Input,
  StatusBadge,
  Table,
  Text,
  Textarea,
} from "@medusajs/ui"
import { ShieldCheck, ArrowUpRightOnBox, Eye, EyeSlash } from "@medusajs/icons"

/**
 * /app/manual-kyc — KYC admin surface (consolidated 2026-05-07).
 *
 * Two views, switchable from the page header:
 *
 *   1. "Review queue" — the manual_kyc_request inbox with a per-row
 *      detail panel. Each row represents a customer whose automated
 *      PAN/Aadhaar verification fell into the GOOD MATCH band
 *      (0.60–0.80 score) — name aligns enough to flag but not enough
 *      to auto-approve. The detail panel surfaces:
 *        - What the customer typed (name, PAN, Aadhaar) on the storefront
 *        - What the registry says the holder name is (cached
 *          pan_record / aadhaar_record from Cashfree / UIDAI)
 *        - Cross-doc score and grade
 *        - Every uploaded document URL — PAN card, Aadhaar card,
 *          selfie, bank proof, demat CMR
 *      Approving from here writes the metadata anchors + audit row +
 *      email + auto-closes the request via
 *      POST /admin/customers/:id/kyc/manual. The same code path
 *      Customer-360's KYC tab uses, just with the full diagnostic
 *      packet right next to the buttons.
 *
 *   2. "Partial KYC" — customers with `kyc.overall === "in_progress"`,
 *      sorted most-progressed first. Folded in from the deprecated
 *      /app/kyc page. Click-through goes to /app/customer-360 (no
 *      manual_kyc_request row, so there's nothing to render in the
 *      review-queue detail panel — Customer-360 → KYC has the
 *      finer-grained controls these customers need).
 */

type FileEntry = {
  url: string
  kind: string
  source: { entity: string; id: string }
  label?: string
  created_at?: string | null
}

type ManualKycDetail = {
  request: {
    id: string
    customer_id: string
    status: "pending" | "approved" | "rejected" | "cancelled"
    customer_note: string | null
    reviewer_notes: string | null
    reviewed_at: string | null
    created_at: string
  }
  customer: {
    id: string
    email: string | null
    first_name: string | null
    last_name: string | null
    phone: string | null
    phone_verified: boolean
    email_verified: boolean
    full_name_metadata: string | null
    pan_registered_name: string | null
    pan_hash: string | null
    aadhaar_hash: string | null
  } | null
  submitted_pan: {
    attempted_at: string
    status: string
    pan_masked: string | null
    submitted_name: string | null
    name_match_score: number | null
    name_match_result: string | null
    mismatch_hint: string | null
    cached_match: boolean | null
    reason: string | null
    pan_record_id: string | null
  } | null
  submitted_aadhaar: {
    send_attempted_at: string | null
    send_status: string | null
    verify_attempted_at: string | null
    verify_status: string | null
    aadhaar_masked: string | null
    holder_name: string | null
    cross_doc_score: number | null
    cross_doc_grade: string | null
    pending_reason: string | null
    cached_match: boolean | null
    aadhaar_record_id: string | null
  } | null
  pan_record: Record<string, any> | null
  aadhaar_record: Record<string, any> | null
  files: FileEntry[]
  pending_demats?: Array<{
    id: string
    depository: "NSDL" | "CDSL"
    dp_name: string
    dp_id: string | null
    client_id: string | null
    boid: string | null
    account_holder_name: string
    cmr_file_url: string | null
    verification_status: string
    is_primary: boolean
    created_at: string
  }>
  pending_banks?: Array<{
    id: string
    bank_name: string | null
    account_holder_name: string
    account_number_last4: string
    /** Full account number, resolved from bank_record (the global
     *  Cashfree BAV cache). Null when the bank hasn't been penny-drop
     *  verified yet — the admin reveal toggle stays hidden in that
     *  case. */
    account_number_full?: string | null
    ifsc: string
    name_at_bank: string | null
    name_match_score: number | null
    bank_proof_file_url: string | null
    bank_proof_type: string | null
    verification_status: string
    is_primary: boolean
    created_at: string
  }>
  /** Same shape the list endpoint returns — KYC steps the customer is
   *  still blocked on. Empty when everything is green, in which case
   *  the panel renders no action buttons (the row is informational
   *  only and will auto-close when KYC closes via the canonical path). */
  pending_steps?: Array<"PAN" | "Aadhaar" | "Bank" | "Demat / CMR">
}

type ManualRequestRow = {
  id: string
  customer_id: string
  status: string
  customer_note: string | null
  reviewer_notes: string | null
  reviewed_at: string | null
  created_at: string
  /** Steps the customer is still blocked on (empty when fully green).
   *  Hydrated server-side; reflects current state, not the state at
   *  request creation. */
  pending_steps: Array<"PAN" | "Aadhaar" | "Bank" | "Demat / CMR">
  /** Identity-verification kinds with at least one pending audit row
   *  for this customer (i.e. a partial-match attempt waiting for
   *  human review). Drives the PAN/Aadhaar tab filtering — distinct
   *  from `pending_steps` which is "what they haven't completed". */
  pending_kinds?: Array<"pan" | "aadhaar">
}

type PartialKycRow = {
  customer_id: string
  email: string | null
  first_name: string | null
  last_name: string | null
  overall: string
  pan_verified: boolean
  aadhaar_verified: boolean
  has_verified_bank: boolean
  has_primary_demat: boolean
  last_failure_reason: string | null
}

type BankPendingRow = {
  id: string
  customer_id: string
  email: string | null
  first_name: string | null
  last_name: string | null
  account_holder_name: string
  bank_name: string | null
  account_number_last4: string
  ifsc: string
  verification_status: string
  name_match_score: number | null
  created_at: string
  bank_proof_file_url: string | null
  /** Cashfree-side registry slice for this account, looked up by
   *  bank_hash. null when the registry has no row yet (cache miss). */
  registry: {
    name_at_bank: string | null
    name_match_result: string | null
    name_match_score: number | null
    account_status: string | null
    account_status_code: string | null
    bank_name: string | null
    branch: string | null
    city: string | null
    first_verified_at: string | null
    last_refreshed_at: string | null
  } | null
}

type DematPendingRow = {
  id: string
  customer_id: string
  email: string | null
  first_name: string | null
  last_name: string | null
  account_holder_name: string
  depository: string
  dp_name: string
  dp_id: string | null
  client_id: string | null
  boid: string | null
  verification_status: string
  cmr_file_url: string | null
  is_primary: boolean
  created_at: string
  /** PAN + Aadhaar canonical holder names for the customer. The
   *  CMR-uploaded holder name should match one of these. null
   *  when neither registry has a row yet. */
  registry: {
    pan_registered_name: string | null
    pan_name_on_card: string | null
    aadhaar_holder_name: string | null
  } | null
}

async function adminFetch<T = any>(
  url: string,
  init: RequestInit = {},
): Promise<T> {
  const res = await fetch(url, {
    credentials: "include",
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init.headers || {}),
    },
  })
  const body = await res.json().catch(() => ({}))
  if (!res.ok) {
    throw new Error((body as any)?.message || `${res.status} ${res.statusText}`)
  }
  return body as T
}

function formatDate(iso: string | null | undefined): string {
  if (!iso) return "—"
  try {
    return new Date(iso).toLocaleString("en-IN", {
      day: "2-digit",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    })
  } catch {
    return iso
  }
}

function badgeColor(status: string): "green" | "red" | "orange" | "grey" | "blue" {
  if (status === "approved") return "green"
  if (status === "rejected") return "red"
  if (status === "cancelled") return "grey"
  return "orange"
}

const ManualKycPage: React.FC = () => {
  // View tabs:
  //   - manual:  the unified Review queue (every pending manual_kyc_request).
  //              Identity-level review work (PAN + Aadhaar) lives here —
  //              the per-row detail panel shows the submitted-vs-registry
  //              diagnostic for both. Dedicated PAN / Aadhaar tabs were
  //              tried earlier but ended up as duplicates of this view
  //              (every queue row is identity-blocked by definition,
  //              so the filter was a no-op in practice).
  //   - bank:    the per-bank-row pending reviews list (different data source)
  //   - demat:   the per-demat-row pending reviews list
  //   - partial: customers with kyc.overall = "in_progress" (sorted by progress)
  // Bank / demat have their own sub-pages because their actions are
  // per-row and use different endpoints (/admin/bank-accounts/:id/verify etc.).
  const [view, setView] = useState<
    "manual" | "partial" | "bank" | "demat"
  >("manual")
  const [statusFilter, setStatusFilter] = useState<
    "pending" | "approved" | "rejected" | "all"
  >("pending")
  const [rows, setRows] = useState<ManualRequestRow[]>([])
  const [loadingList, setLoadingList] = useState(false)
  const [listError, setListError] = useState<string | null>(null)
  const [activeId, setActiveId] = useState<string | null>(null)

  const loadList = useCallback(async () => {
    setLoadingList(true)
    setListError(null)
    try {
      const r = await adminFetch<{ requests: ManualRequestRow[] }>(
        `/admin/manual-kyc-requests?status=${statusFilter}&limit=100`,
      )
      setRows(r.requests || [])
      // Auto-select the top row when filter changes / on first load.
      if (r.requests && r.requests[0] && !activeId) {
        setActiveId(r.requests[0].id)
      }
    } catch (e) {
      setListError(e instanceof Error ? e.message : "Failed to load queue")
    } finally {
      setLoadingList(false)
    }
  }, [statusFilter])

  useEffect(() => {
    void loadList()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [statusFilter])

  return (
    <Container className="p-0">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-ui-border-base px-6 py-4">
        <div className="flex items-center gap-2">
          <ShieldCheck className="text-ui-fg-subtle" />
          <Heading level="h1">KYC</Heading>
          <div className="ml-3 flex flex-wrap gap-1">
            <Button
              size="small"
              variant={view === "manual" ? "primary" : "secondary"}
              onClick={() => setView("manual")}
            >
              Review queue
            </Button>
            <Button
              size="small"
              variant={view === "bank" ? "primary" : "secondary"}
              onClick={() => setView("bank")}
            >
              Bank
            </Button>
            <Button
              size="small"
              variant={view === "demat" ? "primary" : "secondary"}
              onClick={() => setView("demat")}
            >
              Demat
            </Button>
            <Button
              size="small"
              variant={view === "partial" ? "primary" : "secondary"}
              onClick={() => setView("partial")}
            >
              Partial KYC
            </Button>
          </div>
        </div>
        {view === "manual" && (
          <div className="flex gap-1">
            {(["pending", "approved", "rejected", "all"] as const).map((s) => (
              <Button
                key={s}
                size="small"
                variant={statusFilter === s ? "primary" : "secondary"}
                onClick={() => {
                  setStatusFilter(s)
                  setActiveId(null)
                }}
              >
                {s}{" "}
                {s !== "all" && `(${s === statusFilter ? rows.length : ""})`}
              </Button>
            ))}
          </div>
        )}
      </div>

      {view === "partial" ? (
        <div className="p-6">
          <PartialKycTab />
        </div>
      ) : view === "bank" ? (
        <div className="p-6">
          <BankReviewsTab />
        </div>
      ) : view === "demat" ? (
        <div className="p-6">
          <DematReviewsTab />
        </div>
      ) : (
      <div className="grid grid-cols-1 gap-4 p-6 md:grid-cols-[320px_1fr]">
        {/* Queue */}
        <div className="rounded-md border border-ui-border-base">
          <div className="border-b border-ui-border-base px-3 py-2">
            <Text size="small" weight="plus">
              Queue ({rows.length})
            </Text>
          </div>
          <div className="max-h-[70vh] overflow-y-auto">
            {loadingList && (
              <div className="px-3 py-4">
                <Text size="small" className="text-ui-fg-subtle">
                  Loading…
                </Text>
              </div>
            )}
            {!loadingList && listError && (
              <div className="px-3 py-4">
                <Text size="small" className="text-ui-fg-error">
                  {listError}
                </Text>
              </div>
            )}
            {!loadingList && !listError && rows.length === 0 && (
              <div className="px-3 py-4">
                <Text size="small" className="text-ui-fg-subtle">
                  No requests in this status.
                </Text>
              </div>
            )}
            {rows.map((r) => (
              <button
                key={r.id}
                type="button"
                onClick={() => setActiveId(r.id)}
                className={`w-full border-b border-ui-border-base px-3 py-3 text-left transition-colors last:border-0 hover:bg-ui-bg-base-hover ${
                  activeId === r.id ? "bg-ui-bg-base-pressed" : ""
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <Text size="xsmall" weight="plus" className="truncate">
                    {r.customer_id}
                  </Text>
                  <StatusBadge color={badgeColor(r.status)}>
                    {r.status}
                  </StatusBadge>
                </div>
                <Text size="xsmall" className="text-ui-fg-subtle">
                  {formatDate(r.created_at)}
                </Text>
                {r.pending_steps && r.pending_steps.length > 0 && (
                  <div className="mt-1.5 flex flex-wrap gap-1">
                    {r.pending_steps.map((step) => (
                      <StatusBadge key={step} color="orange">
                        {step}
                      </StatusBadge>
                    ))}
                  </div>
                )}
                {r.customer_note && (
                  <Text
                    size="xsmall"
                    className="mt-1 line-clamp-2 text-ui-fg-muted"
                  >
                    {r.customer_note}
                  </Text>
                )}
              </button>
            ))}
          </div>
        </div>

        {/* Detail panel */}
        <ManualKycDetailPanel
          requestId={activeId}
          onDecided={async () => {
            await loadList()
          }}
        />
      </div>
      )}
    </Container>
  )
}

/**
 * Partial KYC inbox — customers stuck mid-flow (`overall === "in_progress"`).
 * Reads `data.partial_kyc.items` from /admin/kyc-overview (kept after the
 * /app/kyc collapse since the `partial_kyc` slice has no other home yet).
 * Click-through goes to /app/customer-360 — these customers don't have a
 * manual_kyc_request row to render in the review-queue detail panel.
 */
const PartialKycTab: React.FC = () => {
  const [rows, setRows] = useState<PartialKycRow[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const r = await adminFetch<{
        partial_kyc: { items: PartialKycRow[] }
      }>("/admin/kyc-overview?status=pending&limit=50")
      setRows(r.partial_kyc?.items ?? [])
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load")
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  return (
    <div>
      <div className="mb-3 flex items-center justify-between">
        <Text size="small" className="text-ui-fg-subtle">
          Customers with at least one verification done but not all enabled
          steps complete. Most-progressed first. Click through to Customer
          360 → KYC for the per-step controls.
        </Text>
        <Button
          size="small"
          variant="transparent"
          onClick={refresh}
          disabled={loading}
        >
          Refresh
        </Button>
      </div>
      {error && (
        <Text className="mb-3 text-ui-fg-error" size="small">
          {error}
        </Text>
      )}
      <Table>
        <Table.Header>
          <Table.Row>
            <Table.HeaderCell>Customer</Table.HeaderCell>
            <Table.HeaderCell>PAN</Table.HeaderCell>
            <Table.HeaderCell>Aadhaar</Table.HeaderCell>
            <Table.HeaderCell>Bank</Table.HeaderCell>
            <Table.HeaderCell>Demat</Table.HeaderCell>
            <Table.HeaderCell>Last failure</Table.HeaderCell>
          </Table.Row>
        </Table.Header>
        <Table.Body>
          {loading && rows.length === 0 ? (
            <Table.Row>
              <Table.Cell colSpan={6}>
                <Text size="small" className="text-ui-fg-subtle">
                  Loading…
                </Text>
              </Table.Cell>
            </Table.Row>
          ) : rows.length === 0 ? (
            <Table.Row>
              <Table.Cell colSpan={6}>
                <Text size="small" className="text-ui-fg-subtle">
                  No customers stuck mid-KYC right now.
                </Text>
              </Table.Cell>
            </Table.Row>
          ) : (
            rows.map((p) => (
              <Table.Row
                key={p.customer_id}
                className="cursor-pointer"
                onClick={() => {
                  window.location.href = `/app/customer-360?id=${encodeURIComponent(
                    p.customer_id,
                  )}`
                }}
              >
                <Table.Cell>
                  <div className="flex flex-col">
                    <Text size="small" weight="plus">
                      {[p.first_name, p.last_name].filter(Boolean).join(" ") ||
                        "(no name)"}
                    </Text>
                    <Text size="xsmall" className="text-ui-fg-subtle">
                      {p.email ?? p.customer_id}
                    </Text>
                  </div>
                </Table.Cell>
                <PartialKycCell ok={p.pan_verified} />
                <PartialKycCell ok={p.aadhaar_verified} />
                <PartialKycCell ok={p.has_verified_bank} />
                <PartialKycCell ok={p.has_primary_demat} />
                <Table.Cell>
                  <Text size="xsmall" className="text-ui-fg-subtle">
                    {p.last_failure_reason ?? "—"}
                  </Text>
                </Table.Cell>
              </Table.Row>
            ))
          )}
        </Table.Body>
      </Table>
    </div>
  )
}

const PartialKycCell: React.FC<{ ok: boolean }> = ({ ok }) => (
  <Table.Cell>
    <StatusBadge color={ok ? "green" : "orange"}>
      {ok ? "done" : "pending"}
    </StatusBadge>
  </Table.Cell>
)

/** Small two-line key/value cell used in the inline registry rows.
 *  Renders an em-dash for null/empty values so admins can tell apart
 *  "field doesn't exist" from "field is set but empty". */
const RegistryField: React.FC<{ label: string; value: string | null }> = ({
  label,
  value,
}) => (
  <div>
    <Text
      size="xsmall"
      className="text-ui-fg-subtle uppercase tracking-[0.14em]"
    >
      {label}
    </Text>
    <Text size="small" className={value ? "" : "text-ui-fg-subtle"}>
      {value || "—"}
    </Text>
  </div>
)

/**
 * Bank reviews — bank rows in `name_mismatch` / `failed` state. Calls
 * /admin/bank-accounts/:id/verify (the same endpoint AccountsTab uses)
 * with a prompt-collected reason. After approval, the row's
 * verification_status flips to `verified` AND the global bank_record
 * gets backfilled (see [admin route]/verify).
 */
const BankReviewsTab: React.FC = () => {
  const [rows, setRows] = useState<BankPendingRow[]>([])
  const [demats, setDemats] = useState<DematPendingRow[]>([])
  const [loading, setLoading] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    setLoading(true)
    setErr(null)
    try {
      const r = await adminFetch<{
        banks_pending: { items: BankPendingRow[] }
        demats_pending: { items: DematPendingRow[] }
      }>("/admin/manual-kyc-queues?limit=200")
      setRows(r.banks_pending?.items ?? [])
      setDemats(r.demats_pending?.items ?? [])
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Failed to load")
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const decide = async (
    bankId: string,
    decision: "approved" | "rejected",
  ) => {
    const reason = prompt(`Reason for ${decision} (audit-logged, min 4 chars)?`)
    if (!reason || reason.trim().length < 4) return
    setBusyId(bankId)
    try {
      await adminFetch(`/admin/bank-accounts/${bankId}/verify`, {
        method: "POST",
        body: JSON.stringify({ decision, reason }),
      })
      await refresh()
    } catch (e) {
      alert(e instanceof Error ? e.message : "Verify failed")
    } finally {
      setBusyId(null)
    }
  }

  return (
    <div>
      <div className="mb-3 flex items-center justify-between">
        <Text size="small" className="text-ui-fg-subtle">
          Bank rows in <code>name_mismatch</code> or <code>failed</code> state.
          Approving here mirrors a successful penny-drop — flips the bank to
          verified, drains held payments, and backfills the global
          bank_record so the next customer adding the same account skips the
          Cashfree call.
        </Text>
        <Button
          size="small"
          variant="transparent"
          onClick={refresh}
          disabled={loading}
        >
          Refresh
        </Button>
      </div>
      {err && (
        <Text className="mb-3 text-ui-fg-error" size="small">
          {err}
        </Text>
      )}
      <Table>
        <Table.Header>
          <Table.Row>
            <Table.HeaderCell>Customer</Table.HeaderCell>
            <Table.HeaderCell>Holder / Bank</Table.HeaderCell>
            <Table.HeaderCell>A/C · IFSC</Table.HeaderCell>
            <Table.HeaderCell>Status</Table.HeaderCell>
            <Table.HeaderCell>Score</Table.HeaderCell>
            <Table.HeaderCell>Proof</Table.HeaderCell>
            <Table.HeaderCell className="text-right">Actions</Table.HeaderCell>
          </Table.Row>
        </Table.Header>
        <Table.Body>
          {loading && rows.length === 0 ? (
            <Table.Row>
              <Table.Cell colSpan={7}>
                <Text size="small" className="text-ui-fg-subtle">
                  Loading…
                </Text>
              </Table.Cell>
            </Table.Row>
          ) : rows.length === 0 ? (
            <Table.Row>
              <Table.Cell colSpan={7}>
                <Text size="small" className="text-ui-fg-subtle">
                  No bank reviews waiting.
                </Text>
              </Table.Cell>
            </Table.Row>
          ) : (
            rows.map((b) => (
              <React.Fragment key={b.id}>
                <Table.Row>
                  <Table.Cell>
                    <a
                      className="text-ui-fg-interactive hover:underline"
                      href={`/app/customer-360?id=${encodeURIComponent(b.customer_id)}`}
                    >
                      {[b.first_name, b.last_name].filter(Boolean).join(" ") ||
                        b.email ||
                        b.customer_id}
                    </a>
                    <div className="text-ui-fg-subtle text-xs">{b.email}</div>
                  </Table.Cell>
                  <Table.Cell>
                    <Text size="small" weight="plus">
                      {b.account_holder_name}
                    </Text>
                    <Text size="xsmall" className="text-ui-fg-subtle">
                      {b.bank_name ?? "—"}
                    </Text>
                  </Table.Cell>
                  <Table.Cell>
                    <span className="font-mono text-xs">
                      …{b.account_number_last4} · {b.ifsc}
                    </span>
                  </Table.Cell>
                  <Table.Cell>
                    <StatusBadge
                      color={
                        b.verification_status === "name_mismatch"
                          ? "orange"
                          : "red"
                      }
                    >
                      {b.verification_status}
                    </StatusBadge>
                  </Table.Cell>
                  <Table.Cell>
                    {b.name_match_score == null
                      ? "—"
                      : `${(b.name_match_score * 100).toFixed(0)}%`}
                  </Table.Cell>
                  <Table.Cell>
                    {b.bank_proof_file_url ? (
                      <a
                        href={b.bank_proof_file_url}
                        target="_blank"
                        rel="noreferrer"
                        className="text-ui-fg-interactive text-xs underline"
                      >
                        view
                      </a>
                    ) : (
                      <span className="text-ui-fg-subtle text-xs">—</span>
                    )}
                  </Table.Cell>
                  <Table.Cell className="text-right">
                    <div className="flex justify-end gap-1">
                      <Button
                        size="small"
                        variant="secondary"
                        disabled={busyId === b.id}
                        onClick={() => decide(b.id, "approved")}
                      >
                        Approve
                      </Button>
                      <Button
                        size="small"
                        variant="secondary"
                        disabled={busyId === b.id}
                        onClick={() => decide(b.id, "rejected")}
                      >
                        Reject
                      </Button>
                    </div>
                  </Table.Cell>
                </Table.Row>
                {/* Bank registry slice — what Cashfree's penny-drop
                    confirmed at first verify. Side-by-side with the
                    submitted holder name + bank-proof PDF, the admin
                    can spot a name-mismatch outright without opening
                    Customer 360. */}
                <Table.Row>
                  <Table.Cell colSpan={7} className="bg-ui-bg-subtle">
                    {b.registry ? (
                      <div className="grid grid-cols-2 gap-x-6 gap-y-1 px-2 py-2 text-xs md:grid-cols-4">
                        <RegistryField
                          label="Name at bank (registry)"
                          value={b.registry.name_at_bank}
                        />
                        <RegistryField
                          label="Submitted holder"
                          value={b.account_holder_name}
                        />
                        <RegistryField
                          label="Match result"
                          value={b.registry.name_match_result}
                        />
                        <RegistryField
                          label="Match score"
                          value={
                            b.registry.name_match_score != null
                              ? `${(b.registry.name_match_score * 100).toFixed(0)}%`
                              : null
                          }
                        />
                        <RegistryField
                          label="Account status"
                          value={
                            b.registry.account_status_code ??
                            b.registry.account_status
                          }
                        />
                        <RegistryField
                          label="Bank · branch · city"
                          value={[
                            b.registry.bank_name,
                            b.registry.branch,
                            b.registry.city,
                          ]
                            .filter(Boolean)
                            .join(" · ") || null}
                        />
                        <RegistryField
                          label="First verified"
                          value={
                            b.registry.first_verified_at
                              ? formatDate(b.registry.first_verified_at)
                              : null
                          }
                        />
                        <RegistryField
                          label="Last refreshed"
                          value={
                            b.registry.last_refreshed_at
                              ? formatDate(b.registry.last_refreshed_at)
                              : null
                          }
                        />
                      </div>
                    ) : (
                      <Text size="xsmall" className="px-2 py-2 text-ui-fg-subtle">
                        Bank registry has no row for this account yet — first
                        verify (Cashfree or manual) will create one.
                      </Text>
                    )}
                  </Table.Cell>
                </Table.Row>
              </React.Fragment>
            ))
          )}
        </Table.Body>
      </Table>
      {demats.length > 0 && (
        <Text size="small" className="text-ui-fg-subtle mt-3">
          {demats.length} demat review(s) pending — switch to the Demat
          reviews tab.
        </Text>
      )}
    </div>
  )
}

/**
 * Demat reviews — manual approve/reject for demat rows. CMR PDF opens
 * inline. Calls /admin/demat-accounts/:id/verify.
 */
const DematReviewsTab: React.FC = () => {
  const [rows, setRows] = useState<DematPendingRow[]>([])
  const [loading, setLoading] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    setLoading(true)
    setErr(null)
    try {
      const r = await adminFetch<{
        demats_pending: { items: DematPendingRow[] }
      }>("/admin/manual-kyc-queues?limit=200")
      setRows(r.demats_pending?.items ?? [])
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Failed to load")
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const decide = async (
    dematId: string,
    decision: "approved" | "rejected",
  ) => {
    const reason = prompt(`Reason for ${decision} (audit-logged, min 4 chars)?`)
    if (!reason || reason.trim().length < 4) return
    setBusyId(dematId)
    try {
      await adminFetch(`/admin/demat-accounts/${dematId}/verify`, {
        method: "POST",
        body: JSON.stringify({ decision, reason }),
      })
      await refresh()
    } catch (e) {
      alert(e instanceof Error ? e.message : "Verify failed")
    } finally {
      setBusyId(null)
    }
  }

  return (
    <div>
      <div className="mb-3 flex items-center justify-between">
        <Text size="small" className="text-ui-fg-subtle">
          Every newly-added demat lands as <code>pending</code> — Cashfree's
          CMR auto-verify path is gone, so ops eyeballs the uploaded CMR PDF
          and approves manually here.
        </Text>
        <Button
          size="small"
          variant="transparent"
          onClick={refresh}
          disabled={loading}
        >
          Refresh
        </Button>
      </div>
      {err && (
        <Text className="mb-3 text-ui-fg-error" size="small">
          {err}
        </Text>
      )}
      <Table>
        <Table.Header>
          <Table.Row>
            <Table.HeaderCell>Customer</Table.HeaderCell>
            <Table.HeaderCell>Holder</Table.HeaderCell>
            <Table.HeaderCell>Depository · DP</Table.HeaderCell>
            <Table.HeaderCell>BOID / DP-ID</Table.HeaderCell>
            <Table.HeaderCell>Status</Table.HeaderCell>
            <Table.HeaderCell>CMR</Table.HeaderCell>
            <Table.HeaderCell className="text-right">Actions</Table.HeaderCell>
          </Table.Row>
        </Table.Header>
        <Table.Body>
          {loading && rows.length === 0 ? (
            <Table.Row>
              <Table.Cell colSpan={7}>
                <Text size="small" className="text-ui-fg-subtle">
                  Loading…
                </Text>
              </Table.Cell>
            </Table.Row>
          ) : rows.length === 0 ? (
            <Table.Row>
              <Table.Cell colSpan={7}>
                <Text size="small" className="text-ui-fg-subtle">
                  No demat reviews waiting.
                </Text>
              </Table.Cell>
            </Table.Row>
          ) : (
            rows.map((d) => (
              <React.Fragment key={d.id}>
                <Table.Row>
                  <Table.Cell>
                    <a
                      className="text-ui-fg-interactive hover:underline"
                      href={`/app/customer-360?id=${encodeURIComponent(d.customer_id)}`}
                    >
                      {[d.first_name, d.last_name].filter(Boolean).join(" ") ||
                        d.email ||
                        d.customer_id}
                    </a>
                    <div className="text-ui-fg-subtle text-xs">{d.email}</div>
                  </Table.Cell>
                  <Table.Cell>
                    <Text size="small" weight="plus">
                      {d.account_holder_name}
                    </Text>
                    {d.is_primary && (
                      <StatusBadge color="blue" className="ml-1">
                        primary
                      </StatusBadge>
                    )}
                  </Table.Cell>
                  <Table.Cell>
                    <Text size="small">{d.depository}</Text>
                    <Text size="xsmall" className="text-ui-fg-subtle">
                      {d.dp_name}
                    </Text>
                  </Table.Cell>
                  <Table.Cell>
                    <span className="font-mono text-xs">
                      {d.boid ?? `${d.dp_id ?? "?"} · ${d.client_id ?? "?"}`}
                    </span>
                  </Table.Cell>
                  <Table.Cell>
                    <StatusBadge
                      color={
                        d.verification_status === "name_mismatch"
                          ? "orange"
                          : d.verification_status === "failed"
                            ? "red"
                            : "orange"
                      }
                    >
                      {d.verification_status}
                    </StatusBadge>
                  </Table.Cell>
                  <Table.Cell>
                    {d.cmr_file_url ? (
                      <a
                        href={d.cmr_file_url}
                        target="_blank"
                        rel="noreferrer"
                        className="text-ui-fg-interactive text-xs underline"
                      >
                        view CMR
                      </a>
                    ) : (
                      <span className="text-ui-fg-subtle text-xs">—</span>
                    )}
                  </Table.Cell>
                  <Table.Cell className="text-right">
                    <div className="flex justify-end gap-1">
                      <Button
                        size="small"
                        variant="secondary"
                        disabled={busyId === d.id}
                        onClick={() => decide(d.id, "approved")}
                      >
                        Approve
                      </Button>
                      <Button
                        size="small"
                        variant="secondary"
                        disabled={busyId === d.id}
                        onClick={() => decide(d.id, "rejected")}
                      >
                        Reject
                      </Button>
                    </div>
                  </Table.Cell>
                </Table.Row>
                {/* Customer's PAN + Aadhaar canonical names — the
                    values the CMR's holder name should match. Lets
                    the admin spot a name-mismatch on the CMR PDF
                    without leaving the page. */}
                <Table.Row>
                  <Table.Cell colSpan={7} className="bg-ui-bg-subtle">
                    {d.registry &&
                    (d.registry.pan_registered_name ||
                      d.registry.pan_name_on_card ||
                      d.registry.aadhaar_holder_name) ? (
                      <div className="grid grid-cols-2 gap-x-6 gap-y-1 px-2 py-2 text-xs md:grid-cols-3">
                        <RegistryField
                          label="CMR holder (submitted)"
                          value={d.account_holder_name}
                        />
                        <RegistryField
                          label="PAN registered name"
                          value={d.registry.pan_registered_name}
                        />
                        <RegistryField
                          label="Name on PAN card"
                          value={d.registry.pan_name_on_card}
                        />
                        <RegistryField
                          label="Aadhaar holder name"
                          value={d.registry.aadhaar_holder_name}
                        />
                      </div>
                    ) : (
                      <Text size="xsmall" className="px-2 py-2 text-ui-fg-subtle">
                        Customer has no PAN / Aadhaar registry rows yet —
                        nothing to compare the CMR holder name against.
                      </Text>
                    )}
                  </Table.Cell>
                </Table.Row>
              </React.Fragment>
            ))
          )}
        </Table.Body>
      </Table>
    </div>
  )
}

const ManualKycDetailPanel: React.FC<{
  requestId: string | null
  onDecided: () => void
}> = ({ requestId, onDecided }) => {
  const [detail, setDetail] = useState<ManualKycDetail | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [decideReason, setDecideReason] = useState("")
  const [busyAction, setBusyAction] = useState<
    "approve_pan" | "approve_aadhaar" | "approve_both" | "reject" | null
  >(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [actionSuccess, setActionSuccess] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!requestId) {
      setDetail(null)
      return
    }
    setLoading(true)
    setError(null)
    setActionError(null)
    setActionSuccess(null)
    try {
      const d = await adminFetch<ManualKycDetail>(
        `/admin/manual-kyc-requests/${requestId}`,
      )
      setDetail(d)
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load detail")
    } finally {
      setLoading(false)
    }
  }, [requestId])

  useEffect(() => {
    void load()
  }, [load])

  const runAction = async (
    label: "approve_pan" | "approve_aadhaar" | "approve_both" | "reject",
  ) => {
    if (!detail?.customer?.id) return
    if (decideReason.trim().length < 4) {
      setActionError("Reason is required (min 4 chars) for the audit log.")
      return
    }
    setBusyAction(label)
    setActionError(null)
    setActionSuccess(null)
    const body: Record<string, unknown> = { reason: decideReason.trim() }
    if (label === "approve_pan") body.pan_approve = true
    if (label === "approve_aadhaar") body.aadhaar_approve = true
    if (label === "approve_both") {
      body.pan_approve = true
      body.aadhaar_approve = true
    }
    if (label === "reject") {
      body.pan_reject = true
      body.aadhaar_reject = true
    }
    try {
      await adminFetch(
        `/admin/customers/${detail.customer.id}/kyc/manual`,
        {
          method: "POST",
          body: JSON.stringify(body),
        },
      )
      setActionSuccess(
        label === "reject" ? "Rejected — request closed." : "Approved — request closed.",
      )
      setDecideReason("")
      await load()
      onDecided()
    } catch (e) {
      setActionError(e instanceof Error ? e.message : "Action failed")
    } finally {
      setBusyAction(null)
    }
  }

  // The "Mark resolved" / `markResolved` helper was removed on
  // 2026-05-15. The button surface was confusing — it CLOSED the queue
  // row without writing any KYC audit data (no approval, no rejection,
  // just a status flip to 'cancelled'). Ops kept clicking it on rows
  // that actually needed Approve / Reject action, which buried the
  // row before the real verification step ran. The new model:
  //   - If a row has actionable blockers → Approve / Reject buttons
  //     are visible. Admin picks one of those.
  //   - If a row has NO actionable blockers (customer's KYC already
  //     fully approved out-of-band) → NO action buttons render. The
  //     row is informational only and the server-side auto-close hook
  //     in fireInvestingReadyIfReady will close it next time the
  //     customer's KYC closes via the canonical path.
  // See utils/onboarding-events.ts for the auto-close logic.

  if (!requestId) {
    return (
      <div className="rounded-md border border-dashed border-ui-border-base p-10 text-center">
        <Text size="small" className="text-ui-fg-subtle">
          Select a request from the queue to review.
        </Text>
      </div>
    )
  }

  if (loading && !detail) {
    return (
      <div className="rounded-md border border-ui-border-base p-6">
        <Text size="small" className="text-ui-fg-subtle">
          Loading review…
        </Text>
      </div>
    )
  }

  if (error) {
    return (
      <div className="rounded-md border border-ui-border-error p-6">
        <Text size="small" className="text-ui-fg-error">
          {error}
        </Text>
      </div>
    )
  }

  if (!detail) return null

  const {
    request,
    customer,
    submitted_pan,
    submitted_aadhaar,
    pan_record,
    aadhaar_record,
    files,
    pending_demats,
    pending_banks,
    pending_steps,
  } = detail
  const pendingDecision = request.status === "pending"
  // Per-document verified state — drives whether each individual
  // approve button stays visible. Even if the manual_kyc_request row
  // is still `pending`, an admin who already approved PAN out-of-band
  // (Customer-360, prior queue close, etc.) shouldn't see the PAN
  // approve button anymore. Same for Aadhaar.
  const panVerified = Boolean(customer?.pan_hash)
  const aadhaarVerified = Boolean(customer?.aadhaar_hash)
  // `pending_steps` is hydrated server-side off the customer's CURRENT
  // state (not the state at request creation). Empty list = there is
  // genuinely nothing the admin can act on through this row — the
  // panel renders zero action buttons and the row stays open until the
  // server-side auto-close hook fires when KYC completes via the
  // canonical path. Non-empty = the row is still doing useful work and
  // approve/reject buttons drive the workflow.
  const remainingSteps = pending_steps ?? []
  // Whether the panel should expose Approve / Reject buttons at all.
  // We gate on "the row is in a pending state AND the customer still
  // has an identity step blocked" — i.e. PAN or Aadhaar work remains.
  // Bank / Demat blockers don't enable the PAN/Aadhaar approve buttons
  // because those are handled by per-row admin endpoints below.
  const hasIdentityBlockers =
    remainingSteps.includes("PAN") || remainingSteps.includes("Aadhaar")
  const showActionRow = pendingDecision && hasIdentityBlockers

  return (
    <div className="space-y-4">
      {/* Customer header */}
      <div className="rounded-md border border-ui-border-base p-4">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <div>
            <div className="flex items-center gap-2">
              <Heading level="h3">
                {customer?.first_name || customer?.last_name
                  ? `${customer?.first_name ?? ""} ${customer?.last_name ?? ""}`.trim()
                  : customer?.email ?? request.customer_id}
              </Heading>
              <StatusBadge color={badgeColor(request.status)}>
                {request.status}
              </StatusBadge>
            </div>
            <Text size="small" className="text-ui-fg-subtle">
              Request {request.id} · opened {formatDate(request.created_at)}
            </Text>
          </div>
          <a
            href={`/app/customer-360?id=${request.customer_id}`}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 text-ui-fg-interactive hover:underline"
          >
            <ArrowUpRightOnBox /> Customer 360
          </a>
        </div>
        <KvGrid
          rows={[
            ["Email", customer?.email ?? "—", customer?.email_verified ? "verified" : ""],
            ["Phone", customer?.phone ?? "—", customer?.phone_verified ? "verified" : ""],
            ["Customer ID", request.customer_id],
            ["Profile name (metadata)", customer?.full_name_metadata ?? "—"],
          ]}
        />
        {request.customer_note && (
          <div className="mt-3 rounded-md bg-ui-bg-subtle p-3">
            <Text size="xsmall" weight="plus" className="text-ui-fg-subtle">
              Customer note
            </Text>
            <Text size="small">{request.customer_note}</Text>
          </div>
        )}
        {/* Why this row is still in the queue — at a glance. When every
            KYC step has flipped green out-of-band (customer self-verified
            cleanly, an admin approved via Customer-360, the partial-
            match auto-close failed silently, etc.) `pending_steps` is
            empty and the panel just renders the green "nothing pending"
            badge. No close button — the server-side auto-close hook
            picks up stale rows on the next KYC-complete event. */}
        {pendingDecision && (
          <div className="mt-3 rounded-md border border-ui-border-base p-3">
            <Text size="xsmall" weight="plus" className="text-ui-fg-subtle">
              Open KYC blockers
            </Text>
            {remainingSteps.length === 0 ? (
              <div className="mt-1 flex items-center gap-2">
                <StatusBadge color="green">none — all steps verified</StatusBadge>
                <Text size="xsmall" className="text-ui-fg-subtle">
                  Nothing pending. This row will auto-close on the customer's next KYC milestone.
                </Text>
              </div>
            ) : (
              <div className="mt-1 flex flex-wrap gap-1">
                {remainingSteps.map((step) => (
                  <StatusBadge key={step} color="orange">
                    {step}
                  </StatusBadge>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* PAN side-by-side */}
      <DiagSection
        title="PAN"
        submitted={
          submitted_pan && (
            <KvGrid
              rows={[
                [
                  "PAN",
                  <RevealableValue
                    key="pan-reveal"
                    masked={submitted_pan.pan_masked ?? "—"}
                    unmasked={pan_record?.pan_full ?? null}
                  />,
                ],
                ["Submitted name", submitted_pan.submitted_name ?? "—"],
                ["Name-match score", scoreCell(submitted_pan.name_match_score)],
                ["Match grade", submitted_pan.name_match_result ?? "—"],
                [
                  "Mismatch hint",
                  submitted_pan.mismatch_hint
                    ? mismatchHintLabel(submitted_pan.mismatch_hint)
                    : "—",
                ],
                ["Cached match", submitted_pan.cached_match ? "yes" : "no"],
                ["Reason flag", submitted_pan.reason ?? "—"],
                ["Latest attempt", formatDate(submitted_pan.attempted_at)],
                ["Attempt status", submitted_pan.status],
              ]}
            />
          )
        }
        registry={
          pan_record && (
            <KvGrid
              rows={[
                // Source of truth for `registered_name` is the Income
                // Tax Department's PAN record. Cashfree is just the
                // retrieval API that fetched it — labelling the row
                // "Cashfree" obscured this and ops kept asking what
                // the "Cashfree registry" was. The field is the ITD's
                // canonical name; `name_pan_card` below is the form
                // printed on the physical card (often a shorter
                // variant, e.g. middle name dropped).
                ["Registered name (ITD)", pan_record.registered_name ?? "—"],
                ["Name on PAN card", pan_record.name_pan_card ?? "—"],
                ["Father's name", pan_record.father_name ?? "—"],
                ["Date of birth", pan_record.date_of_birth ?? "—"],
                ["PAN type", pan_record.pan_type ?? "—"],
                ["PAN status", pan_record.pan_status ?? "—"],
                ["Aadhaar linked", pan_record.aadhaar_linked === true ? "yes" : pan_record.aadhaar_linked === false ? "no" : "—"],
                ["Aadhaar (masked)", pan_record.masked_aadhaar ?? "—"],
                ["Gender", pan_record.gender ?? "—"],
                ["First verified", formatDate(pan_record.first_verified_at)],
                ["Last refreshed", formatDate(pan_record.last_refreshed_at)],
              ]}
            />
          )
        }
      />

      {/* Inline PAN live-verify — when the registry is empty AND the
          row is still pending, surface the offline-verify form so the
          admin doesn't have to leave the queue page to enter the
          customer's PAN + name. Hidden once pan_record exists (admin
          should use the existing Approve/Reject buttons in the action
          row below instead). Hidden once the queue row is decided. */}
      {pendingDecision && !pan_record && customer?.id && (
        <InlineLivePanVerify
          customerId={customer.id}
          onDone={() => void load()}
        />
      )}

      {/* Aadhaar side-by-side */}
      <DiagSection
        title="Aadhaar"
        submitted={
          submitted_aadhaar && (
            <KvGrid
              rows={[
                [
                  "Aadhaar",
                  <RevealableValue
                    key="aadhaar-reveal"
                    masked={submitted_aadhaar.aadhaar_masked ?? "—"}
                    unmasked={aadhaar_record?.aadhaar_full ?? null}
                  />,
                ],
                ["UIDAI holder name", submitted_aadhaar.holder_name ?? "—"],
                ["Cross-doc score (vs PAN)", scoreCell(submitted_aadhaar.cross_doc_score)],
                ["Cross-doc grade", submitted_aadhaar.cross_doc_grade ?? "—"],
                ["Pending reason", submitted_aadhaar.pending_reason ?? "—"],
                ["Cached match", submitted_aadhaar.cached_match ? "yes" : "no"],
                ["OTP send", `${submitted_aadhaar.send_status ?? "—"} (${formatDate(submitted_aadhaar.send_attempted_at)})`],
                ["OTP verify", `${submitted_aadhaar.verify_status ?? "—"} (${formatDate(submitted_aadhaar.verify_attempted_at)})`],
              ]}
            />
          )
        }
        registry={
          aadhaar_record && (
            <KvGrid
              rows={[
                ["Holder name", aadhaar_record.name ?? "—"],
                ["Date of birth", aadhaar_record.date_of_birth ?? "—"],
                ["Gender", aadhaar_record.gender ?? "—"],
                ["Father's name", aadhaar_record.father_name ?? "—"],
                ["Has photo", aadhaar_record.has_photo === true ? "yes" : aadhaar_record.has_photo === false ? "no" : "—"],
                ["Photo URL", aadhaar_record.photo_url ? <a key="ph" href={aadhaar_record.photo_url} target="_blank" rel="noreferrer" className="text-ui-fg-interactive underline">open</a> : "—"],
                ["First verified", formatDate(aadhaar_record.first_verified_at)],
                ["Last refreshed", formatDate(aadhaar_record.last_refreshed_at)],
              ]}
            />
          )
        }
      />

      {/* Inline Aadhaar live-verify — same conditions as PAN: pending
          row + no aadhaar_record. Two-step OTP flow: admin enters the
          Aadhaar → OTP delivered to the customer's UIDAI-linked phone
          → admin coordinates with customer to read the OTP back. */}
      {pendingDecision && !aadhaar_record && customer?.id && (
        <InlineLiveAadhaarVerify
          customerId={customer.id}
          onDone={() => void load()}
        />
      )}

      {/* Uploaded documents */}
      <div className="rounded-md border border-ui-border-base p-4">
        <Heading level="h3" className="mb-2">
          Uploaded documents
        </Heading>
        {files.length === 0 ? (
          <Text size="small" className="text-ui-fg-subtle">
            No documents uploaded yet.
          </Text>
        ) : (
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {files.map((f, i) => (
              <a
                key={`${f.url}-${i}`}
                href={f.url}
                target="_blank"
                rel="noreferrer"
                className="flex items-center justify-between gap-2 rounded-md border border-ui-border-base px-3 py-2 hover:bg-ui-bg-base-hover"
              >
                <div className="min-w-0">
                  <Text size="small" weight="plus" className="truncate">
                    {f.kind}
                  </Text>
                  {f.label && (
                    <Text size="xsmall" className="truncate text-ui-fg-subtle">
                      {f.label}
                    </Text>
                  )}
                </div>
                <Eye className="shrink-0 text-ui-fg-subtle" />
              </a>
            ))}
          </div>
        )}
      </div>

      {/* Demat / CMR review — per-row approve/reject. Calls
          /admin/demat-accounts/:id/verify (same path Customer-360 uses)
          and reloads the detail packet on success so the row's pill
          state updates inline. Only rendered when pending demats
          exist for this customer. */}
      {pending_demats && pending_demats.length > 0 && (
        <div className="rounded-md border border-ui-border-base p-4">
          <Heading level="h3" className="mb-3">
            Demat / CMR review
          </Heading>
          <div className="flex flex-col gap-3">
            {pending_demats.map((d) => (
              <DematReviewCard
                key={d.id}
                demat={d}
                onDecided={async () => {
                  await load()
                  onDecided()
                }}
              />
            ))}
          </div>
        </div>
      )}

      {/* Bank review — same pattern as demat. */}
      {pending_banks && pending_banks.length > 0 && (
        <div className="rounded-md border border-ui-border-base p-4">
          <Heading level="h3" className="mb-3">
            Bank review
          </Heading>
          <div className="flex flex-col gap-3">
            {pending_banks.map((b) => (
              <BankReviewCard
                key={b.id}
                bank={b}
                onDecided={async () => {
                  await load()
                  onDecided()
                }}
              />
            ))}
          </div>
        </div>
      )}

      {/* Decision panel */}
      <div className="rounded-md border border-ui-border-base p-4">
        <Heading level="h3" className="mb-2">
          Decision
        </Heading>
        {pendingDecision ? (
          showActionRow ? (
            <div className="space-y-3">
              <Textarea
                value={decideReason}
                onChange={(e) => setDecideReason(e.target.value)}
                rows={2}
                placeholder="Reason — required for audit log (min 4 chars)"
              />
              {/* Already-verified status pills — replace the
                  corresponding approve button so admins can see what's
                  been done out-of-band without juggling tabs. */}
              {(panVerified || aadhaarVerified) && (
                <div className="flex flex-wrap gap-2 text-[12px]">
                  {panVerified && (
                    <StatusBadge color="green">PAN already verified</StatusBadge>
                  )}
                  {aadhaarVerified && (
                    <StatusBadge color="green">Aadhaar already verified</StatusBadge>
                  )}
                </div>
              )}
              <div className="flex flex-wrap gap-2">
                {!panVerified && !aadhaarVerified && (
                  <Button
                    size="small"
                    onClick={() => runAction("approve_both")}
                    isLoading={busyAction === "approve_both"}
                    disabled={busyAction !== null || decideReason.trim().length < 4}
                  >
                    Approve PAN + Aadhaar
                  </Button>
                )}
                {!panVerified && (
                  <Button
                    size="small"
                    variant="secondary"
                    onClick={() => runAction("approve_pan")}
                    isLoading={busyAction === "approve_pan"}
                    disabled={busyAction !== null || decideReason.trim().length < 4}
                  >
                    Approve PAN
                  </Button>
                )}
                {!aadhaarVerified && (
                  <Button
                    size="small"
                    variant="secondary"
                    onClick={() => runAction("approve_aadhaar")}
                    isLoading={busyAction === "approve_aadhaar"}
                    disabled={busyAction !== null || decideReason.trim().length < 4}
                  >
                    Approve Aadhaar
                  </Button>
                )}
                {/* Reject stays available when there are identity
                    blockers — admin may decide that PAN/Aadhaar do
                    NOT actually belong to this customer and want to
                    reject the queue item. */}
                <Button
                  size="small"
                  variant="danger"
                  onClick={() => runAction("reject")}
                  isLoading={busyAction === "reject"}
                  disabled={busyAction !== null || decideReason.trim().length < 4}
                >
                  {panVerified && aadhaarVerified ? "Reject queue" : "Reject both"}
                </Button>
              </div>
              {actionError && (
                <Text size="small" className="text-ui-fg-error">
                  {actionError}
                </Text>
              )}
              {actionSuccess && (
                <Text size="small" className="text-ui-fg-interactive">
                  {actionSuccess}
                </Text>
              )}
            </div>
          ) : (
            /* No actionable identity blockers. Don't render Approve /
               Reject buttons — they'd write spurious audit rows for
               actions the admin doesn't actually need to take. Bank /
               demat actions (if any) live on their own pages and use
               their own endpoints. The row will auto-close on the
               next KYC milestone (server-side hook). */
            <div className="rounded-md bg-ui-bg-subtle p-3">
              <Text size="small" className="text-ui-fg-subtle">
                No PAN/Aadhaar action needed on this row. If a bank or
                demat verification is pending for this customer, use
                the Bank / Demat tabs in the page header. Otherwise
                this row is informational — it will close automatically
                when the customer's KYC reconciles.
              </Text>
            </div>
          )
        ) : (
          <KvGrid
            rows={[
              ["Status", request.status],
              ["Decided at", formatDate(request.reviewed_at)],
              ["Reviewer", request.reviewer_notes ?? "—"],
            ]}
          />
        )}
      </div>
    </div>
  )
}

/**
 * Inline live-verify panel for PAN. Renders when a queue row is pending
 * AND the customer's `pan_record` is null (i.e. no Cashfree call has
 * ever succeeded for this PAN). Lets the admin run a Cashfree live-verify
 * on the customer's behalf — useful when the customer can't reach the
 * Cashfree flow themselves but you have their PAN + name (e.g. via
 * support email).
 *
 * On success, `pan_record` is upserted in the global registry, the
 * audit row carries the typed name, and (if the score clears 0.80) the
 * customer's metadata.pan_hash is set + the queue row auto-closes.
 * Calls /admin/customers/:id/kyc/live-verify with `kind: "pan"`.
 *
 * Burns one Cashfree credit per submission, so we require an audit
 * reason just like the approve/reject path.
 */
const InlineLivePanVerify: React.FC<{
  customerId: string
  onDone: () => void
}> = ({ customerId, onDone }) => {
  const [pan, setPan] = useState("")
  const [name, setName] = useState("")
  const [reason, setReason] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)

  const submit = async () => {
    setError(null)
    setSuccess(null)
    const panCleaned = pan.trim().toUpperCase()
    // Loose client-side check — server applies the strict regex
    // (4th-char entity-type alphabet); we just catch obvious typos
    // before burning a Cashfree call.
    if (!/^[A-Z]{5}[0-9]{4}[A-Z]$/.test(panCleaned)) {
      setError(
        "PAN must be 10 characters: 5 letters + 4 digits + 1 letter (e.g. ABCDE1234F).",
      )
      return
    }
    if (name.trim().length < 2) {
      setError("Enter the customer's full name as it appears on their PAN.")
      return
    }
    if (reason.trim().length < 4) {
      setError("Reason is required (min 4 chars) for the audit log.")
      return
    }
    setBusy(true)
    try {
      const res = await adminFetch<{ ok: boolean; message?: string }>(
        `/admin/customers/${customerId}/kyc/live-verify`,
        {
          method: "POST",
          body: JSON.stringify({
            kind: "pan",
            pan: panCleaned,
            name: name.trim(),
            reason: reason.trim(),
          }),
        },
      )
      if (res.ok) {
        setSuccess(
          "Verified — registry populated. If the name-match cleared 0.80, the customer's PAN is now verified and the queue row auto-closes. If it didn't, the row stays pending with the new data for you to review.",
        )
        setPan("")
        setName("")
        setReason("")
        onDone()
      } else {
        setError(
          res.message ??
            "Verification failed. Check the registry section after refresh — Cashfree's response may have populated pan_record even on a name-mismatch.",
        )
        onDone()
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Verification failed")
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="mt-3 rounded-md border border-dashed border-ui-border-base p-3">
      <Text size="xsmall" weight="plus" className="text-ui-fg-subtle">
        Live PAN verify — calls Cashfree on the customer's behalf
      </Text>
      <Text size="xsmall" className="mt-0.5 mb-2 text-ui-fg-muted">
        Use when the customer can't reach the storefront flow but you have
        their PAN + name (support email, in-person). Burns one Cashfree
        credit. Upserts the global pan_record so the registry section
        above will populate on the next refresh.
      </Text>
      <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
        <Input
          placeholder="ABCDE1234F"
          value={pan}
          onChange={(e) => setPan(e.target.value.toUpperCase())}
          disabled={busy}
          aria-label="Customer's PAN"
        />
        <Input
          placeholder="Name as on PAN"
          value={name}
          onChange={(e) => setName(e.target.value)}
          disabled={busy}
          aria-label="Customer's full name as on PAN"
        />
      </div>
      <Input
        className="mt-2"
        placeholder="Audit reason (min 4 chars)"
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        disabled={busy}
        aria-label="Audit reason"
      />
      <div className="mt-2 flex items-center gap-2">
        <Button size="small" onClick={submit} disabled={busy} isLoading={busy}>
          Run live PAN verify
        </Button>
        {error && (
          <Text size="xsmall" className="text-ui-fg-error">
            {error}
          </Text>
        )}
        {success && (
          <Text size="xsmall" className="text-ui-fg-interactive">
            {success}
          </Text>
        )}
      </div>
    </div>
  )
}

/**
 * Inline live-verify panel for Aadhaar. Two-step OTP flow:
 *   1. Admin enters Aadhaar → `aadhaar_otp_send` → OTP delivered to the
 *      customer's UIDAI-linked phone → admin shares the ref_id locally.
 *   2. Customer reads the OTP back to the admin → admin types it →
 *      `aadhaar_otp_verify` → aadhaar_record upserted; if cross-doc
 *      match against PAN clears 0.80, aadhaar_hash is set + queue
 *      auto-closes.
 * Calls the same /admin/customers/:id/kyc/live-verify endpoint with
 * `kind: "aadhaar_otp_send"` and `kind: "aadhaar_otp_verify"`.
 */
const InlineLiveAadhaarVerify: React.FC<{
  customerId: string
  onDone: () => void
}> = ({ customerId, onDone }) => {
  const [aadhaar, setAadhaar] = useState("")
  const [refId, setRefId] = useState<string | null>(null)
  const [otp, setOtp] = useState("")
  const [reason, setReason] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)

  const sendOtp = async () => {
    setError(null)
    setSuccess(null)
    const aadhaarCleaned = aadhaar.replace(/\s+/g, "")
    if (!/^\d{12}$/.test(aadhaarCleaned)) {
      setError("Aadhaar must be exactly 12 digits.")
      return
    }
    if (reason.trim().length < 4) {
      setError("Reason is required (min 4 chars) for the audit log.")
      return
    }
    setBusy(true)
    try {
      const res = await adminFetch<{
        ok: boolean
        message?: string
        ref_id?: string
      }>(`/admin/customers/${customerId}/kyc/live-verify`, {
        method: "POST",
        body: JSON.stringify({
          kind: "aadhaar_otp_send",
          aadhaar: aadhaarCleaned,
          reason: reason.trim(),
        }),
      })
      if (res.ok && res.ref_id) {
        setRefId(res.ref_id)
        setSuccess(
          `OTP sent to the customer's UIDAI-linked phone. Coordinate with the customer to read the OTP back; enter it below + click Verify.`,
        )
      } else {
        setError(res.message ?? "Failed to send OTP")
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to send OTP")
    } finally {
      setBusy(false)
    }
  }

  const verifyOtp = async () => {
    setError(null)
    setSuccess(null)
    if (!refId) {
      setError("No active OTP session — click 'Send OTP' first.")
      return
    }
    const otpCleaned = otp.replace(/\s+/g, "")
    if (!/^\d{4,8}$/.test(otpCleaned)) {
      setError("OTP must be 4–8 digits.")
      return
    }
    if (reason.trim().length < 4) {
      setError("Reason is required (min 4 chars) for the audit log.")
      return
    }
    setBusy(true)
    try {
      const res = await adminFetch<{ ok: boolean; message?: string }>(
        `/admin/customers/${customerId}/kyc/live-verify`,
        {
          method: "POST",
          body: JSON.stringify({
            kind: "aadhaar_otp_verify",
            ref_id: refId,
            otp: otpCleaned,
            reason: reason.trim(),
          }),
        },
      )
      if (res.ok) {
        setSuccess(
          "Verified — aadhaar_record populated. Queue row auto-closes if cross-doc match against PAN clears 0.80.",
        )
        setAadhaar("")
        setOtp("")
        setRefId(null)
        setReason("")
        onDone()
      } else {
        setError(res.message ?? "OTP verification failed")
        onDone()
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "OTP verification failed")
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="mt-3 rounded-md border border-dashed border-ui-border-base p-3">
      <Text size="xsmall" weight="plus" className="text-ui-fg-subtle">
        Live Aadhaar verify — calls Cashfree on the customer's behalf
      </Text>
      <Text size="xsmall" className="mt-0.5 mb-2 text-ui-fg-muted">
        Two-step: send an OTP to the customer's UIDAI-linked phone (not
        their Polemarch-registered phone) → coordinate with the customer
        to read the OTP back → verify. Burns one Cashfree credit per
        step. Upserts the global aadhaar_record.
      </Text>
      <Input
        placeholder="12-digit Aadhaar number"
        value={aadhaar}
        onChange={(e) => setAadhaar(e.target.value)}
        disabled={busy || refId !== null}
        aria-label="Customer's Aadhaar number"
      />
      <Input
        className="mt-2"
        placeholder="Audit reason (min 4 chars) — applies to both send + verify"
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        disabled={busy}
        aria-label="Audit reason"
      />
      <div className="mt-2 flex items-center gap-2">
        <Button
          size="small"
          onClick={sendOtp}
          disabled={busy || refId !== null}
          isLoading={busy && !refId}
        >
          Send OTP
        </Button>
        {refId && (
          <Text size="xsmall" className="text-ui-fg-subtle">
            ref: {refId.slice(0, 8)}…
          </Text>
        )}
      </div>
      {refId && (
        <div className="mt-2 flex items-center gap-2">
          <Input
            placeholder="OTP (4–8 digits)"
            value={otp}
            onChange={(e) => setOtp(e.target.value)}
            disabled={busy}
            aria-label="OTP received by the customer"
            className="max-w-[200px]"
          />
          <Button
            size="small"
            variant="secondary"
            onClick={verifyOtp}
            disabled={busy}
            isLoading={busy}
          >
            Verify OTP
          </Button>
        </div>
      )}
      {error && (
        <Text size="xsmall" className="mt-2 text-ui-fg-error">
          {error}
        </Text>
      )}
      {success && (
        <Text size="xsmall" className="mt-2 text-ui-fg-interactive">
          {success}
        </Text>
      )}
    </div>
  )
}

/**
 * Mask a BOID / DP-ID · Client-ID identifier to the "first 4 + last 4"
 * convention (e.g. `1208****00012345`). For short identifiers (<= 8
 * chars) where masking would hide everything, returns the value as-is.
 *
 * Mirrors the maskPan / maskAadhaar conventions on the backend — same
 * first-N-last-N pattern, just driven client-side because the demat
 * model stores the BOID in plaintext (no `boid_masked` column).
 */
function maskBoid(value: string | null | undefined): string {
  if (!value) return "—"
  const v = String(value).trim()
  if (v.length <= 8) return v
  const head = v.slice(0, 4)
  const tail = v.slice(-4)
  const stars = "*".repeat(Math.max(4, v.length - 8))
  return `${head}${stars}${tail}`
}

/**
 * Inline reveal-toggle for sensitive identifiers (PAN, Aadhaar,
 * BOID, bank account). Shows the masked form by default with an
 * eye-button that flips to the unmasked value on click.
 *
 * `unmasked` may be null (registry not resolved / not yet stored);
 * in that case the toggle is hidden and only the masked value
 * renders. No server round-trip on click — the unmasked value is
 * shipped down with the page payload and the toggle is purely a UI
 * affordance, matching the pattern in /app/pan-records and
 * /app/bank-records.
 */
function RevealableValue({
  masked,
  unmasked,
  mono = true,
}: {
  masked: string
  unmasked: string | null | undefined
  mono?: boolean
}) {
  const [revealed, setRevealed] = useState(false)
  const canReveal = typeof unmasked === "string" && unmasked.length > 0
  const display = revealed && canReveal ? (unmasked as string) : masked
  return (
    <span className="inline-flex items-center gap-2">
      <span className={mono ? "font-mono" : ""}>{display}</span>
      {canReveal && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation()
            setRevealed((r) => !r)
          }}
          className="text-ui-fg-subtle transition-colors hover:text-ui-fg-base"
          title={revealed ? "Hide" : "Reveal"}
          aria-label={revealed ? "Hide value" : "Reveal value"}
        >
          {revealed ? (
            <EyeSlash className="h-4 w-4" />
          ) : (
            <Eye className="h-4 w-4" />
          )}
        </button>
      )}
    </span>
  )
}

const DiagSection: React.FC<{
  title: string
  submitted: React.ReactNode
  registry: React.ReactNode
}> = ({ title, submitted, registry }) => (
  <div className="rounded-md border border-ui-border-base p-4">
    <Heading level="h3" className="mb-3">
      {title}
    </Heading>
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
      <div>
        <Text size="xsmall" weight="plus" className="mb-1 block text-ui-fg-subtle">
          Submitted by user
        </Text>
        {submitted ?? (
          <Text size="small" className="text-ui-fg-subtle">
            No submission on file.
          </Text>
        )}
      </div>
      <div>
        <Text size="xsmall" weight="plus" className="mb-1 block text-ui-fg-subtle">
          Registry record
        </Text>
        {registry ?? (
          <Text size="small" className="text-ui-fg-subtle">
            Not in registry.
          </Text>
        )}
      </div>
    </div>
  </div>
)

const KvGrid: React.FC<{
  rows: Array<[string, React.ReactNode] | [string, React.ReactNode, string]>
}> = ({ rows }) => (
  <dl className="grid grid-cols-[max-content_1fr] gap-x-3 gap-y-1 text-[13px]">
    {rows.map(([k, v, badgeText], i) => (
      <React.Fragment key={`${k}-${i}`}>
        <dt className="text-ui-fg-subtle">{k}</dt>
        <dd className="flex items-center gap-2 break-all">
          <span>{v}</span>
          {badgeText ? (
            <Badge size="2xsmall" color="green">
              {badgeText}
            </Badge>
          ) : null}
        </dd>
      </React.Fragment>
    ))}
  </dl>
)

function scoreCell(score: number | null | undefined): string {
  if (score === null || score === undefined) return "—"
  return score.toFixed(2)
}

function mismatchHintLabel(hint: string): string {
  switch (hint) {
    case "initials_in_submitted":
      return "Submitted used an initial (PAN has full name)"
    case "submitted_too_short":
      return "Submitted has fewer parts than PAN"
    case "no_obvious_pattern":
      return "No obvious pattern"
    default:
      return hint
  }
}

/**
 * Inline reviewer card for one pending demat row. Shows the BOID /
 * DP-ID / Client-ID, holder name, depository, opens the CMR PDF in
 * a new tab, and exposes Approve / Reject buttons that POST to
 * /admin/demat-accounts/:id/verify.
 */
const DematReviewCard: React.FC<{
  demat: NonNullable<ManualKycDetail["pending_demats"]>[number]
  onDecided: () => Promise<void> | void
}> = ({ demat, onDecided }) => {
  const [reason, setReason] = useState("")
  const [makePrimary, setMakePrimary] = useState<boolean>(!!demat.is_primary)
  const [busy, setBusy] = useState<"approved" | "rejected" | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)

  const decide = async (decision: "approved" | "rejected") => {
    if (reason.trim().length < 4) {
      setError("Reason is required (min 4 chars).")
      return
    }
    setBusy(decision)
    setError(null)
    setSuccess(null)
    try {
      await adminFetch(`/admin/demat-accounts/${demat.id}/verify`, {
        method: "POST",
        body: JSON.stringify({
          decision,
          reason: reason.trim(),
          make_primary: decision === "approved" ? makePrimary : false,
        }),
      })
      setSuccess(decision === "approved" ? "Demat approved." : "Demat rejected.")
      setReason("")
      await onDecided()
    } catch (e) {
      setError(e instanceof Error ? e.message : "Action failed")
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="rounded-md border border-ui-border-base p-3">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Text size="small" weight="plus">
            {demat.dp_name}
          </Text>
          <StatusBadge color="orange">{demat.depository}</StatusBadge>
          <StatusBadge color={badgeColor(demat.verification_status)}>
            {demat.verification_status}
          </StatusBadge>
          {demat.is_primary && (
            <Badge size="2xsmall" color="blue">
              primary
            </Badge>
          )}
        </div>
        {demat.cmr_file_url && (
          <a
            href={demat.cmr_file_url}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 text-[12px] text-ui-fg-interactive hover:underline"
          >
            <Eye /> Open CMR PDF
          </a>
        )}
      </div>
      <KvGrid
        rows={[
          ["Holder name (typed)", demat.account_holder_name || "—"],
          [
            "BOID / DP+Client",
            (() => {
              // CDSL stores the 16-digit BOID; NSDL splits into
              // DP-ID + Client-ID. Apply the same first-4 + last-4
              // mask convention to either form so the admin sees a
              // recognisable prefix without the full number exposed
              // by default. The eye-toggle reveals the unmasked
              // value on click; same UI as PAN / Aadhaar /
              // bank-account in this panel.
              const unmasked =
                demat.depository === "CDSL"
                  ? (demat.boid ?? "")
                  : `${demat.dp_id ?? ""} · ${demat.client_id ?? ""}`
              if (!unmasked.trim() || unmasked === " · ") return "—"
              return (
                <RevealableValue
                  masked={maskBoid(unmasked)}
                  unmasked={unmasked}
                />
              )
            })(),
          ],
          ["Submitted at", formatDate(demat.created_at)],
        ]}
      />
      <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-end">
        <Textarea
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          rows={2}
          placeholder="Reason — required for audit log (min 4 chars)"
        />
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-3">
        <label className="flex items-center gap-2 text-[12px] text-ui-fg-subtle">
          <input
            type="checkbox"
            checked={makePrimary}
            onChange={(e) => setMakePrimary(e.target.checked)}
          />
          Make primary on approve
        </label>
        <div className="ml-auto flex gap-2">
          <Button
            size="small"
            onClick={() => decide("approved")}
            isLoading={busy === "approved"}
            disabled={busy !== null || reason.trim().length < 4}
          >
            Approve CMR
          </Button>
          <Button
            size="small"
            variant="danger"
            onClick={() => decide("rejected")}
            isLoading={busy === "rejected"}
            disabled={busy !== null || reason.trim().length < 4}
          >
            Reject
          </Button>
        </div>
      </div>
      {error && (
        <Text size="small" className="mt-2 text-ui-fg-error">
          {error}
        </Text>
      )}
      {success && (
        <Text size="small" className="mt-2 text-ui-fg-interactive">
          {success}
        </Text>
      )}
    </div>
  )
}

/**
 * Inline reviewer card for one pending bank row. Same shape as the
 * demat card; calls /admin/bank-accounts/:id/verify.
 */
const BankReviewCard: React.FC<{
  bank: NonNullable<ManualKycDetail["pending_banks"]>[number]
  onDecided: () => Promise<void> | void
}> = ({ bank, onDecided }) => {
  const [reason, setReason] = useState("")
  const [busy, setBusy] = useState<"approved" | "rejected" | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)

  const decide = async (decision: "approved" | "rejected") => {
    if (reason.trim().length < 4) {
      setError("Reason is required (min 4 chars).")
      return
    }
    setBusy(decision)
    setError(null)
    setSuccess(null)
    try {
      await adminFetch(`/admin/bank-accounts/${bank.id}/verify`, {
        method: "POST",
        body: JSON.stringify({ decision, reason: reason.trim() }),
      })
      setSuccess(decision === "approved" ? "Bank approved." : "Bank rejected.")
      setReason("")
      await onDecided()
    } catch (e) {
      setError(e instanceof Error ? e.message : "Action failed")
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="rounded-md border border-ui-border-base p-3">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Text size="small" weight="plus">
            {bank.bank_name ?? "Bank"} ·{" "}
          </Text>
          <RevealableValue
            mono={false}
            masked={`…${bank.account_number_last4}`}
            unmasked={bank.account_number_full ?? null}
          />
          <StatusBadge color={badgeColor(bank.verification_status)}>
            {bank.verification_status}
          </StatusBadge>
          {bank.is_primary && (
            <Badge size="2xsmall" color="blue">
              primary
            </Badge>
          )}
        </div>
        {bank.bank_proof_file_url && (
          <a
            href={bank.bank_proof_file_url}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 text-[12px] text-ui-fg-interactive hover:underline"
          >
            <Eye /> Open bank proof
          </a>
        )}
      </div>
      <KvGrid
        rows={[
          ["Holder (typed)", bank.account_holder_name || "—"],
          ["Name at bank", bank.name_at_bank ?? "—"],
          [
            "Match score",
            bank.name_match_score != null
              ? bank.name_match_score.toFixed(2)
              : "—",
          ],
          ["IFSC", bank.ifsc],
          ["Submitted at", formatDate(bank.created_at)],
        ]}
      />
      <div className="mt-3">
        <Textarea
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          rows={2}
          placeholder="Reason — required for audit log (min 4 chars)"
        />
      </div>
      <div className="mt-2 flex justify-end gap-2">
        <Button
          size="small"
          onClick={() => decide("approved")}
          isLoading={busy === "approved"}
          disabled={busy !== null || reason.trim().length < 4}
        >
          Approve bank
        </Button>
        <Button
          size="small"
          variant="danger"
          onClick={() => decide("rejected")}
          isLoading={busy === "rejected"}
          disabled={busy !== null || reason.trim().length < 4}
        >
          Reject
        </Button>
      </div>
      {error && (
        <Text size="small" className="mt-2 text-ui-fg-error">
          {error}
        </Text>
      )}
      {success && (
        <Text size="small" className="mt-2 text-ui-fg-interactive">
          {success}
        </Text>
      )}
    </div>
  )
}

export const config = defineRouteConfig({
  label: "KYC",
  icon: ShieldCheck,
})

export default ManualKycPage
