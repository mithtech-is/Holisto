import { useEffect, useMemo, useState } from "react"
import { defineRouteConfig } from "@medusajs/admin-sdk"
import {
  Button,
  Container,
  Drawer,
  Heading,
  Input,
  Label,
  StatusBadge,
  Table,
  Text,
} from "@medusajs/ui"
import { BuildingTax, Eye, EyeSlash } from "@medusajs/icons"

/**
 * /app/bank-records — global bank-account registry.
 *
 * Lists every row in the `bank_record` table — i.e. every bank
 * account ever confirmed via Cashfree BAV v2 sync, regardless of
 * whether a customer is currently linked.
 *
 * Hashing: SHA-256(<IFSC>:<account_number>). Linked-customer count
 * comes from `bank_account.bank_hash`.
 *
 * Account-number reveal toggle mirrors the PAN / Aadhaar registry
 * pattern: default-masked (XXXXXX1234), eye-button flips to full
 * value when present.
 */

type BankRow = {
  id: string
  bank_hash: string
  account_number_masked: string
  account_number_full: string | null
  ifsc: string
  account_status: string | null
  account_status_code: string | null
  name_at_bank: string | null
  name_match_result: string | null
  name_match_score: number | null
  bank_name: string | null
  branch: string | null
  city: string | null
  micr: string | null
  swift_code: string | null
  nbin: string | null
  category: string | null
  cashfree_ref_id: string | null
  utr: string | null
  first_verified_at: string | null
  last_refreshed_at: string | null
  linked_customer_count: number
}

type ListResponse = {
  count: number
  limit: number
  offset: number
  items: BankRow[]
}

type LinkedCustomer = {
  bank_account_id: string
  customer_id: string
  is_primary: boolean
  verification_status: string
  account_holder_name: string | null
  email: string | null
  first_name: string | null
  last_name: string | null
  created_at: string
  bank_account_deleted_at: string | null
  customer_deleted_at: string | null
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
  bank_record: BankRow & {
    ifsc_details?: Record<string, unknown> | null
    response_raw?: Record<string, unknown> | null
  }
  linked_customers: LinkedCustomer[]
  verifications: VerificationLite[]
}

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

function BankRecordsPage() {
  const [rows, setRows] = useState<BankRow[]>([])
  const [count, setCount] = useState(0)
  const [offset, setOffset] = useState(0)
  const [q, setQ] = useState("")
  const [orphansOnly, setOrphansOnly] = useState(false)
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState<string | null>(null)
  const [detail, setDetail] = useState<DetailResponse | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)

  const url = useMemo(() => {
    const qs = new URLSearchParams()
    if (q.trim()) qs.set("q", q.trim())
    if (orphansOnly) qs.set("orphans", "1")
    qs.set("limit", String(PAGE_SIZE))
    qs.set("offset", String(offset))
    return `/admin/bank-records?${qs.toString()}`
  }, [q, orphansOnly, offset])

  const load = async () => {
    setLoading(true)
    setErr(null)
    try {
      const r = await fetchJson<ListResponse>(url)
      setRows(r.items)
      setCount(r.count)
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Failed to load bank records")
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
      const r = await fetchJson<DetailResponse>(`/admin/bank-records/${hash}`)
      setDetail(r)
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Failed to load detail")
    } finally {
      setDetailLoading(false)
    }
  }

  const reset = () => {
    setQ("")
    setOrphansOnly(false)
    setOffset(0)
  }

  return (
    <Container className="p-6">
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-2">
          <BuildingTax />
          <div>
            <Heading level="h1">Bank registry</Heading>
            <Text size="small" className="text-ui-fg-muted">
              Every bank account confirmed via Cashfree BAV v2 sync. Keyed
              by SHA-256(IFSC : account number); survives customer
              deletion. The full account number is stored plaintext per
              the same operator decision used for PAN / Aadhaar; surfaced
              only via the Reveal toggle.
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

      <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-4">
        <div className="md:col-span-2">
          <Label size="small">Search (bank / branch / city / IFSC / holder / last-4)</Label>
          <Input
            value={q}
            onChange={(e) => {
              setQ(e.target.value)
              setOffset(0)
            }}
            placeholder="HDFC / Mumbai / SBIN0000300 / 1234…"
          />
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
            <Table.HeaderCell>Account number</Table.HeaderCell>
            <Table.HeaderCell>IFSC</Table.HeaderCell>
            <Table.HeaderCell>Bank · Branch</Table.HeaderCell>
            <Table.HeaderCell>Holder name (at bank)</Table.HeaderCell>
            <Table.HeaderCell>Match</Table.HeaderCell>
            <Table.HeaderCell>Linked</Table.HeaderCell>
            <Table.HeaderCell>Last refreshed</Table.HeaderCell>
          </Table.Row>
        </Table.Header>
        <Table.Body>
          {!rows.length && !loading ? (
            <Table.Row>
              <Table.Cell colSpan={7}>
                <Text size="small" className="text-ui-fg-subtle">
                  No bank records match the current filters.
                </Text>
              </Table.Cell>
            </Table.Row>
          ) : (
            rows.map((r) => (
              <Table.Row
                key={r.id}
                className="cursor-pointer"
                onClick={() => openDetail(r.bank_hash)}
              >
                <Table.Cell>
                  <Text size="small" weight="plus" className="font-mono">
                    <RevealableValue
                      masked={r.account_number_masked}
                      unmasked={r.account_number_full}
                    />
                  </Text>
                </Table.Cell>
                <Table.Cell>
                  <Text size="xsmall" className="font-mono">
                    {r.ifsc}
                  </Text>
                </Table.Cell>
                <Table.Cell>
                  <Text size="small">
                    {r.bank_name ?? "—"}
                    {r.branch ? ` · ${r.branch}` : ""}
                  </Text>
                  {r.city && (
                    <Text size="xsmall" className="text-ui-fg-subtle">
                      {r.city}
                    </Text>
                  )}
                </Table.Cell>
                <Table.Cell>
                  <Text size="small">{r.name_at_bank ?? "—"}</Text>
                </Table.Cell>
                <Table.Cell>
                  <StatusBadge color={matchColour(r.name_match_result)}>
                    {r.name_match_result ?? "—"}
                  </StatusBadge>
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

      <Drawer
        open={!!detail || detailLoading}
        onOpenChange={(o) => {
          if (!o) setDetail(null)
        }}
      >
        <Drawer.Content>
          <Drawer.Header>
            <Drawer.Title>
              {detail?.bank_record.bank_name ?? "Bank record"}
              {detail?.bank_record.account_number_masked
                ? ` · ${detail.bank_record.account_number_masked}`
                : ""}
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

function matchColour(
  result: string | null | undefined,
): "green" | "blue" | "orange" | "red" | "grey" {
  switch ((result ?? "").toUpperCase()) {
    case "DIRECT_MATCH":
    case "EXACT_MATCH":
      return "green"
    case "GOOD_PARTIAL_MATCH":
      return "blue"
    case "MODERATE_PARTIAL_MATCH":
    case "POOR_PARTIAL_MATCH":
      return "orange"
    case "NO_MATCH":
      return "red"
    default:
      return "grey"
  }
}

function DetailBody({ detail }: { detail: DetailResponse }) {
  const r = detail.bank_record
  return (
    <div className="flex flex-col gap-6">
      <div>
        <Text
          size="small"
          weight="plus"
          className="uppercase tracking-widest text-ui-fg-muted mb-2"
        >
          Bank record
        </Text>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-sm">
          <Row
            label="Account number"
            value={
              <RevealableValue
                masked={r.account_number_masked}
                unmasked={r.account_number_full}
              />
            }
          />
          <Row label="IFSC" value={r.ifsc} mono />
          <Row label="Bank" value={r.bank_name} />
          <Row label="Branch" value={r.branch} />
          <Row label="City" value={r.city} />
          <Row label="MICR" value={r.micr} mono />
          <Row label="SWIFT / BIC" value={r.swift_code} mono />
          <Row label="NBIN" value={r.nbin} mono />
          <Row label="Bank category" value={r.category} />
          <Row label="Holder name (at bank)" value={r.name_at_bank} />
          <Row
            label="Name match"
            value={
              r.name_match_result
                ? `${r.name_match_result}${
                    typeof r.name_match_score === "number"
                      ? ` (${r.name_match_score}%)`
                      : ""
                  }`
                : null
            }
          />
          <Row label="Account status" value={r.account_status} />
          <Row label="Account status code" value={r.account_status_code} mono />
          <Row label="Cashfree ref id" value={r.cashfree_ref_id} mono />
          <Row label="UTR (test debit)" value={r.utr} mono />
          <Row label="First verified" value={fmt(r.first_verified_at)} />
          <Row label="Last refreshed" value={fmt(r.last_refreshed_at)} />
          <Row
            label="Bank hash (SHA-256)"
            value={r.bank_hash}
            mono
            wide
            hint="One-way fingerprint of <IFSC>:<account_number> — equality lookups only."
          />
        </div>
      </div>

      {r.ifsc_details && Object.keys(r.ifsc_details).length > 0 && (
        <div>
          <Text
            size="small"
            weight="plus"
            className="uppercase tracking-widest text-ui-fg-muted mb-2"
          >
            IFSC details (Cashfree v2)
          </Text>
          <pre className="text-xs bg-ui-bg-subtle border border-ui-border-base rounded-md p-3 overflow-auto max-h-64">
            {JSON.stringify(r.ifsc_details, null, 2)}
          </pre>
        </div>
      )}

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
              No customer is currently linked to this bank account. Data
              is retained in the global cache; when a customer next
              verifies this account they will be linked automatically.
            </Text>
          </div>
        ) : (
          <Table>
            <Table.Header>
              <Table.Row>
                <Table.HeaderCell>Customer</Table.HeaderCell>
                <Table.HeaderCell>Status</Table.HeaderCell>
                <Table.HeaderCell>Created</Table.HeaderCell>
                <Table.HeaderCell />
              </Table.Row>
            </Table.Header>
            <Table.Body>
              {detail.linked_customers.map((c) => (
                <Table.Row key={c.bank_account_id}>
                  <Table.Cell>
                    <div className="flex flex-col">
                      <Text size="small">
                        {[c.first_name, c.last_name]
                          .filter(Boolean)
                          .join(" ") ||
                          c.account_holder_name ||
                          "(no name)"}
                      </Text>
                      <Text size="xsmall" className="text-ui-fg-subtle">
                        {c.email ?? c.customer_id}
                      </Text>
                      {c.is_primary && (
                        <StatusBadge color="green">primary</StatusBadge>
                      )}
                      {(c.bank_account_deleted_at || c.customer_deleted_at) && (
                        <StatusBadge color="red">deleted</StatusBadge>
                      )}
                    </div>
                  </Table.Cell>
                  <Table.Cell>
                    <StatusBadge
                      color={
                        c.verification_status === "verified"
                          ? "green"
                          : c.verification_status === "name_mismatch"
                            ? "orange"
                            : c.verification_status === "failed"
                              ? "red"
                              : "grey"
                      }
                    >
                      {c.verification_status}
                    </StatusBadge>
                  </Table.Cell>
                  <Table.Cell>
                    <Text size="xsmall" className="text-ui-fg-subtle">
                      {fmt(c.created_at)}
                    </Text>
                  </Table.Cell>
                  <Table.Cell>
                    <a
                      className="text-ui-fg-interactive underline text-xs"
                      href={`/app/customer-360?id=${encodeURIComponent(c.customer_id)}`}
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

      <div>
        <Text
          size="small"
          weight="plus"
          className="uppercase tracking-widest text-ui-fg-muted mb-2"
        >
          Recent verification attempts ({detail.verifications.length})
        </Text>
        {detail.verifications.length === 0 ? (
          <Text size="small" className="text-ui-fg-subtle">
            No bank verification attempts on file for the linked customers.
          </Text>
        ) : (
          <Table>
            <Table.Header>
              <Table.Row>
                <Table.HeaderCell>When</Table.HeaderCell>
                <Table.HeaderCell>Customer</Table.HeaderCell>
                <Table.HeaderCell>Status</Table.HeaderCell>
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

      {r.response_raw && (
        <div>
          <Text
            size="small"
            weight="plus"
            className="uppercase tracking-widest text-ui-fg-muted mb-2"
          >
            Raw Cashfree response
          </Text>
          <pre className="text-xs bg-ui-bg-subtle border border-ui-border-base rounded-md p-3 overflow-auto max-h-96">
            {JSON.stringify(r.response_raw, null, 2)}
          </pre>
        </div>
      )}
    </div>
  )
}

function RevealableValue({
  masked,
  unmasked,
  mono = true,
}: {
  masked: string
  unmasked: string | null
  mono?: boolean
}) {
  const [revealed, setRevealed] = useState(false)
  const canReveal = !!unmasked
  const display = revealed && unmasked ? unmasked : masked
  return (
    <span className="inline-flex items-center gap-2">
      <span className={mono ? "font-mono" : ""}>{display}</span>
      {canReveal && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation()
            setRevealed(!revealed)
          }}
          className="text-ui-fg-subtle hover:text-ui-fg-base transition-colors"
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
      <Text size="xsmall" className="text-ui-fg-subtle uppercase tracking-widest">
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
  label: "Bank registry",
  icon: BuildingTax,
  // Same shelf as PAN / Aadhaar registry — Customer 360.
  nested: "/customers",
})

export default BankRecordsPage
