import { useEffect, useMemo, useState } from "react"
import { defineRouteConfig } from "@medusajs/admin-sdk"
import {
  Button,
  Container,
  Drawer,
  Heading,
  Input,
  Label,
  Select,
  StatusBadge,
  Table,
  Text,
} from "@medusajs/ui"
import { CreditCard, Eye, EyeSlash } from "@medusajs/icons"

/**
 * /app/pan-records — global PAN registry.
 *
 * Lists every row in the `pan_record` table — i.e. every PAN we've ever
 * cached from a Cashfree call, whether or not a customer ended up linked.
 *
 * Why this page exists separately from Customer 360 → KYC → PAN:
 *   - That tab loads only the ONE pan_record linked via the customer's
 *     metadata.pan_hash. There's no way to browse PANs that were pulled
 *     for a customer who later got purged, or to see at a glance all PANs
 *     where the registered name on PAN didn't match what was submitted.
 *   - Multiple customers can share one PAN (the cache is global). This
 *     page surfaces the join: "for PAN X, here's every customer that ever
 *     submitted it and the outcome of their attempts."
 *
 * Drawer detail pulls the full pan_record (incl. raw Cashfree response)
 * plus the list of linked customers and recent kind=pan verification
 * attempts for those customers.
 */

type PanRow = {
  id: string
  pan_hash: string
  pan_masked: string
  /** Full PAN as Cashfree echoed back in the response. Null for old
   *  rows seeded before we started saving the unredacted response.
   *  Surfaced for SEBI/PMLA compliance + DIS share-transfer ops. */
  pan_full: string | null
  registered_name: string
  name_pan_card: string | null
  pan_status: string | null
  date_of_birth: string | null
  gender: string | null
  aadhaar_linked: boolean | null
  masked_aadhaar: string | null
  email_masked: string | null
  phone_masked: string | null
  name_match_score_initial: number | null
  name_match_result_initial: string | null
  cashfree_reference_id: string | null
  first_verified_at: string | null
  last_refreshed_at: string | null
  linked_customer_count: number
}

type ListResponse = {
  count: number
  limit: number
  offset: number
  items: PanRow[]
}

type LinkedCustomer = {
  id: string
  email: string | null
  first_name: string | null
  last_name: string | null
  created_at: string
  deleted_at: string | null
  pan_registered_name: string | null
}

type VerificationLite = {
  id: string
  customer_id: string
  kind: string
  status: "pending" | "success" | "failed"
  reference_id: string | null
  input_masked: string | null
  attempt_no: number
  created_at: string
}

type DetailResponse = {
  pan_record: PanRow & {
    father_name?: string | null
    first_name?: string | null
    last_name?: string | null
    pan_type?: string | null
    last_updated_at_itd?: string | null
    aadhaar_seeding_status?: string | null
    aadhaar_seeding_status_desc?: string | null
    address?: Record<string, unknown> | null
    response_raw?: Record<string, unknown> | null
    /** Echo of the typed name from the call that created this row.
     *  Useful when grading "Bob's PAN, Alice's name" cases. */
    name_provided?: string | null
    /** Cashfree's masked mobile (e.g. "99XXXXXX99") — never available
     *  unmasked, UIDAI/Cashfree policy. */
    mobile_number?: string | null
  }
  linked_customers: LinkedCustomer[]
  verifications: VerificationLite[]
}

// Medusa UI's Select reserves the empty string for "no selection / show
// placeholder" — Select.Item value="" throws at runtime. So we use a
// sentinel ("__any") in the dropdown and translate it back to "" when
// building the query string.
const ANY = "__any"
const AADHAAR_FILTERS = [
  { value: ANY, label: "Aadhaar: any" },
  { value: "true", label: "Aadhaar: linked" },
  { value: "false", label: "Aadhaar: not linked" },
] as const

const PAN_STATUSES = [
  { value: ANY, label: "PAN status: any" },
  { value: "VALID", label: "VALID" },
  { value: "INVALID", label: "INVALID" },
  { value: "DEACTIVATED", label: "DEACTIVATED" },
  { value: "DELETED", label: "DELETED" },
  { value: "MARKED_DECEASED", label: "MARKED_DECEASED" },
] as const

const PAGE_SIZE = 50

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { credentials: "include" })
  const body = await res.json().catch(() => ({}))
  if (!res.ok) {
    throw new Error((body as any)?.message || `${res.status} ${res.statusText}`)
  }
  return body as T
}

function fmt(d: string | null | undefined): string {
  if (!d) return "—"
  const t = Date.parse(d)
  if (Number.isNaN(t)) return d
  return new Date(t).toLocaleString("en-IN")
}

function PanRecordsPage() {
  const [rows, setRows] = useState<PanRow[]>([])
  const [count, setCount] = useState(0)
  const [offset, setOffset] = useState(0)
  const [q, setQ] = useState("")
  const [aadhaarLinked, setAadhaarLinked] = useState<string>(ANY)
  const [panStatus, setPanStatus] = useState<string>(ANY)
  const [orphansOnly, setOrphansOnly] = useState(false)
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState<string | null>(null)
  const [detail, setDetail] = useState<DetailResponse | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)

  const url = useMemo(() => {
    const qs = new URLSearchParams()
    if (q.trim()) qs.set("q", q.trim())
    if (aadhaarLinked && aadhaarLinked !== ANY)
      qs.set("aadhaar_linked", aadhaarLinked)
    if (panStatus && panStatus !== ANY) qs.set("pan_status", panStatus)
    if (orphansOnly) qs.set("orphans", "1")
    qs.set("limit", String(PAGE_SIZE))
    qs.set("offset", String(offset))
    return `/admin/pan-records?${qs.toString()}`
  }, [q, aadhaarLinked, panStatus, orphansOnly, offset])

  const load = async () => {
    setLoading(true)
    setErr(null)
    try {
      const r = await fetchJson<ListResponse>(url)
      setRows(r.items)
      setCount(r.count)
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Failed to load PAN records")
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url])

  const openDetail = async (hash: string) => {
    setDetailLoading(true)
    setDetail(null)
    setErr(null)
    try {
      const r = await fetchJson<DetailResponse>(`/admin/pan-records/${hash}`)
      setDetail(r)
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Failed to load PAN detail")
    } finally {
      setDetailLoading(false)
    }
  }

  const reset = () => {
    setQ("")
    setAadhaarLinked(ANY)
    setPanStatus(ANY)
    setOrphansOnly(false)
    setOffset(0)
  }

  return (
    <Container className="p-6">
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-2">
          <CreditCard />
          <div>
            <Heading level="h1">PAN registry</Heading>
            <Text size="small" className="text-ui-fg-muted">
              Every PAN ever cached from Cashfree (PAN 360 / Advance / Basic),
              regardless of whether a customer is currently linked. Click a
              row for full details, linked customers, and recent verification
              attempts.
            </Text>
          </div>
        </div>
        <div className="flex gap-2">
          <Button size="small" variant="secondary" onClick={reset}>
            Reset
          </Button>
          <Button size="small" variant="secondary" onClick={load}>
            Refresh
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-3 mb-4">
        <div className="md:col-span-2">
          <Label size="small">Search (name / masked PAN)</Label>
          <Input
            value={q}
            onChange={(e) => {
              setQ(e.target.value)
              setOffset(0)
            }}
            placeholder="ABCDE****F or partial registered name…"
          />
        </div>
        <div>
          <Label size="small">Aadhaar linked</Label>
          <Select
            value={aadhaarLinked}
            onValueChange={(v) => {
              setAadhaarLinked(v)
              setOffset(0)
            }}
          >
            <Select.Trigger>
              <Select.Value placeholder="Any" />
            </Select.Trigger>
            <Select.Content>
              {AADHAAR_FILTERS.map((f) => (
                <Select.Item key={f.value} value={f.value}>
                  {f.label}
                </Select.Item>
              ))}
            </Select.Content>
          </Select>
        </div>
        <div>
          <Label size="small">PAN status</Label>
          <Select
            value={panStatus}
            onValueChange={(v) => {
              setPanStatus(v)
              setOffset(0)
            }}
          >
            <Select.Trigger>
              <Select.Value placeholder="Any" />
            </Select.Trigger>
            <Select.Content>
              {PAN_STATUSES.map((s) => (
                <Select.Item key={s.value} value={s.value}>
                  {s.label}
                </Select.Item>
              ))}
            </Select.Content>
          </Select>
        </div>
      </div>

      <div className="flex items-center gap-3 mb-2">
        <label className="flex items-center gap-2 text-sm text-ui-fg-base cursor-pointer">
          <input
            type="checkbox"
            checked={orphansOnly}
            onChange={(e) => {
              setOrphansOnly(e.target.checked)
              setOffset(0)
            }}
          />
          <span>Orphans only (no linked customer)</span>
        </label>
      </div>

      {err && <Text className="text-ui-fg-error mb-2">{err}</Text>}

      <div className="flex items-center justify-between mb-2">
        <Text size="small" className="text-ui-fg-muted">
          {loading
            ? "Loading…"
            : `Showing ${rows.length} of ${count} (offset ${offset})`}
        </Text>
        <div className="flex gap-1">
          <Button
            size="small"
            variant="secondary"
            disabled={offset === 0 || loading}
            onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}
          >
            Prev
          </Button>
          <Button
            size="small"
            variant="secondary"
            disabled={offset + rows.length >= count || loading}
            onClick={() => setOffset(offset + PAGE_SIZE)}
          >
            Next
          </Button>
        </div>
      </div>

      <Table>
        <Table.Header>
          <Table.Row>
            <Table.HeaderCell>PAN</Table.HeaderCell>
            <Table.HeaderCell>Registered name</Table.HeaderCell>
            <Table.HeaderCell>DOB</Table.HeaderCell>
            <Table.HeaderCell>PAN status</Table.HeaderCell>
            <Table.HeaderCell>Aadhaar</Table.HeaderCell>
            <Table.HeaderCell>Linked customers</Table.HeaderCell>
            <Table.HeaderCell>Last refreshed</Table.HeaderCell>
          </Table.Row>
        </Table.Header>
        <Table.Body>
          {!rows.length && !loading ? (
            <Table.Row>
              <Table.Cell colSpan={7}>
                <Text size="small" className="text-ui-fg-subtle">
                  No PAN records match the current filters.
                </Text>
              </Table.Cell>
            </Table.Row>
          ) : (
            rows.map((r) => (
              <Table.Row
                key={r.id}
                className="cursor-pointer"
                onClick={() => openDetail(r.pan_hash)}
              >
                <Table.Cell>
                  <Text size="small" weight="plus">
                    <RevealableValue
                      masked={r.pan_masked}
                      unmasked={r.pan_full}
                    />
                  </Text>
                </Table.Cell>
                <Table.Cell>
                  <Text size="small">{r.registered_name}</Text>
                  {r.name_pan_card && r.name_pan_card !== r.registered_name && (
                    <Text size="xsmall" className="text-ui-fg-subtle">
                      Card: {r.name_pan_card}
                    </Text>
                  )}
                </Table.Cell>
                <Table.Cell>
                  <Text size="xsmall" className="text-ui-fg-subtle">
                    {r.date_of_birth ?? "—"}
                  </Text>
                </Table.Cell>
                <Table.Cell>
                  {r.pan_status ? (
                    <StatusBadge
                      color={r.pan_status === "VALID" ? "green" : "red"}
                    >
                      {r.pan_status}
                    </StatusBadge>
                  ) : (
                    <Text size="xsmall" className="text-ui-fg-subtle">—</Text>
                  )}
                </Table.Cell>
                <Table.Cell>
                  {typeof r.aadhaar_linked === "boolean" ? (
                    <StatusBadge
                      color={r.aadhaar_linked ? "green" : "orange"}
                    >
                      {r.aadhaar_linked ? "linked" : "not linked"}
                    </StatusBadge>
                  ) : (
                    <Text size="xsmall" className="text-ui-fg-subtle">
                      unknown
                    </Text>
                  )}
                </Table.Cell>
                <Table.Cell>
                  <StatusBadge
                    color={r.linked_customer_count > 0 ? "blue" : "grey"}
                  >
                    {r.linked_customer_count}
                  </StatusBadge>
                </Table.Cell>
                <Table.Cell>
                  <Text size="xsmall" className="text-ui-fg-subtle">
                    {fmt(r.last_refreshed_at)}
                  </Text>
                </Table.Cell>
              </Table.Row>
            ))
          )}
        </Table.Body>
      </Table>

      <Drawer open={!!detail || detailLoading} onOpenChange={(o) => {
        if (!o) setDetail(null)
      }}>
        <Drawer.Content>
          <Drawer.Header>
            <Drawer.Title>
              PAN {detail?.pan_record.pan_masked ?? "…"}
            </Drawer.Title>
          </Drawer.Header>
          <Drawer.Body className="overflow-y-auto">
            {detailLoading && !detail ? (
              <Text>Loading…</Text>
            ) : detail ? (
              <DetailBody detail={detail} />
            ) : null}
          </Drawer.Body>
          <Drawer.Footer>
            <Button variant="secondary" onClick={() => setDetail(null)}>
              Close
            </Button>
          </Drawer.Footer>
        </Drawer.Content>
      </Drawer>
    </Container>
  )
}

function DetailBody({ detail }: { detail: DetailResponse }) {
  const r = detail.pan_record
  const addr =
    (r.address as any)?.full_address ??
    [
      (r.address as any)?.street,
      (r.address as any)?.city,
      (r.address as any)?.state,
      (r.address as any)?.pincode,
      (r.address as any)?.country,
    ]
      .filter(Boolean)
      .join(", ")

  return (
    <div className="flex flex-col gap-6">
      {/* ── PAN record fields ─────────────────────────────────── */}
      <div>
        <Text
          size="small"
          weight="plus"
          className="uppercase tracking-widest text-ui-fg-muted mb-2"
        >
          PAN record
        </Text>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-sm">
          <Row
            label="PAN"
            value={
              <RevealableValue
                masked={r.pan_masked}
                unmasked={r.pan_full ?? null}
              />
            }
          />
          <Row label="Name provided (typed)" value={r.name_provided} />
          <Row label="Registered name" value={r.registered_name} />
          <Row label="Name on card" value={r.name_pan_card} />
          <Row label="First name" value={r.first_name as string | null} />
          <Row label="Last name" value={r.last_name as string | null} />
          <Row label="Father's name" value={r.father_name as string | null} />
          <Row label="PAN type" value={r.pan_type as string | null} />
          <Row label="PAN status" value={r.pan_status} />
          <Row label="Date of birth" value={r.date_of_birth} />
          <Row label="Gender" value={r.gender} />
          <Row
            label="Aadhaar linked"
            value={
              typeof r.aadhaar_linked === "boolean"
                ? r.aadhaar_linked
                  ? "Yes"
                  : "No"
                : (r.aadhaar_seeding_status_desc as string | null) ??
                  (r.aadhaar_seeding_status as string | null)
            }
          />
          <Row label="Aadhaar (last 4)" value={r.masked_aadhaar} mono />
          <Row
            label="Email"
            value={r.email_masked}
            hint="Cashfree masks email at source — unmasked form not available"
          />
          <Row
            label="Mobile"
            value={r.mobile_number ?? r.phone_masked}
            hint="Cashfree masks mobile at source — unmasked form not available"
          />
          <Row label="Address" value={addr || null} wide />
          <Row
            label="ITD last updated"
            value={r.last_updated_at_itd as string | null}
          />
          <Row
            label="Initial name match"
            value={
              r.name_match_result_initial
                ? `${r.name_match_result_initial}${
                    r.name_match_score_initial != null
                      ? ` (${(r.name_match_score_initial * 100).toFixed(0)}%)`
                      : ""
                  }`
                : null
            }
          />
          <Row
            label="Cashfree reference"
            value={r.cashfree_reference_id}
            mono
          />
          <Row label="First verified" value={fmt(r.first_verified_at)} />
          <Row label="Last refreshed" value={fmt(r.last_refreshed_at)} />
        </div>
      </div>

      {/* ── Linked customers ──────────────────────────────────── */}
      <div>
        <Text
          size="small"
          weight="plus"
          className="uppercase tracking-widest text-ui-fg-muted mb-2"
        >
          Linked customers ({detail.linked_customers.length})
        </Text>
        {detail.linked_customers.length === 0 ? (
          <div className="rounded-md border border-dashed border-ui-border-base bg-ui-bg-subtle p-4">
            <Text size="small" className="text-ui-fg-subtle">
              No customer is currently linked to this PAN. The data is retained
              in the global cache; when a customer next submits this PAN they
              will be linked automatically.
            </Text>
          </div>
        ) : (
          <Table>
            <Table.Header>
              <Table.Row>
                <Table.HeaderCell>Customer</Table.HeaderCell>
                <Table.HeaderCell>Submitted name</Table.HeaderCell>
                <Table.HeaderCell>Created</Table.HeaderCell>
                <Table.HeaderCell />
              </Table.Row>
            </Table.Header>
            <Table.Body>
              {detail.linked_customers.map((c) => (
                <Table.Row key={c.id}>
                  <Table.Cell>
                    <div className="flex flex-col">
                      <Text size="small">
                        {[c.first_name, c.last_name]
                          .filter(Boolean)
                          .join(" ") || "(no name)"}
                      </Text>
                      <Text size="xsmall" className="text-ui-fg-subtle">
                        {c.email ?? c.id}
                      </Text>
                      {c.deleted_at && (
                        <StatusBadge color="red">deleted</StatusBadge>
                      )}
                    </div>
                  </Table.Cell>
                  <Table.Cell>
                    <Text size="xsmall" className="text-ui-fg-subtle">
                      {c.pan_registered_name ?? "—"}
                    </Text>
                  </Table.Cell>
                  <Table.Cell>
                    <Text size="xsmall" className="text-ui-fg-subtle">
                      {fmt(c.created_at)}
                    </Text>
                  </Table.Cell>
                  <Table.Cell>
                    <a
                      className="text-ui-fg-interactive underline text-xs"
                      href={`/app/customer-360?id=${encodeURIComponent(c.id)}`}
                    >
                      Open Customer 360
                    </a>
                  </Table.Cell>
                </Table.Row>
              ))}
            </Table.Body>
          </Table>
        )}
      </div>

      {/* ── Verification attempts ─────────────────────────────── */}
      <div>
        <Text
          size="small"
          weight="plus"
          className="uppercase tracking-widest text-ui-fg-muted mb-2"
        >
          Recent PAN verification attempts ({detail.verifications.length})
        </Text>
        {detail.verifications.length === 0 ? (
          <Text size="small" className="text-ui-fg-subtle">
            No PAN verification attempts on file for the linked customers.
          </Text>
        ) : (
          <Table>
            <Table.Header>
              <Table.Row>
                <Table.HeaderCell>When</Table.HeaderCell>
                <Table.HeaderCell>Customer</Table.HeaderCell>
                <Table.HeaderCell>Status</Table.HeaderCell>
                <Table.HeaderCell>Attempt</Table.HeaderCell>
                <Table.HeaderCell>Reference</Table.HeaderCell>
              </Table.Row>
            </Table.Header>
            <Table.Body>
              {detail.verifications.map((v) => (
                <Table.Row key={v.id}>
                  <Table.Cell>
                    <Text size="xsmall" className="text-ui-fg-subtle">
                      {fmt(v.created_at)}
                    </Text>
                  </Table.Cell>
                  <Table.Cell>
                    <Text size="xsmall" className="font-mono">
                      {v.customer_id}
                    </Text>
                  </Table.Cell>
                  <Table.Cell>
                    <StatusBadge
                      color={
                        v.status === "success"
                          ? "green"
                          : v.status === "failed"
                            ? "red"
                            : "orange"
                      }
                    >
                      {v.status}
                    </StatusBadge>
                  </Table.Cell>
                  <Table.Cell>
                    <Text size="xsmall">#{v.attempt_no}</Text>
                  </Table.Cell>
                  <Table.Cell>
                    <Text size="xsmall" className="font-mono text-ui-fg-subtle">
                      {v.reference_id ?? "—"}
                    </Text>
                  </Table.Cell>
                </Table.Row>
              ))}
            </Table.Body>
          </Table>
        )}
      </div>

      {/* ── Raw Cashfree response ─────────────────────────────── */}
      {r.response_raw && (
        <div>
          <Text
            size="small"
            weight="plus"
            className="uppercase tracking-widest text-ui-fg-muted mb-2"
          >
            Raw Cashfree response (redacted)
          </Text>
          <pre className="text-xs bg-ui-bg-subtle border border-ui-border-base rounded-md p-3 overflow-auto max-h-96">
            {JSON.stringify(r.response_raw, null, 2)}
          </pre>
        </div>
      )}
    </div>
  )
}

/**
 * Inline reveal-toggle for sensitive identifiers (PAN, Aadhaar,
 * bank account, etc.). Shows the masked form by default with a
 * small eye-button that flips to the unmasked value on click.
 *
 * `unmasked` may be null (not yet stored / not yet decrypted); the
 * toggle is hidden in that case. `onReveal` is optional — supply
 * it for fields where the unmasked form is fetched lazily on click
 * (e.g. bank-account decrypt endpoint). For values already in
 * memory (PAN, Aadhaar in registry), pass `unmasked` directly and
 * skip `onReveal`.
 */
function RevealableValue({
  masked,
  unmasked,
  mono = true,
  onReveal,
}: {
  masked: string
  unmasked: string | null
  mono?: boolean
  onReveal?: () => Promise<string | null> | string | null
}) {
  const [revealed, setRevealed] = useState(false)
  const [resolved, setResolved] = useState<string | null>(unmasked ?? null)
  const [busy, setBusy] = useState(false)
  const canReveal = !!unmasked || !!onReveal
  const display = revealed && resolved ? resolved : masked
  const onClick = async () => {
    if (busy) return
    if (revealed) {
      setRevealed(false)
      return
    }
    if (resolved) {
      setRevealed(true)
      return
    }
    if (onReveal) {
      setBusy(true)
      try {
        const v = await onReveal()
        if (v) {
          setResolved(v)
          setRevealed(true)
        }
      } finally {
        setBusy(false)
      }
    }
  }
  return (
    <span className="inline-flex items-center gap-2">
      <span className={mono ? "font-mono" : ""}>{display}</span>
      {canReveal && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation()
            void onClick()
          }}
          disabled={busy}
          className="text-ui-fg-subtle hover:text-ui-fg-base transition-colors disabled:opacity-40"
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

function Row({
  label,
  value,
  mono,
  wide,
  hint,
}: {
  label: string
  value: React.ReactNode
  mono?: boolean
  wide?: boolean
  hint?: string
}) {
  if (value === null || value === undefined || value === "") return null
  return (
    <div className={wide ? "md:col-span-2" : ""}>
      <Text
        size="xsmall"
        className="text-ui-fg-subtle uppercase tracking-widest"
      >
        {label}
      </Text>
      <Text size="small" className={mono ? "font-mono" : ""}>
        {value}
      </Text>
      {hint && (
        <Text size="xsmall" className="text-ui-fg-subtle italic">
          {hint}
        </Text>
      )}
    </div>
  )
}

export const config = defineRouteConfig({
  label: "PAN registry",
  icon: CreditCard,
  // Sidebar nest under native Customers — same shelf as Customer 360.
  // Medusa Admin SDK only permits nesting under the 6 native routes;
  // /customer-360 isn't a valid parent, so we anchor at /customers.
  nested: "/customers",
})

export default PanRecordsPage
