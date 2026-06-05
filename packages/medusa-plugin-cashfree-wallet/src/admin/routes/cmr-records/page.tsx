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
import { DocumentText } from "@medusajs/icons"

/**
 * /app/cmr-records — global CMR (Client Master Report) registry.
 *
 * Lists every row in the `cmr_record` table — i.e. every demat
 * account ever ingested through the customer-facing demat-add path,
 * regardless of whether a customer is currently linked.
 *
 * Hashing: SHA-256 of `cdsl|<boid>` for CDSL, `nsdl|<dp_id>|<client_id>`
 * for NSDL. Linked-customer count comes from `demat_account.cmr_hash`.
 *
 * The CMR PDF + the registry row both SURVIVE customer hard-delete
 * (regulator); only the customer-bound `demat_account` row is
 * deleted on erasure. See utils/dpdp/hard-delete-customer.ts.
 */

type CmrRow = {
  id: string
  cmr_hash: string
  depository: "CDSL" | "NSDL"
  cmr_masked: string
  dp_id: string | null
  client_id: string | null
  boid: string | null
  dp_name: string
  account_holder_name: string
  cmr_file_url: string
  name_match_score: number | null
  verification_status: "pending" | "verified" | "failed" | "name_mismatch"
  cashfree_reference_id: string | null
  first_verified_at: string | null
  last_refreshed_at: string | null
  linked_customer_count: number
}

type ListResponse = {
  count: number
  limit: number
  offset: number
  items: CmrRow[]
}

type LinkedCustomer = {
  demat_account_id: string
  customer_id: string
  is_primary: boolean
  verification_status: string
  account_holder_name: string | null
  depository: "CDSL" | "NSDL" | null
  boid: string | null
  dp_id: string | null
  client_id: string | null
  cmr_file_url: string | null
  email: string | null
  first_name: string | null
  last_name: string | null
  created_at: string
  demat_account_deleted_at: string | null
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
  cmr_record: CmrRow & {
    verification_raw?: Record<string, unknown> | null
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

function statusColour(
  s: string | null | undefined,
): "green" | "orange" | "red" | "grey" {
  switch (s) {
    case "verified":
      return "green"
    case "name_mismatch":
      return "orange"
    case "failed":
      return "red"
    default:
      return "grey"
  }
}

function CmrRecordsPage() {
  const [rows, setRows] = useState<CmrRow[]>([])
  const [count, setCount] = useState(0)
  const [offset, setOffset] = useState(0)
  const [q, setQ] = useState("")
  const [orphansOnly, setOrphansOnly] = useState(false)
  const [depository, setDepository] = useState<"" | "CDSL" | "NSDL">("")
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState<string | null>(null)
  const [detail, setDetail] = useState<DetailResponse | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)

  const url = useMemo(() => {
    const qs = new URLSearchParams()
    if (q.trim()) qs.set("q", q.trim())
    if (orphansOnly) qs.set("orphans", "1")
    if (depository) qs.set("depository", depository)
    qs.set("limit", String(PAGE_SIZE))
    qs.set("offset", String(offset))
    return `/admin/cmr-records?${qs.toString()}`
  }, [q, orphansOnly, depository, offset])

  const load = async () => {
    setLoading(true)
    setErr(null)
    try {
      const r = await fetchJson<ListResponse>(url)
      setRows(r.items)
      setCount(r.count)
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Failed to load CMR records")
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
      const r = await fetchJson<DetailResponse>(`/admin/cmr-records/${hash}`)
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
    setDepository("")
    setOffset(0)
  }

  return (
    <Container className="p-6">
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-2">
          <DocumentText />
          <div>
            <Heading level="h1">CMR registry</Heading>
            <Text size="small" className="text-ui-fg-muted">
              Every demat account ever ingested through the demat-add
              path. Keyed by SHA-256 of the depository fingerprint
              (cdsl|&lt;boid&gt; or nsdl|&lt;dp_id&gt;|&lt;client_id&gt;).
              The CMR PDF + this row both survive customer hard-delete
              per SEBI retention.
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
          <Label size="small">Search (DP / holder / BOID / DP-ID / Client / mask)</Label>
          <Input
            value={q}
            onChange={(e) => {
              setQ(e.target.value)
              setOffset(0)
            }}
            placeholder="Groww / Soubarna / 1208870… / IN30015630 …"
          />
        </div>
        <div>
          <Label size="small">Depository</Label>
          <select
            className="border border-ui-border-base bg-ui-bg-base rounded-md px-2 py-1.5 text-sm w-full"
            value={depository}
            onChange={(e) => {
              setDepository(e.target.value as any)
              setOffset(0)
            }}
          >
            <option value="">Any</option>
            <option value="CDSL">CDSL</option>
            <option value="NSDL">NSDL</option>
          </select>
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
            <Table.HeaderCell>CMR mask</Table.HeaderCell>
            <Table.HeaderCell>Depository</Table.HeaderCell>
            <Table.HeaderCell>DP · Holder</Table.HeaderCell>
            <Table.HeaderCell>Status</Table.HeaderCell>
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
                  No CMR records match the current filters.
                </Text>
              </Table.Cell>
            </Table.Row>
          ) : (
            rows.map((r) => (
              <Table.Row
                key={r.id}
                className="cursor-pointer"
                onClick={() => openDetail(r.cmr_hash)}
              >
                <Table.Cell>
                  <Text size="small" weight="plus" className="font-mono">
                    {r.cmr_masked}
                  </Text>
                </Table.Cell>
                <Table.Cell>
                  <Text size="xsmall" className="font-mono">
                    {r.depository}
                  </Text>
                </Table.Cell>
                <Table.Cell>
                  <Text size="small">{r.dp_name}</Text>
                  <Text size="xsmall" className="text-ui-fg-subtle">
                    {r.account_holder_name}
                  </Text>
                </Table.Cell>
                <Table.Cell>
                  <StatusBadge color={statusColour(r.verification_status)}>
                    {r.verification_status}
                  </StatusBadge>
                </Table.Cell>
                <Table.Cell>
                  <Text size="xsmall">
                    {typeof r.name_match_score === "number"
                      ? `${r.name_match_score}%`
                      : "—"}
                  </Text>
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
              CMR · {detail?.cmr_record.cmr_masked ?? "—"}
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
  const r = detail.cmr_record
  return (
    <div className="flex flex-col gap-6">
      <div>
        <Text
          size="small"
          weight="plus"
          className="uppercase tracking-widest text-ui-fg-muted mb-2"
        >
          CMR record
        </Text>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-sm">
          <Row label="CMR mask" value={r.cmr_masked} mono />
          <Row label="Depository" value={r.depository} mono />
          <Row label="DP name" value={r.dp_name} />
          <Row label="Account holder" value={r.account_holder_name} />
          <Row label="BOID" value={r.boid} mono />
          <Row label="DP-ID" value={r.dp_id} mono />
          <Row label="Client ID" value={r.client_id} mono />
          <Row
            label="Verification status"
            value={
              <StatusBadge color={statusColour(r.verification_status)}>
                {r.verification_status}
              </StatusBadge>
            }
          />
          <Row
            label="Name match"
            value={
              typeof r.name_match_score === "number"
                ? `${r.name_match_score}%`
                : null
            }
          />
          <Row label="Cashfree ref id" value={r.cashfree_reference_id} mono />
          <Row label="First verified" value={fmt(r.first_verified_at)} />
          <Row label="Last refreshed" value={fmt(r.last_refreshed_at)} />
          <Row
            label="CMR PDF"
            value={
              r.cmr_file_url ? (
                <a
                  className="text-ui-fg-interactive underline text-xs"
                  href={r.cmr_file_url}
                  target="_blank"
                  rel="noreferrer"
                >
                  Open PDF
                </a>
              ) : null
            }
            wide
          />
          <Row
            label="CMR hash (SHA-256)"
            value={r.cmr_hash}
            mono
            wide
            hint="One-way fingerprint of cdsl|<boid> or nsdl|<dp_id>|<client_id> — equality lookups only."
          />
        </div>
      </div>

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
              No customer is currently linked to this CMR. Data is
              retained in the global registry; when a customer next
              adds this demat they will be linked automatically.
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
                <Table.Row key={c.demat_account_id}>
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
                      {(c.demat_account_deleted_at || c.customer_deleted_at) && (
                        <StatusBadge color="red">deleted</StatusBadge>
                      )}
                    </div>
                  </Table.Cell>
                  <Table.Cell>
                    <StatusBadge color={statusColour(c.verification_status)}>
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
            No CMR verification attempts on file for the linked customers.
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

      {r.verification_raw && (
        <div>
          <Text
            size="small"
            weight="plus"
            className="uppercase tracking-widest text-ui-fg-muted mb-2"
          >
            Raw verification payload
          </Text>
          <pre className="text-xs bg-ui-bg-subtle border border-ui-border-base rounded-md p-3 overflow-auto max-h-96">
            {JSON.stringify(r.verification_raw, null, 2)}
          </pre>
        </div>
      )}
    </div>
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
  label: "CMR registry",
  icon: DocumentText,
  // Same shelf as PAN / Aadhaar / Bank registry.
  nested: "/customers",
})

export default CmrRecordsPage
