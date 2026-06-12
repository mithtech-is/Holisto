import { useEffect, useMemo, useState } from "react"
import {
  Button,
  Container,
  Drawer,
  Heading,
  Input,
  Label,
  Select,
  StatusBadge,
  Switch,
  Table,
  Text,
  Textarea,
} from "@medusajs/ui"
import { Eye, EyeSlash } from "@medusajs/icons"
import { adminFetch, statusBadgeColor } from "../helpers"

/**
 * Bank-account reveal toggle. The full account number is stored
 * AES-256-GCM encrypted on `bank_account.account_number_encrypted`;
 * this component fetches `/admin/bank-accounts/:id/reveal` on
 * click, which decrypts + audit-logs the access. Default state
 * shows `…last4 · IFSC`; reveal flips to the full number. Persists
 * across re-renders via component state, NOT URL — refresh the
 * page to re-mask.
 */
function BankRevealToggle({
  id,
  last4,
  ifsc,
}: {
  id: string
  last4: string
  ifsc: string
}) {
  const [revealed, setRevealed] = useState(false)
  const [full, setFull] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const click = async (e: React.MouseEvent) => {
    e.stopPropagation()
    if (busy) return
    if (revealed) {
      setRevealed(false)
      return
    }
    if (full) {
      setRevealed(true)
      return
    }
    setBusy(true)
    setErr(null)
    try {
      const r = await adminFetch<{ account_number: string }>(
        `/admin/bank-accounts/${id}/reveal`,
        { method: "POST" },
      )
      setFull(r.account_number)
      setRevealed(true)
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Failed to reveal")
    } finally {
      setBusy(false)
    }
  }
  return (
    <span className="inline-flex items-center gap-2">
      <span>
        {revealed && full ? full : `…${last4}`} · {ifsc}
      </span>
      <button
        type="button"
        onClick={click}
        disabled={busy}
        className="text-ui-fg-subtle hover:text-ui-fg-base transition-colors disabled:opacity-40"
        title={revealed ? "Hide" : "Reveal"}
        aria-label={revealed ? "Hide account number" : "Reveal account number"}
      >
        {revealed ? (
          <EyeSlash className="h-4 w-4" />
        ) : (
          <Eye className="h-4 w-4" />
        )}
      </button>
      {err && (
        <Text size="xsmall" className="text-ui-fg-error">
          {err}
        </Text>
      )}
    </span>
  )
}

type Props = { customerId: string }

type BankAccount = {
  id: string
  customer_id: string
  account_holder_name: string
  account_number_last4: string
  ifsc: string
  bank_name: string | null
  verification_status: string
  is_primary: boolean
  bank_proof_file_url: string | null
  bank_proof_type: string | null
  created_at: string
}

type DematAccount = {
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

/* Verification-status options kept in sync with the admin PATCH zod
 * schemas — if the backend adds a new status, add it here too. */
const STATUS_OPTIONS = [
  { value: "pending", label: "Pending" },
  { value: "verified", label: "Verified" },
  { value: "failed", label: "Failed" },
  { value: "name_mismatch", label: "Name mismatch" },
] as const

const BANK_PROOF_TYPE_OPTIONS = [
  { value: "cheque", label: "Cheque" },
  { value: "passbook", label: "Passbook" },
  { value: "statement", label: "Statement" },
] as const

const DEPOSITORY_OPTIONS = [
  { value: "NSDL", label: "NSDL" },
  { value: "CDSL", label: "CDSL" },
] as const

/* Form shapes kept narrow — we only surface fields the PATCH endpoints
 * accept. Account number / IFSC are intentionally NOT editable from
 * this dialog: changing them has to force a re-verification flow, so
 * the customer re-submits via `/store/bank-accounts` instead. */
type BankEditForm = {
  account_holder_name: string
  bank_name: string
  verification_status: string
  bank_proof_type: string // empty string = leave as-is
  is_primary: boolean
  reason: string
}

type DematEditForm = {
  account_holder_name: string
  depository: string
  dp_name: string
  dp_id: string
  client_id: string
  boid: string
  verification_status: string
  is_primary: boolean
  reason: string
}

/* Admin-manual create forms — POST routes accept these fields. The
 * create flow doesn't run penny-drop / CMR verification, so the
 * account_number (bank) / identifiers (demat) are the full values. */
type BankCreateForm = {
  account_number: string
  ifsc: string
  account_holder_name: string
  bank_name: string
  verification_status: string
  is_primary: boolean
  reason: string
}

type DematCreateForm = {
  depository: "NSDL" | "CDSL"
  dp_name: string
  dp_id: string
  client_id: string
  boid: string
  account_holder_name: string
  verification_status: string
  is_primary: boolean
  reason: string
}

/** Single VBA row as returned by /admin/customers/:id/virtual-account. */
type VirtualAccount = {
  id: string
  virtual_account_id: string
  virtual_account_number: string
  ifsc: string
  upi_id: string | null
  bank_code: string | null
  beneficiary_name_display: string | null
  cashfree_account_holder_name: string | null
  status: "active" | "closed"
  bank_account_id: string | null
  created_at: string
  updated_at: string
}

export default function AccountsTab({ customerId }: Props) {
  const [banks, setBanks] = useState<BankAccount[]>([])
  const [demats, setDemats] = useState<DematAccount[]>([])
  const [vbas, setVbas] = useState<VirtualAccount[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [provisionBusy, setProvisionBusy] = useState(false)
  const [provisionMsg, setProvisionMsg] = useState<{
    tone: "ok" | "err"
    text: string
  } | null>(null)
  const [syncBusy, setSyncBusy] = useState(false)
  const [syncMsg, setSyncMsg] = useState<{
    tone: "ok" | "err"
    text: string
  } | null>(null)

  /* Edit drawers. Null = closed. We keep the source row so the drawer
   * can show "editing A/C …1234" and so we can diff on save. */
  const [editBank, setEditBank] = useState<BankAccount | null>(null)
  const [editDemat, setEditDemat] = useState<DematAccount | null>(null)

  /* Add (manual-create) drawers — driven by a boolean, no source row. */
  const [addBankOpen, setAddBankOpen] = useState(false)
  const [addDematOpen, setAddDematOpen] = useState(false)

  const load = async () => {
    setLoading(true)
    try {
      const [b, d, v] = await Promise.all([
        adminFetch<{ bank_accounts: BankAccount[] }>(
          `/admin/bank-accounts?customer_id=${customerId}`
        ),
        adminFetch<{ demat_accounts: DematAccount[] }>(
          `/admin/demat-accounts?customer_id=${customerId}`
        ),
        adminFetch<{ virtual_accounts: VirtualAccount[] }>(
          `/admin/customers/${customerId}/virtual-account`
        ).catch(() => ({ virtual_accounts: [] as VirtualAccount[] })),
      ])
      setBanks(b.bank_accounts ?? [])
      setDemats(d.demat_accounts ?? [])
      setVbas(v.virtual_accounts ?? [])
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed")
    } finally {
      setLoading(false)
    }
  }

  /** Operator-triggered VBA mint via /admin/customers/:id/provision-vba.
   *  Idempotent server-side — clicking when an active VBA exists is a
   *  no-op return of the existing row. The button below is only shown
   *  when no active VBA exists. */
  const provisionVba = async () => {
    setProvisionBusy(true)
    setProvisionMsg(null)
    try {
      await adminFetch(`/admin/customers/${customerId}/provision-vba`, {
        method: "POST",
      })
      setProvisionMsg({ tone: "ok", text: "VBA provisioned." })
      await load()
    } catch (e) {
      setProvisionMsg({
        tone: "err",
        text: e instanceof Error ? e.message : "Provision failed",
      })
    } finally {
      setProvisionBusy(false)
    }
  }

  /** Operator-triggered deposit recheck via
   *  /admin/customers/:id/sync-wallet. Pulls the last 24h of SUCCESS
   *  payments to the customer's VBA from Cashfree and credits any we
   *  haven't already booked. Used when a customer reports "I sent ₹X
   *  but the wallet still shows ₹0" — typical cause is the Cashfree
   *  webhook didn't fire (transient, signing-secret unset, our
   *  server down). Same idempotency as the webhook + storefront
   *  routes (event_id keying), so a reckless click is harmless. */
  const syncWallet = async () => {
    setSyncBusy(true)
    setSyncMsg(null)
    try {
      const r = await adminFetch<{
        new_credits: Array<{ amount_inr: number; utr: string | null }>
        duplicates: number
        tpv_failures: number
      }>(`/admin/customers/${customerId}/sync-wallet`, {
        method: "POST",
      })
      const credited = r.new_credits.length
      if (credited > 0) {
        const totalRupees = Math.round(
          r.new_credits.reduce((sum, c) => sum + c.amount_inr, 0) / 100,
        )
        setSyncMsg({
          tone: "ok",
          text: `Credited ₹${totalRupees.toLocaleString("en-IN")} across ${credited} new deposit${credited === 1 ? "" : "s"}.${
            r.tpv_failures > 0
              ? ` (${r.tpv_failures} payment${r.tpv_failures === 1 ? "" : "s"} from non-verified bank — flagged.)`
              : ""
          }`,
        })
      } else {
        setSyncMsg({
          tone: "ok",
          text:
            r.duplicates > 0
              ? `Already up to date (${r.duplicates} payment${r.duplicates === 1 ? "" : "s"} in last 24h, all already credited).`
              : "Already up to date — no new deposits in the last 24h.",
        })
      }
      await load()
    } catch (e) {
      setSyncMsg({
        tone: "err",
        text: e instanceof Error ? e.message : "Sync failed",
      })
    } finally {
      setSyncBusy(false)
    }
  }

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [customerId])

  /**
   * Broadcast a "kyc-inputs-changed" event on the window so any other
   * tab in this Customer 360 page (currently just KycTab) can refresh
   * its derived status badges. The KYC tab's `has_verified_bank` /
   * `has_primary_demat` pills are computed from bank + demat rows, so
   * every verify / reject / delete here is a potential KYC flip.
   *
   * Radix Tabs unmounts inactive tabs, so in practice the KycTab's
   * own useEffect([customerId]) re-runs on re-mount — but firing this
   * event also fixes the edge case where an admin keeps both tabs in
   * two browser windows.
   */
  const notifyKycChanged = () => {
    if (typeof window === "undefined") return
    window.dispatchEvent(
      new CustomEvent("polemarch:kyc-inputs-changed", {
        detail: { customerId },
      }),
    )
  }

  // Decision strings match the backend Zod schema in
  // /admin/bank-accounts/:id/verify and /admin/demat-accounts/:id/verify
  // — both expect "approved" / "rejected" (past tense). This used to send
  // "approve" / "reject", which 400-ed every Manual verify click with a
  // generic Zod "Invalid input" surfaced through alert(). Fixed 2026-05-07.
  const verifyBank = async (
    id: string,
    decision: "approved" | "rejected",
  ) => {
    const reason = prompt(`Reason for ${decision}?`)
    if (!reason || reason.trim().length < 4) return
    setBusy(id)
    try {
      await adminFetch(`/admin/bank-accounts/${id}/verify`, {
        method: "POST",
        body: JSON.stringify({ decision, reason }),
      })
      await load()
      notifyKycChanged()
    } catch (e) {
      alert(e instanceof Error ? e.message : "Verify failed")
    } finally {
      setBusy(null)
    }
  }

  const deleteBank = async (id: string) => {
    if (!confirm("Delete this bank account? This cannot be undone.")) return
    setBusy(id)
    try {
      await adminFetch(`/admin/bank-accounts/${id}`, { method: "DELETE" })
      await load()
      notifyKycChanged()
    } catch (e) {
      alert(e instanceof Error ? e.message : "Delete failed")
    } finally {
      setBusy(null)
    }
  }

  const verifyDemat = async (
    id: string,
    decision: "approved" | "rejected",
  ) => {
    const reason = prompt(`Reason for ${decision}?`)
    if (!reason || reason.trim().length < 4) return
    setBusy(id)
    try {
      await adminFetch(`/admin/demat-accounts/${id}/verify`, {
        method: "POST",
        body: JSON.stringify({ decision, reason }),
      })
      await load()
      notifyKycChanged()
    } catch (e) {
      alert(e instanceof Error ? e.message : "Verify failed")
    } finally {
      setBusy(null)
    }
  }

  /**
   * Run a LIVE Cashfree Secure ID check for a bank or demat row. This is
   * the programmatic counterpart to the "Verify" button above (which
   * just flips the status manually + writes an audit row). "Run live
   * check" actually hits Cashfree — penny-drop against the full stored
   * account number for banks, CMR extraction against the uploaded CMR
   * PDF for demats. The API endpoint writes its own `secure_id_verification`
   * row, the bank/demat row's `verification_status`, and an admin audit
   * log entry — so from the Accounts tab's perspective we just load()
   * and fire the cross-tab event.
   */
  const runLiveCheck = async (
    kind: "bank_penny" | "cmr",
    row_id: string,
    customer_of_row: string,
  ) => {
    const label = kind === "bank_penny" ? "penny-drop" : "CMR re-verification"
    const reason = prompt(
      `Reason for live ${label}? (min 4 chars, audit-logged, counts against admin rate limit)`,
    )
    if (!reason || reason.trim().length < 4) return
    setBusy(row_id)
    try {
      const body =
        kind === "bank_penny"
          ? { kind, bank_account_id: row_id, reason }
          : { kind, demat_account_id: row_id, reason }
      const res = await adminFetch<{
        ok: boolean
        message?: string
        result?: Record<string, unknown>
      }>(`/admin/customers/${customer_of_row}/kyc/live-verify`, {
        method: "POST",
        body: JSON.stringify(body),
      })
      if (!res.ok) {
        alert(res.message ?? `${label} failed — check the verification log.`)
      }
      await load()
      notifyKycChanged()
    } catch (e) {
      alert(e instanceof Error ? e.message : `${label} failed`)
    } finally {
      setBusy(null)
    }
  }

  const deleteDemat = async (id: string) => {
    if (!confirm("Delete this demat account? This cannot be undone.")) return
    setBusy(id)
    try {
      await adminFetch(`/admin/demat-accounts/${id}`, { method: "DELETE" })
      await load()
      notifyKycChanged()
    } catch (e) {
      alert(e instanceof Error ? e.message : "Delete failed")
    } finally {
      setBusy(null)
    }
  }

  if (loading) return <Text>Loading…</Text>
  if (error) return <Text className="text-ui-fg-error">{error}</Text>

  const activeVba = vbas.find((v) => v.status === "active") ?? null
  const closedVbas = vbas.filter((v) => v.status === "closed")
  const hasVerifiedBank = banks.some(
    (b) => b.verification_status === "verified",
  )

  return (
    <div className="flex flex-col gap-4">
      {/* Virtual Account section — shows the customer's Cashfree PG-VBA
        * (`/pg/vba`, x-api-version 2024-07-10). One per customer in the
        * per-customer model. Operators can mint a fresh one when no
        * active row exists (provided ≥1 verified bank). Closed rows
        * are listed below for audit; Cashfree-side they may still
        * exist (Cashfree has no VBA-delete API). */}
      <Container className="p-6">
        <div className="mb-3 flex items-center justify-between">
          <Heading level="h3">
            Virtual account
            {activeVba ? (
              <StatusBadge color="green" className="ml-2">
                active
              </StatusBadge>
            ) : (
              <StatusBadge color="grey" className="ml-2">
                none
              </StatusBadge>
            )}
          </Heading>
          <div className="flex items-center gap-2">
            {activeVba && (
              <Button
                size="small"
                variant="secondary"
                onClick={syncWallet}
                isLoading={syncBusy}
                disabled={syncBusy}
                title="Pull last 24h of payments from Cashfree and credit any we haven't already booked. Used for triage when a deposit isn't reflected (webhook failure)."
              >
                Recheck deposits
              </Button>
            )}
            {!activeVba && (
              <Button
                size="small"
                variant="primary"
                onClick={provisionVba}
                isLoading={provisionBusy}
                disabled={provisionBusy || !hasVerifiedBank}
                title={
                  !hasVerifiedBank
                    ? "Customer needs at least one verified bank to provision a VBA"
                    : undefined
                }
              >
                Provision VBA
              </Button>
            )}
          </div>
        </div>

        {provisionMsg && (
          <Text
            className={
              provisionMsg.tone === "ok"
                ? "text-ui-fg-interactive mb-2"
                : "text-ui-fg-error mb-2"
            }
          >
            {provisionMsg.text}
          </Text>
        )}
        {syncMsg && (
          <Text
            className={
              syncMsg.tone === "ok"
                ? "text-ui-fg-interactive mb-2"
                : "text-ui-fg-error mb-2"
            }
          >
            {syncMsg.text}
          </Text>
        )}

        {activeVba ? (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-sm">
            <Field
              label="Virtual account ID"
              value={activeVba.virtual_account_id}
              mono
            />
            <Field
              label="Virtual account number"
              value={activeVba.virtual_account_number}
              mono
            />
            <Field label="IFSC" value={activeVba.ifsc} mono />
            <Field label="Issuing bank code" value={activeVba.bank_code ?? "—"} />
            <Field
              label="Beneficiary (storefront-displayed)"
              value={activeVba.beneficiary_name_display ?? "—"}
            />
            <Field
              label="Account holder name (Cashfree dashboard)"
              value={activeVba.cashfree_account_holder_name ?? "—"}
            />
            <Field label="UPI handle" value={activeVba.upi_id ?? "—"} />
            <Field
              label="Created"
              value={
                activeVba.created_at
                  ? new Date(activeVba.created_at).toLocaleString("en-IN")
                  : "—"
              }
            />
          </div>
        ) : hasVerifiedBank ? (
          <Text className="text-ui-fg-muted">
            No active virtual account. Click Provision VBA above to mint one
            via Cashfree (uses the customer&apos;s `client_id` as
            `virtual_account_id` and pushes all currently-verified banks
            into `allowed_remitters`).
          </Text>
        ) : (
          <Text className="text-ui-fg-muted">
            Customer has no verified bank account yet. VBA can&apos;t be
            provisioned without one (allowed_remitters lock would be empty).
          </Text>
        )}

        {closedVbas.length > 0 && (
          <details className="mt-4 rounded-md border border-ui-border-base bg-ui-bg-subtle p-3">
            <summary className="cursor-pointer text-sm text-ui-fg-muted">
              Closed VBAs ({closedVbas.length})
            </summary>
            <div className="mt-2 flex flex-col gap-1 text-xs">
              {closedVbas.map((v) => (
                <Text
                  key={v.id}
                  className="font-mono text-ui-fg-subtle"
                >
                  {v.virtual_account_id} · {v.virtual_account_number} ·{" "}
                  {v.ifsc} · closed
                </Text>
              ))}
            </div>
          </details>
        )}
      </Container>

      <Container className="p-6">
        <div className="mb-3 flex items-center justify-between">
          <Heading level="h3">Bank accounts ({banks.length})</Heading>
          <Button
            size="small"
            variant="secondary"
            onClick={() => setAddBankOpen(true)}
          >
            Add bank
          </Button>
        </div>
        {banks.length === 0 ? (
          <Text className="text-ui-fg-muted">No bank accounts linked.</Text>
        ) : (
          <Table>
            <Table.Header>
              <Table.Row>
                <Table.HeaderCell>Holder / Bank</Table.HeaderCell>
                <Table.HeaderCell>A/C · IFSC</Table.HeaderCell>
                <Table.HeaderCell>Status</Table.HeaderCell>
                <Table.HeaderCell>Proof</Table.HeaderCell>
                <Table.HeaderCell>Actions</Table.HeaderCell>
              </Table.Row>
            </Table.Header>
            <Table.Body>
              {banks.map((b) => (
                <Table.Row key={b.id}>
                  <Table.Cell>
                    <div>
                      <Text className="font-medium">{b.account_holder_name}</Text>
                      <Text size="small" className="text-ui-fg-muted">
                        {b.bank_name ?? "—"}
                      </Text>
                    </div>
                  </Table.Cell>
                  <Table.Cell>
                    <Text size="small">
                      <BankRevealToggle
                        id={b.id}
                        last4={b.account_number_last4}
                        ifsc={b.ifsc}
                      />
                    </Text>
                  </Table.Cell>
                  <Table.Cell>
                    <div className="flex items-center gap-2">
                      <StatusBadge color={statusBadgeColor(b.verification_status)}>
                        {b.verification_status}
                      </StatusBadge>
                      {b.is_primary && (
                        <StatusBadge color="blue">primary</StatusBadge>
                      )}
                    </div>
                  </Table.Cell>
                  <Table.Cell>
                    {b.bank_proof_file_url ? (
                      <a
                        href={b.bank_proof_file_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-ui-fg-interactive underline text-sm"
                      >
                        {b.bank_proof_type ?? "file"}
                      </a>
                    ) : (
                      <Text size="small" className="text-ui-fg-muted">
                        —
                      </Text>
                    )}
                  </Table.Cell>
                  <Table.Cell>
                    <div className="flex flex-wrap gap-1">
                      <Button
                        size="small"
                        variant="secondary"
                        disabled={busy === b.id}
                        onClick={() => setEditBank(b)}
                      >
                        Edit
                      </Button>
                      {/* Live Cashfree penny-drop. Available on any
                        * status — ops sometimes wants to re-verify a
                        * previously-verified row (e.g. IFSC changed).
                        * The endpoint decrypts the stored full account
                        * number server-side. */}
                      <Button
                        size="small"
                        variant="primary"
                        disabled={busy === b.id}
                        onClick={() =>
                          runLiveCheck("bank_penny", b.id, b.customer_id)
                        }
                      >
                        Run penny-drop
                      </Button>
                      {/* Manual override: flip status without hitting
                        * Cashfree. Used when Secure ID is down, when
                        * ops has an offline proof, or when CID requires
                        * an override. Only enabled when not already
                        * verified. */}
                      <Button
                        size="small"
                        variant="secondary"
                        disabled={busy === b.id || b.verification_status === "verified"}
                        onClick={() => verifyBank(b.id, "approved")}
                      >
                        Manual verify
                      </Button>
                      <Button
                        size="small"
                        variant="danger"
                        disabled={busy === b.id}
                        onClick={() => deleteBank(b.id)}
                      >
                        Delete
                      </Button>
                    </div>
                  </Table.Cell>
                </Table.Row>
              ))}
            </Table.Body>
          </Table>
        )}
      </Container>

      <Container className="p-6">
        <div className="mb-3 flex items-center justify-between">
          <Heading level="h3">Demat accounts ({demats.length})</Heading>
          <Button
            size="small"
            variant="secondary"
            onClick={() => setAddDematOpen(true)}
          >
            Add demat
          </Button>
        </div>
        {demats.length === 0 ? (
          <Text className="text-ui-fg-muted">No demat accounts linked.</Text>
        ) : (
          <Table>
            <Table.Header>
              <Table.Row>
                <Table.HeaderCell>Holder / DP</Table.HeaderCell>
                <Table.HeaderCell>Depository · IDs</Table.HeaderCell>
                <Table.HeaderCell>Status</Table.HeaderCell>
                <Table.HeaderCell>CMR</Table.HeaderCell>
                <Table.HeaderCell>Actions</Table.HeaderCell>
              </Table.Row>
            </Table.Header>
            <Table.Body>
              {demats.map((d) => (
                <Table.Row key={d.id}>
                  <Table.Cell>
                    <div>
                      <Text className="font-medium">{d.account_holder_name}</Text>
                      <Text size="small" className="text-ui-fg-muted">
                        {d.dp_name}
                      </Text>
                    </div>
                  </Table.Cell>
                  <Table.Cell>
                    <Text size="small">
                      {d.depository}
                      {d.boid ? ` · BOID ${d.boid}` : ""}
                      {d.client_id ? ` · CID ${d.client_id}` : ""}
                    </Text>
                  </Table.Cell>
                  <Table.Cell>
                    <div className="flex items-center gap-2">
                      <StatusBadge color={statusBadgeColor(d.verification_status)}>
                        {d.verification_status}
                      </StatusBadge>
                      {d.is_primary && (
                        <StatusBadge color="blue">primary</StatusBadge>
                      )}
                    </div>
                  </Table.Cell>
                  <Table.Cell>
                    {d.cmr_file_url ? (
                      <a
                        href={d.cmr_file_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-ui-fg-interactive underline text-sm"
                      >
                        View
                      </a>
                    ) : (
                      <Text size="small" className="text-ui-fg-muted">
                        —
                      </Text>
                    )}
                  </Table.Cell>
                  <Table.Cell>
                    <div className="flex flex-wrap gap-1">
                      <Button
                        size="small"
                        variant="secondary"
                        disabled={busy === d.id}
                        onClick={() => setEditDemat(d)}
                      >
                        Edit
                      </Button>
                      {/* CMR / demat verification is now manual —
                        * Cashfree's CMR endpoint is no longer in our
                        * suite. Use the Approve / Reject buttons below
                        * (which call /admin/demat-accounts/:id/verify)
                        * to flip verification_status by hand after
                        * eyeballing the uploaded CMR PDF. */}
                      <Button
                        size="small"
                        variant="secondary"
                        disabled={busy === d.id || d.verification_status === "verified"}
                        onClick={() => verifyDemat(d.id, "approved")}
                      >
                        Manual verify
                      </Button>
                      <Button
                        size="small"
                        variant="danger"
                        disabled={busy === d.id}
                        onClick={() => deleteDemat(d.id)}
                      >
                        Delete
                      </Button>
                    </div>
                  </Table.Cell>
                </Table.Row>
              ))}
            </Table.Body>
          </Table>
        )}
      </Container>

      {/* Edit drawers — mounted once, driven by editBank / editDemat.
          Fire kyc-inputs-changed on save so the KYC tab picks up any
          verification-status flips (the Edit form can manually flip
          verification_status). */}
      <BankEditDrawer
        row={editBank}
        onClose={() => setEditBank(null)}
        onSaved={async () => {
          setEditBank(null)
          await load()
          notifyKycChanged()
        }}
      />
      <DematEditDrawer
        row={editDemat}
        onClose={() => setEditDemat(null)}
        onSaved={async () => {
          setEditDemat(null)
          await load()
          notifyKycChanged()
        }}
      />

      {/* Add drawers — manual create, no penny-drop / CMR call. New
          rows start as `pending` so they don't immediately flip KYC,
          but we still broadcast — the admin may add a row already
          marked `verified`. */}
      <BankAddDrawer
        open={addBankOpen}
        customerId={customerId}
        onClose={() => setAddBankOpen(false)}
        onSaved={async () => {
          setAddBankOpen(false)
          await load()
          notifyKycChanged()
        }}
      />
      <DematAddDrawer
        open={addDematOpen}
        customerId={customerId}
        onClose={() => setAddDematOpen(false)}
        onSaved={async () => {
          setAddDematOpen(false)
          await load()
          notifyKycChanged()
        }}
      />
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Bank Edit drawer                                                   */
/* ------------------------------------------------------------------ */

function BankEditDrawer({
  row,
  onClose,
  onSaved,
}: {
  row: BankAccount | null
  onClose: () => void
  onSaved: () => void | Promise<void>
}) {
  const [form, setForm] = useState<BankEditForm | null>(null)
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  /* When the caller opens the drawer with a different row, reset form
   * state from that row. Closing keeps the last form around but it's
   * hidden; re-opening will reset again. */
  useEffect(() => {
    if (!row) {
      setForm(null)
      setErr(null)
      return
    }
    setForm({
      account_holder_name: row.account_holder_name ?? "",
      bank_name: row.bank_name ?? "",
      verification_status: row.verification_status ?? "pending",
      bank_proof_type: row.bank_proof_type ?? "",
      is_primary: !!row.is_primary,
      reason: "",
    })
    setErr(null)
  }, [row?.id])

  const open = !!row && !!form
  const patch = useMemo(() => {
    if (!row || !form) return {}
    const p: Record<string, unknown> = {}
    if (form.account_holder_name.trim() !== (row.account_holder_name ?? ""))
      p.account_holder_name = form.account_holder_name.trim()
    if (form.bank_name.trim() !== (row.bank_name ?? ""))
      p.bank_name = form.bank_name.trim() || null
    if (form.verification_status !== row.verification_status)
      p.verification_status = form.verification_status
    if ((form.bank_proof_type || "") !== (row.bank_proof_type ?? ""))
      p.bank_proof_type = form.bank_proof_type || null
    if (form.is_primary !== !!row.is_primary) p.is_primary = form.is_primary
    return p
  }, [row, form])

  const hasChanges = Object.keys(patch).length > 0

  const save = async () => {
    if (!row || !form) return
    if (!hasChanges) {
      setErr("Nothing changed.")
      return
    }
    if (form.reason.trim().length < 4) {
      setErr("Reason must be at least 4 characters.")
      return
    }
    setSaving(true)
    setErr(null)
    try {
      await adminFetch(`/admin/bank-accounts/${row.id}`, {
        method: "PATCH",
        body: JSON.stringify({ ...patch, reason: form.reason.trim() }),
      })
      await onSaved()
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Save failed")
    } finally {
      setSaving(false)
    }
  }

  return (
    <Drawer open={open} onOpenChange={(v) => !v && onClose()}>
      <Drawer.Content>
        <Drawer.Header>
          <Drawer.Title>Edit bank account</Drawer.Title>
          {row && (
            <Drawer.Description>
              …{row.account_number_last4} · {row.ifsc}
            </Drawer.Description>
          )}
        </Drawer.Header>
        <Drawer.Body className="flex flex-col gap-4 overflow-y-auto">
          {form && (
            <>
              <div>
                <Label size="small">Account holder name</Label>
                <Input
                  value={form.account_holder_name}
                  onChange={(e) =>
                    setForm({ ...form, account_holder_name: e.target.value })
                  }
                />
              </div>
              <div>
                <Label size="small">Bank name</Label>
                <Input
                  value={form.bank_name}
                  onChange={(e) =>
                    setForm({ ...form, bank_name: e.target.value })
                  }
                  placeholder="e.g. HDFC Bank"
                />
              </div>
              <div>
                <Label size="small">Verification status</Label>
                <Select
                  value={form.verification_status}
                  onValueChange={(v) =>
                    setForm({ ...form, verification_status: v })
                  }
                >
                  <Select.Trigger>
                    <Select.Value />
                  </Select.Trigger>
                  <Select.Content>
                    {STATUS_OPTIONS.map((o) => (
                      <Select.Item key={o.value} value={o.value}>
                        {o.label}
                      </Select.Item>
                    ))}
                  </Select.Content>
                </Select>
              </div>
              <div>
                <Label size="small">Proof type</Label>
                <Select
                  value={form.bank_proof_type || "__none__"}
                  onValueChange={(v) =>
                    setForm({
                      ...form,
                      bank_proof_type: v === "__none__" ? "" : v,
                    })
                  }
                >
                  <Select.Trigger>
                    <Select.Value />
                  </Select.Trigger>
                  <Select.Content>
                    <Select.Item value="__none__">—</Select.Item>
                    {BANK_PROOF_TYPE_OPTIONS.map((o) => (
                      <Select.Item key={o.value} value={o.value}>
                        {o.label}
                      </Select.Item>
                    ))}
                  </Select.Content>
                </Select>
              </div>
              <div className="flex items-center gap-3">
                <Switch
                  checked={form.is_primary}
                  onCheckedChange={(v) => setForm({ ...form, is_primary: v })}
                  id="bank-is-primary"
                />
                <Label size="small" htmlFor="bank-is-primary">
                  Primary bank (credits land here)
                </Label>
              </div>

              <div>
                <Label size="small">
                  Reason <span className="text-ui-fg-error">*</span>
                </Label>
                <Textarea
                  value={form.reason}
                  onChange={(e) =>
                    setForm({ ...form, reason: e.target.value })
                  }
                  placeholder="Why are you changing this? (audit log, min 4 chars)"
                  rows={3}
                />
              </div>

              <Text size="small" className="text-ui-fg-muted">
                Account number and IFSC are not editable here — the customer
                must re-submit to trigger penny-drop verification again.
              </Text>

              {err && <Text className="text-ui-fg-error">{err}</Text>}
            </>
          )}
        </Drawer.Body>
        <Drawer.Footer>
          <Button variant="secondary" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button
            onClick={save}
            isLoading={saving}
            disabled={saving || !hasChanges}
          >
            Save changes
          </Button>
        </Drawer.Footer>
      </Drawer.Content>
    </Drawer>
  )
}

/* ------------------------------------------------------------------ */
/* Bank Add drawer — manual create, no penny-drop                     */
/* ------------------------------------------------------------------ */

const EMPTY_BANK_CREATE: BankCreateForm = {
  account_number: "",
  ifsc: "",
  account_holder_name: "",
  bank_name: "",
  verification_status: "pending",
  is_primary: false,
  reason: "",
}

function BankAddDrawer({
  open,
  customerId,
  onClose,
  onSaved,
}: {
  open: boolean
  customerId: string
  onClose: () => void
  onSaved: () => void | Promise<void>
}) {
  const [form, setForm] = useState<BankCreateForm>(EMPTY_BANK_CREATE)
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  /* Reset the form whenever the drawer re-opens so stale drafts from a
   * previous aborted attempt don't leak in. */
  useEffect(() => {
    if (open) {
      setForm(EMPTY_BANK_CREATE)
      setErr(null)
    }
  }, [open])

  const save = async () => {
    setErr(null)
    if (!/^\d{6,20}$/.test(form.account_number.replace(/\s+/g, ""))) {
      setErr("Account number must be 6-20 digits.")
      return
    }
    if (!/^[A-Z]{4}0[A-Z0-9]{6}$/.test(form.ifsc.trim().toUpperCase())) {
      setErr("IFSC format looks wrong (expected ABCD0XXXXXX).")
      return
    }
    if (form.account_holder_name.trim().length < 2) {
      setErr("Holder name is required.")
      return
    }
    if (form.reason.trim().length < 4) {
      setErr("Reason must be at least 4 characters.")
      return
    }
    setSaving(true)
    try {
      await adminFetch(`/admin/bank-accounts`, {
        method: "POST",
        body: JSON.stringify({
          customer_id: customerId,
          account_number: form.account_number.replace(/\s+/g, ""),
          ifsc: form.ifsc.trim().toUpperCase(),
          account_holder_name: form.account_holder_name.trim(),
          bank_name: form.bank_name.trim() || null,
          verification_status: form.verification_status,
          is_primary: form.is_primary,
          reason: form.reason.trim(),
        }),
      })
      await onSaved()
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Create failed")
    } finally {
      setSaving(false)
    }
  }

  return (
    <Drawer open={open} onOpenChange={(v) => !v && onClose()}>
      <Drawer.Content>
        <Drawer.Header>
          <Drawer.Title>Add bank account</Drawer.Title>
          <Drawer.Description>
            Manual create — skips penny-drop verification. The full
            account number is stored encrypted; only the last 4 digits
            are displayed afterwards.
          </Drawer.Description>
        </Drawer.Header>
        <Drawer.Body className="flex flex-col gap-4 overflow-y-auto">
          <div>
            <Label size="small">
              Account number <span className="text-ui-fg-error">*</span>
            </Label>
            <Input
              value={form.account_number}
              onChange={(e) =>
                setForm({ ...form, account_number: e.target.value })
              }
              placeholder="6-20 digits"
            />
          </div>
          <div>
            <Label size="small">
              IFSC <span className="text-ui-fg-error">*</span>
            </Label>
            <Input
              value={form.ifsc}
              onChange={(e) => setForm({ ...form, ifsc: e.target.value })}
              placeholder="e.g. HDFC0001234"
            />
          </div>
          <div>
            <Label size="small">
              Account holder name <span className="text-ui-fg-error">*</span>
            </Label>
            <Input
              value={form.account_holder_name}
              onChange={(e) =>
                setForm({ ...form, account_holder_name: e.target.value })
              }
              placeholder="As per the bank"
            />
          </div>
          <div>
            <Label size="small">Bank name (label)</Label>
            <Input
              value={form.bank_name}
              onChange={(e) => setForm({ ...form, bank_name: e.target.value })}
              placeholder="e.g. HDFC Bank"
            />
          </div>
          <div>
            <Label size="small">Verification status</Label>
            <Select
              value={form.verification_status}
              onValueChange={(v) =>
                setForm({ ...form, verification_status: v })
              }
            >
              <Select.Trigger>
                <Select.Value />
              </Select.Trigger>
              <Select.Content>
                {STATUS_OPTIONS.map((o) => (
                  <Select.Item key={o.value} value={o.value}>
                    {o.label}
                  </Select.Item>
                ))}
              </Select.Content>
            </Select>
          </div>
          <div className="flex items-center gap-3">
            <Switch
              checked={form.is_primary}
              onCheckedChange={(v) => setForm({ ...form, is_primary: v })}
              id="bank-add-is-primary"
            />
            <Label size="small" htmlFor="bank-add-is-primary">
              Mark as primary (demotes any existing primary)
            </Label>
          </div>
          <div>
            <Label size="small">
              Reason <span className="text-ui-fg-error">*</span>
            </Label>
            <Textarea
              value={form.reason}
              onChange={(e) => setForm({ ...form, reason: e.target.value })}
              placeholder="Why is ops adding this manually? (audit log, min 4 chars)"
              rows={3}
            />
          </div>
          <Text size="small" className="text-ui-fg-muted">
            Upload bank proof (cheque / passbook / statement) from the
            Documents tab after creation — it attaches to this row.
          </Text>
          {err && <Text className="text-ui-fg-error">{err}</Text>}
        </Drawer.Body>
        <Drawer.Footer>
          <Button variant="secondary" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={save} isLoading={saving} disabled={saving}>
            Create bank
          </Button>
        </Drawer.Footer>
      </Drawer.Content>
    </Drawer>
  )
}

/* ------------------------------------------------------------------ */
/* Demat Edit drawer                                                  */
/* ------------------------------------------------------------------ */

function DematEditDrawer({
  row,
  onClose,
  onSaved,
}: {
  row: DematAccount | null
  onClose: () => void
  onSaved: () => void | Promise<void>
}) {
  const [form, setForm] = useState<DematEditForm | null>(null)
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  useEffect(() => {
    if (!row) {
      setForm(null)
      setErr(null)
      return
    }
    setForm({
      account_holder_name: row.account_holder_name ?? "",
      depository: row.depository ?? "NSDL",
      dp_name: row.dp_name ?? "",
      dp_id: row.dp_id ?? "",
      client_id: row.client_id ?? "",
      boid: row.boid ?? "",
      verification_status: row.verification_status ?? "pending",
      is_primary: !!row.is_primary,
      reason: "",
    })
    setErr(null)
  }, [row?.id])

  const open = !!row && !!form

  const patch = useMemo(() => {
    if (!row || !form) return {}
    const p: Record<string, unknown> = {}
    const trim = (s: string) => s.trim()
    const nullable = (s: string) => (trim(s).length === 0 ? null : trim(s))

    if (trim(form.account_holder_name) !== (row.account_holder_name ?? ""))
      p.account_holder_name = trim(form.account_holder_name)
    if (form.depository !== row.depository) p.depository = form.depository
    if (trim(form.dp_name) !== (row.dp_name ?? "")) p.dp_name = trim(form.dp_name)
    if (nullable(form.dp_id) !== (row.dp_id ?? null)) p.dp_id = nullable(form.dp_id)
    if (nullable(form.client_id) !== (row.client_id ?? null))
      p.client_id = nullable(form.client_id)
    if (nullable(form.boid) !== (row.boid ?? null)) p.boid = nullable(form.boid)
    if (form.verification_status !== row.verification_status)
      p.verification_status = form.verification_status
    if (form.is_primary !== !!row.is_primary) p.is_primary = form.is_primary
    return p
  }, [row, form])

  const hasChanges = Object.keys(patch).length > 0

  const save = async () => {
    if (!row || !form) return
    if (!hasChanges) {
      setErr("Nothing changed.")
      return
    }
    if (form.reason.trim().length < 4) {
      setErr("Reason must be at least 4 characters.")
      return
    }
    setSaving(true)
    setErr(null)
    try {
      await adminFetch(`/admin/demat-accounts/${row.id}`, {
        method: "PATCH",
        body: JSON.stringify({ ...patch, reason: form.reason.trim() }),
      })
      await onSaved()
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Save failed")
    } finally {
      setSaving(false)
    }
  }

  return (
    <Drawer open={open} onOpenChange={(v) => !v && onClose()}>
      <Drawer.Content>
        <Drawer.Header>
          <Drawer.Title>Edit demat account</Drawer.Title>
          {row && (
            <Drawer.Description>
              {row.depository} · {row.dp_name}
              {row.boid ? ` · BOID ${row.boid}` : ""}
            </Drawer.Description>
          )}
        </Drawer.Header>
        <Drawer.Body className="flex flex-col gap-4 overflow-y-auto">
          {form && (
            <>
              <div>
                <Label size="small">Account holder name</Label>
                <Input
                  value={form.account_holder_name}
                  onChange={(e) =>
                    setForm({ ...form, account_holder_name: e.target.value })
                  }
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label size="small">Depository</Label>
                  <Select
                    value={form.depository}
                    onValueChange={(v) => setForm({ ...form, depository: v })}
                  >
                    <Select.Trigger>
                      <Select.Value />
                    </Select.Trigger>
                    <Select.Content>
                      {DEPOSITORY_OPTIONS.map((o) => (
                        <Select.Item key={o.value} value={o.value}>
                          {o.label}
                        </Select.Item>
                      ))}
                    </Select.Content>
                  </Select>
                </div>
                <div>
                  <Label size="small">DP name</Label>
                  <Input
                    value={form.dp_name}
                    onChange={(e) =>
                      setForm({ ...form, dp_name: e.target.value })
                    }
                    placeholder="e.g. Zerodha"
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label size="small">DP ID</Label>
                  <Input
                    value={form.dp_id}
                    onChange={(e) =>
                      setForm({ ...form, dp_id: e.target.value })
                    }
                    placeholder="(optional)"
                  />
                </div>
                <div>
                  <Label size="small">Client ID</Label>
                  <Input
                    value={form.client_id}
                    onChange={(e) =>
                      setForm({ ...form, client_id: e.target.value })
                    }
                    placeholder="(optional)"
                  />
                </div>
              </div>
              <div>
                <Label size="small">BOID</Label>
                <Input
                  value={form.boid}
                  onChange={(e) => setForm({ ...form, boid: e.target.value })}
                  placeholder="16-digit beneficiary ID"
                />
              </div>
              <div>
                <Label size="small">Verification status</Label>
                <Select
                  value={form.verification_status}
                  onValueChange={(v) =>
                    setForm({ ...form, verification_status: v })
                  }
                >
                  <Select.Trigger>
                    <Select.Value />
                  </Select.Trigger>
                  <Select.Content>
                    {STATUS_OPTIONS.map((o) => (
                      <Select.Item key={o.value} value={o.value}>
                        {o.label}
                      </Select.Item>
                    ))}
                  </Select.Content>
                </Select>
              </div>
              <div className="flex items-center gap-3">
                <Switch
                  checked={form.is_primary}
                  onCheckedChange={(v) => setForm({ ...form, is_primary: v })}
                  id="demat-is-primary"
                />
                <Label size="small" htmlFor="demat-is-primary">
                  Primary demat (deliveries land here)
                </Label>
              </div>

              <div>
                <Label size="small">
                  Reason <span className="text-ui-fg-error">*</span>
                </Label>
                <Textarea
                  value={form.reason}
                  onChange={(e) =>
                    setForm({ ...form, reason: e.target.value })
                  }
                  placeholder="Why are you changing this? (audit log, min 4 chars)"
                  rows={3}
                />
              </div>

              {err && <Text className="text-ui-fg-error">{err}</Text>}
            </>
          )}
        </Drawer.Body>
        <Drawer.Footer>
          <Button variant="secondary" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button
            onClick={save}
            isLoading={saving}
            disabled={saving || !hasChanges}
          >
            Save changes
          </Button>
        </Drawer.Footer>
      </Drawer.Content>
    </Drawer>
  )
}

/* ------------------------------------------------------------------ */
/* Demat Add drawer — manual create, no CMR verification              */
/* ------------------------------------------------------------------ */

const EMPTY_DEMAT_CREATE: DematCreateForm = {
  depository: "CDSL",
  dp_name: "",
  dp_id: "",
  client_id: "",
  boid: "",
  account_holder_name: "",
  verification_status: "pending",
  is_primary: false,
  reason: "",
}

function DematAddDrawer({
  open,
  customerId,
  onClose,
  onSaved,
}: {
  open: boolean
  customerId: string
  onClose: () => void
  onSaved: () => void | Promise<void>
}) {
  const [form, setForm] = useState<DematCreateForm>(EMPTY_DEMAT_CREATE)
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  useEffect(() => {
    if (open) {
      setForm(EMPTY_DEMAT_CREATE)
      setErr(null)
    }
  }, [open])

  const save = async () => {
    setErr(null)
    const trimmed = {
      dp_name: form.dp_name.trim(),
      dp_id: form.dp_id.trim(),
      client_id: form.client_id.trim(),
      boid: form.boid.trim(),
      account_holder_name: form.account_holder_name.trim(),
      reason: form.reason.trim(),
    }
    if (trimmed.dp_name.length < 2) {
      setErr("DP name is required.")
      return
    }
    if (trimmed.account_holder_name.length < 2) {
      setErr("Holder name is required.")
      return
    }
    if (form.depository === "CDSL") {
      if (!/^\d{16}$/.test(trimmed.boid)) {
        setErr("CDSL requires a 16-digit BOID.")
        return
      }
    } else {
      if (!/^IN\d{6}$/.test(trimmed.dp_id)) {
        setErr("NSDL DP ID must be IN + 6 digits.")
        return
      }
      if (!/^\d{8}$/.test(trimmed.client_id)) {
        setErr("NSDL Client ID must be 8 digits.")
        return
      }
    }
    if (trimmed.reason.length < 4) {
      setErr("Reason must be at least 4 characters.")
      return
    }

    setSaving(true)
    try {
      const payload: Record<string, unknown> = {
        customer_id: customerId,
        depository: form.depository,
        dp_name: trimmed.dp_name,
        account_holder_name: trimmed.account_holder_name,
        verification_status: form.verification_status,
        is_primary: form.is_primary,
        reason: trimmed.reason,
      }
      if (form.depository === "CDSL") {
        payload.boid = trimmed.boid
      } else {
        payload.dp_id = trimmed.dp_id
        payload.client_id = trimmed.client_id
      }
      await adminFetch(`/admin/demat-accounts`, {
        method: "POST",
        body: JSON.stringify(payload),
      })
      await onSaved()
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Create failed")
    } finally {
      setSaving(false)
    }
  }

  const isCdsl = form.depository === "CDSL"

  return (
    <Drawer open={open} onOpenChange={(v) => !v && onClose()}>
      <Drawer.Content>
        <Drawer.Header>
          <Drawer.Title>Add demat account</Drawer.Title>
          <Drawer.Description>
            Manual create — skips CMR verification. Upload the CMR PDF
            from the Documents tab afterwards.
          </Drawer.Description>
        </Drawer.Header>
        <Drawer.Body className="flex flex-col gap-4 overflow-y-auto">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label size="small">
                Depository <span className="text-ui-fg-error">*</span>
              </Label>
              <Select
                value={form.depository}
                onValueChange={(v) =>
                  setForm({ ...form, depository: v as "NSDL" | "CDSL" })
                }
              >
                <Select.Trigger>
                  <Select.Value />
                </Select.Trigger>
                <Select.Content>
                  {DEPOSITORY_OPTIONS.map((o) => (
                    <Select.Item key={o.value} value={o.value}>
                      {o.label}
                    </Select.Item>
                  ))}
                </Select.Content>
              </Select>
            </div>
            <div>
              <Label size="small">
                DP name <span className="text-ui-fg-error">*</span>
              </Label>
              <Input
                value={form.dp_name}
                onChange={(e) =>
                  setForm({ ...form, dp_name: e.target.value })
                }
                placeholder="e.g. Zerodha"
              />
            </div>
          </div>

          {isCdsl ? (
            <div>
              <Label size="small">
                BOID (16 digits) <span className="text-ui-fg-error">*</span>
              </Label>
              <Input
                value={form.boid}
                onChange={(e) => setForm({ ...form, boid: e.target.value })}
                placeholder="16-digit beneficiary ID"
              />
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label size="small">
                  DP ID <span className="text-ui-fg-error">*</span>
                </Label>
                <Input
                  value={form.dp_id}
                  onChange={(e) =>
                    setForm({ ...form, dp_id: e.target.value })
                  }
                  placeholder="IN + 6 digits"
                />
              </div>
              <div>
                <Label size="small">
                  Client ID <span className="text-ui-fg-error">*</span>
                </Label>
                <Input
                  value={form.client_id}
                  onChange={(e) =>
                    setForm({ ...form, client_id: e.target.value })
                  }
                  placeholder="8 digits"
                />
              </div>
            </div>
          )}

          <div>
            <Label size="small">
              Account holder name <span className="text-ui-fg-error">*</span>
            </Label>
            <Input
              value={form.account_holder_name}
              onChange={(e) =>
                setForm({ ...form, account_holder_name: e.target.value })
              }
              placeholder="As per PAN / CMR"
            />
          </div>
          <div>
            <Label size="small">Verification status</Label>
            <Select
              value={form.verification_status}
              onValueChange={(v) =>
                setForm({ ...form, verification_status: v })
              }
            >
              <Select.Trigger>
                <Select.Value />
              </Select.Trigger>
              <Select.Content>
                {STATUS_OPTIONS.map((o) => (
                  <Select.Item key={o.value} value={o.value}>
                    {o.label}
                  </Select.Item>
                ))}
              </Select.Content>
            </Select>
          </div>
          <div className="flex items-center gap-3">
            <Switch
              checked={form.is_primary}
              onCheckedChange={(v) => setForm({ ...form, is_primary: v })}
              id="demat-add-is-primary"
            />
            <Label size="small" htmlFor="demat-add-is-primary">
              Mark as primary (demotes any existing primary)
            </Label>
          </div>
          <div>
            <Label size="small">
              Reason <span className="text-ui-fg-error">*</span>
            </Label>
            <Textarea
              value={form.reason}
              onChange={(e) => setForm({ ...form, reason: e.target.value })}
              placeholder="Why is ops adding this manually? (audit log, min 4 chars)"
              rows={3}
            />
          </div>
          {err && <Text className="text-ui-fg-error">{err}</Text>}
        </Drawer.Body>
        <Drawer.Footer>
          <Button variant="secondary" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={save} isLoading={saving} disabled={saving}>
            Create demat
          </Button>
        </Drawer.Footer>
      </Drawer.Content>
    </Drawer>
  )
}

/** Small label/value pair used in the Virtual Account section. */
function Field({
  label,
  value,
  mono,
}: {
  label: string
  value: React.ReactNode
  mono?: boolean
}) {
  return (
    <div>
      <Text
        size="xsmall"
        className="text-ui-fg-subtle uppercase tracking-widest"
      >
        {label}
      </Text>
      <Text size="small" className={mono ? "font-mono" : ""}>
        {value}
      </Text>
    </div>
  )
}
