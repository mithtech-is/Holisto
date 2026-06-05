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
import { Eye, EyeSlash, Key } from "@medusajs/icons"

/**
 * /app/identity-registry — global PAN→client_id→VBA registry.
 *
 * Lists every row in `customer_identity_registry`. One row per real
 * human (per PAN). The row anchors:
 *   - PAN hash + mask
 *   - Cashfree-issued client_id (8-char NNNNYYWW)
 *   - Cashfree VBA (short id + virtual_account_number + IFSC)
 *   - First and current customer ids; release_count + reattach_count
 *     track the lifecycle across hard-deletes.
 *
 * Survives customer deletion. See
 * modules/customer_identity/models/customer-identity-registry.ts.
 */

type IdentityRow = {
  id: string
  pan_hash: string
  pan_masked: string
  pan_full: string | null
  client_id: string
  cashfree_virtual_account_id: string | null
  virtual_account_number: string | null
  ifsc: string | null
  beneficiary_name: string | null
  upi_id: string | null
  first_customer_id: string
  current_customer_id: string | null
  first_provisioned_at: string
  last_attached_at: string
  release_count: number
  reattach_count: number
}

type ListResponse = {
  count: number
  limit: number
  offset: number
  items: IdentityRow[]
}

type HistoryRow = {
  id: string
  customer_id: string
  client_id: string
  email: string | null
  first_name: string | null
  last_name: string | null
  created_at: string
  deleted_at: string | null
  customer_deleted_at: string | null
}

type DetailResponse = {
  identity_registry: IdentityRow
  history: HistoryRow[]
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

function IdentityRegistryPage() {
  const [rows, setRows] = useState<IdentityRow[]>([])
  const [count, setCount] = useState(0)
  const [offset, setOffset] = useState(0)
  const [q, setQ] = useState("")
  const [releasedOnly, setReleasedOnly] = useState(false)
  const [reattachedOnly, setReattachedOnly] = useState(false)
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState<string | null>(null)
  const [detail, setDetail] = useState<DetailResponse | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)

  const url = useMemo(() => {
    const qs = new URLSearchParams()
    if (q.trim()) qs.set("q", q.trim())
    if (releasedOnly) qs.set("released", "1")
    if (reattachedOnly) qs.set("reattached", "1")
    qs.set("limit", String(PAGE_SIZE))
    qs.set("offset", String(offset))
    return `/admin/identity-registry?${qs.toString()}`
  }, [q, releasedOnly, reattachedOnly, offset])

  const load = async () => {
    setLoading(true)
    setErr(null)
    try {
      const r = await fetchJson<ListResponse>(url)
      setRows(r.items)
      setCount(r.count)
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Failed to load identity registry")
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url])

  const openDetail = async (id: string) => {
    setDetailLoading(true)
    setDetail(null)
    setErr(null)
    try {
      const r = await fetchJson<DetailResponse>(`/admin/identity-registry/${id}`)
      setDetail(r)
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Failed to load detail")
    } finally {
      setDetailLoading(false)
    }
  }

  const reset = () => {
    setQ("")
    setReleasedOnly(false)
    setReattachedOnly(false)
    setOffset(0)
  }

  return (
    <Container className="p-6">
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-2">
          <Key />
          <div>
            <Heading level="h1">Identity registry</Heading>
            <Text size="small" className="text-ui-fg-muted">
              One row per real human (per PAN). Anchors PAN →
              client_id → Cashfree VBA. Survives customer deletion;
              re-registration with the same PAN reuses the row and
              increments <code>reattach_count</code>.
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
          <Label size="small">
            Search (PAN mask / client_id / VBA / virtual account / beneficiary)
          </Label>
          <Input
            value={q}
            onChange={(e) => {
              setQ(e.target.value)
              setOffset(0)
            }}
            placeholder="ABCDE****X / 00012618 / Manoj …"
          />
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-4 mb-2">
        <label className="flex items-center gap-2 text-sm text-ui-fg-base cursor-pointer">
          <input
            type="checkbox"
            checked={releasedOnly}
            onChange={(e) => {
              setReleasedOnly(e.target.checked)
              setOffset(0)
            }}
          />
          <span>Released only (no current customer)</span>
        </label>
        <label className="flex items-center gap-2 text-sm text-ui-fg-base cursor-pointer">
          <input
            type="checkbox"
            checked={reattachedOnly}
            onChange={(e) => {
              setReattachedOnly(e.target.checked)
              setOffset(0)
            }}
          />
          <span>Re-attached only (reattach_count &gt; 0)</span>
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
            <Table.HeaderCell>Client ID</Table.HeaderCell>
            <Table.HeaderCell>VBA</Table.HeaderCell>
            <Table.HeaderCell>Beneficiary</Table.HeaderCell>
            <Table.HeaderCell>Released</Table.HeaderCell>
            <Table.HeaderCell>Churn</Table.HeaderCell>
            <Table.HeaderCell>Last attached</Table.HeaderCell>
          </Table.Row>
        </Table.Header>
        <Table.Body>
          {!rows.length && !loading ? (
            <Table.Row>
              <Table.Cell colSpan={7}>
                <Text size="small" className="text-ui-fg-subtle">
                  No identity rows match the current filters.
                </Text>
              </Table.Cell>
            </Table.Row>
          ) : (
            rows.map((r) => {
              const released = !r.current_customer_id
              return (
                <Table.Row
                  key={r.id}
                  className="cursor-pointer"
                  onClick={() => openDetail(r.id)}
                >
                  <Table.Cell>
                    <div
                      onClick={(e) => e.stopPropagation()}
                      className="inline-block"
                    >
                      <RevealableValue
                        masked={r.pan_masked}
                        unmasked={r.pan_full}
                      />
                    </div>
                  </Table.Cell>
                  <Table.Cell>
                    <Text size="xsmall" className="font-mono">
                      {r.client_id}
                    </Text>
                  </Table.Cell>
                  <Table.Cell>
                    <Text size="xsmall" className="font-mono">
                      {r.cashfree_virtual_account_id ?? "—"}
                    </Text>
                    {r.virtual_account_number && (
                      <Text size="xsmall" className="text-ui-fg-subtle font-mono">
                        {r.virtual_account_number}
                      </Text>
                    )}
                  </Table.Cell>
                  <Table.Cell>
                    <Text size="small">{r.beneficiary_name ?? "—"}</Text>
                  </Table.Cell>
                  <Table.Cell>
                    {released ? (
                      <StatusBadge color="orange">released</StatusBadge>
                    ) : (
                      <StatusBadge color="green">attached</StatusBadge>
                    )}
                  </Table.Cell>
                  <Table.Cell>
                    <Text size="xsmall" className="text-ui-fg-subtle">
                      rel {r.release_count} · re-att {r.reattach_count}
                    </Text>
                  </Table.Cell>
                  <Table.Cell>
                    <Text size="xsmall" className="text-ui-fg-subtle">
                      {fmt(r.last_attached_at)}
                    </Text>
                  </Table.Cell>
                </Table.Row>
              )
            })
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
              Identity · PAN {detail?.identity_registry.pan_masked ?? "—"}
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
  const r = detail.identity_registry
  const released = !r.current_customer_id
  return (
    <div className="flex flex-col gap-6">
      <div>
        <Text
          size="small"
          weight="plus"
          className="uppercase tracking-widest text-ui-fg-muted mb-2"
        >
          Identity row
        </Text>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-sm">
          <Row
            label="PAN"
            value={
              <RevealableValue masked={r.pan_masked} unmasked={r.pan_full} />
            }
            hint={
              r.pan_full
                ? "Click the eye to reveal the unmasked PAN."
                : "Plaintext PAN not yet stored for this row — verify or run the backfill to populate."
            }
          />
          <Row label="Client ID" value={r.client_id} mono />
          <Row label="VBA short id" value={r.cashfree_virtual_account_id} mono />
          <Row label="Virtual account number" value={r.virtual_account_number} mono />
          <Row label="IFSC" value={r.ifsc} mono />
          <Row label="Beneficiary name" value={r.beneficiary_name} />
          <Row label="UPI id" value={r.upi_id} mono />
          <Row
            label="Status"
            value={
              released ? (
                <StatusBadge color="orange">released</StatusBadge>
              ) : (
                <StatusBadge color="green">attached</StatusBadge>
              )
            }
          />
          <Row label="First customer" value={r.first_customer_id} mono />
          <Row
            label="Current customer"
            value={
              r.current_customer_id ? (
                <span className="font-mono">{r.current_customer_id}</span>
              ) : (
                <span className="text-ui-fg-subtle">— (released)</span>
              )
            }
          />
          <Row label="Release count" value={r.release_count} />
          <Row label="Reattach count" value={r.reattach_count} />
          <Row label="First provisioned" value={fmt(r.first_provisioned_at)} />
          <Row label="Last attached" value={fmt(r.last_attached_at)} />
          <Row
            label="PAN hash (SHA-256)"
            value={r.pan_hash}
            mono
            wide
            hint="Lookup key — equality only."
          />
        </div>
      </div>

      <div>
        <Text
          size="small"
          weight="plus"
          className="uppercase tracking-widest text-ui-fg-muted mb-2"
        >
          History ({detail.history.length})
        </Text>
        {detail.history.length === 0 ? (
          <Text size="small" className="text-ui-fg-subtle">
            No customer_client_id rows on file for this client_id.
          </Text>
        ) : (
          <Table>
            <Table.Header>
              <Table.Row>
                <Table.HeaderCell>Customer</Table.HeaderCell>
                <Table.HeaderCell>Client ID row created</Table.HeaderCell>
                <Table.HeaderCell>State</Table.HeaderCell>
                <Table.HeaderCell />
              </Table.Row>
            </Table.Header>
            <Table.Body>
              {detail.history.map((h) => {
                const stillLive = !h.deleted_at && !h.customer_deleted_at
                return (
                  <Table.Row key={h.id}>
                    <Table.Cell>
                      <div className="flex flex-col">
                        <Text size="small">
                          {[h.first_name, h.last_name]
                            .filter(Boolean)
                            .join(" ") || "(no name)"}
                        </Text>
                        <Text size="xsmall" className="text-ui-fg-subtle">
                          {h.email ?? h.customer_id}
                        </Text>
                      </div>
                    </Table.Cell>
                    <Table.Cell>
                      <Text size="xsmall" className="text-ui-fg-subtle">
                        {fmt(h.created_at)}
                      </Text>
                    </Table.Cell>
                    <Table.Cell>
                      {stillLive ? (
                        <StatusBadge color="green">live</StatusBadge>
                      ) : h.customer_deleted_at ? (
                        <StatusBadge color="red">customer deleted</StatusBadge>
                      ) : (
                        <StatusBadge color="orange">unlinked</StatusBadge>
                      )}
                    </Table.Cell>
                    <Table.Cell>
                      <a
                        className="text-ui-fg-interactive underline text-xs"
                        href={`/app/customer-360?id=${encodeURIComponent(h.customer_id)}`}
                      >
                        Open Customer 360
                      </a>
                    </Table.Cell>
                  </Table.Row>
                )
              })}
            </Table.Body>
          </Table>
        )}
      </div>
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

/**
 * Inline reveal-toggle for sensitive identifiers. Shows `masked` by
 * default with an eye button that flips to `unmasked` on click. When
 * `unmasked` is null the toggle is hidden — the row predates the
 * pan_full column (run the backfill or wait for re-verify).
 *
 * Mirrors the implementation in admin/routes/pan-records/page.tsx.
 */
function RevealableValue({
  masked,
  unmasked,
}: {
  masked: string
  unmasked: string | null
}) {
  const [revealed, setRevealed] = useState(false)
  const canReveal = !!unmasked
  const display = revealed && unmasked ? unmasked : masked
  return (
    <span className="inline-flex items-center gap-2">
      <span className="font-mono">{display}</span>
      {canReveal && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation()
            setRevealed((v) => !v)
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

export const config = defineRouteConfig({
  label: "Identity registry",
  icon: Key,
  // Same shelf as PAN / Aadhaar / Bank / CMR registry.
  nested: "/customers",
})

export default IdentityRegistryPage
