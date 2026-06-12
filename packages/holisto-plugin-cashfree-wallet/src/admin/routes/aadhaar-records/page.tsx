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
import { Key, Eye, EyeSlash } from "@medusajs/icons"

/**
 * /app/aadhaar-records — global Aadhaar registry.
 *
 * Lists every row in the `aadhaar_record` table — i.e. every Aadhaar
 * we've ever cached from a Cashfree offline-Aadhaar OTP-verify call,
 * regardless of whether a customer is currently linked.
 *
 * UIDAI compliance: the raw 12-digit Aadhaar is NEVER stored or
 * displayed. Only the masked last-4 form (`XXXX XXXX 9012`) and the
 * SHA-256 hash. The hash is the only equality-check primitive
 * available — admin can confirm "this customer's typed Aadhaar
 * matches this row" via the customer.metadata.aadhaar_hash join.
 */

type AadhaarRow = {
  id: string
  aadhaar_hash: string
  aadhaar_masked: string
  /** Full 12-digit Aadhaar — populated only after a successful OTP
   *  verify (per 2026-04-28 operator decision: stored plaintext;
   *  encryption to follow). Shown directly (full 12-digit) for
   *  successful entries — operator decision to surface the raw
   *  number rather than the masked-with-Reveal pattern PAN uses,
   *  because Aadhaar's audit / compliance flows benefit from a
   *  one-glance match against the typed input. Falls back to
   *  `aadhaar_masked` when this column is null (legacy rows). */
  aadhaar_full: string | null
  name: string
  date_of_birth: string | null
  gender: string | null
  /** Father's / care-of name from Cashfree's verify response. */
  father_name: string | null
  has_photo: boolean | null
  /** Local /static URL of the persisted Aadhaar holder photo
   *  (face crop). New column added 2026-05-04 — older rows have null. */
  photo_url: string | null
  cashfree_ref_id: string | null
  first_verified_at: string | null
  last_refreshed_at: string | null
  linked_customer_count: number
}

type ListResponse = {
  count: number
  limit: number
  offset: number
  items: AadhaarRow[]
}

type LinkedCustomer = {
  id: string
  email: string | null
  first_name: string | null
  last_name: string | null
  created_at: string
  deleted_at: string | null
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
  aadhaar_record: AadhaarRow & {
    address?: Record<string, unknown> | null
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

function AadhaarRecordsPage() {
  const [rows, setRows] = useState<AadhaarRow[]>([])
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
    return `/admin/aadhaar-records?${qs.toString()}`
  }, [q, orphansOnly, offset])

  const load = async () => {
    setLoading(true)
    setErr(null)
    try {
      const r = await fetchJson<ListResponse>(url)
      setRows(r.items)
      setCount(r.count)
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Failed to load Aadhaar records")
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
      const r = await fetchJson<DetailResponse>(`/admin/aadhaar-records/${hash}`)
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
          <Key />
          <div>
            <Heading level="h1">Aadhaar registry</Heading>
            <Text size="small" className="text-ui-fg-muted">
              Every Aadhaar ever cached from Cashfree's offline-Aadhaar
              OTP-verify, regardless of whether a customer is currently
              linked. UIDAI compliance: only the masked last-4 form
              and SHA-256 hash are stored — full Aadhaar number never
              leaves Cashfree's gateway.
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
          <Label size="small">Search (name / masked Aadhaar)</Label>
          <Input
            value={q}
            onChange={(e) => {
              setQ(e.target.value)
              setOffset(0)
            }}
            placeholder="Holder name or last-4 digits…"
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
            <Table.HeaderCell>Photo</Table.HeaderCell>
            <Table.HeaderCell>Aadhaar number</Table.HeaderCell>
            <Table.HeaderCell>Holder name</Table.HeaderCell>
            <Table.HeaderCell>DOB</Table.HeaderCell>
            <Table.HeaderCell>Gender</Table.HeaderCell>
            <Table.HeaderCell>Linked customers</Table.HeaderCell>
            <Table.HeaderCell>Last refreshed</Table.HeaderCell>
          </Table.Row>
        </Table.Header>
        <Table.Body>
          {!rows.length && !loading ? (
            <Table.Row>
              <Table.Cell colSpan={7}>
                <Text size="small" className="text-ui-fg-subtle">
                  No Aadhaar records match the current filters.
                </Text>
              </Table.Cell>
            </Table.Row>
          ) : (
            rows.map((r) => (
              <Table.Row
                key={r.id}
                className="cursor-pointer"
                onClick={() => openDetail(r.aadhaar_hash)}
              >
                <Table.Cell>
                  <AadhaarPhotoThumb url={r.photo_url} alt={r.name} />
                </Table.Cell>
                <Table.Cell>
                  {/* Successful entries store the full 12-digit Aadhaar
                    * plaintext (per 2026-04-28 operator decision). We
                    * surface it directly here for one-glance audit
                    * matching against the typed input. Older / failed
                    * rows that pre-date that decision fall back to the
                    * masked last-4 form. */}
                  <Text size="small" weight="plus" className="font-mono">
                    {r.aadhaar_full ?? r.aadhaar_masked}
                  </Text>
                </Table.Cell>
                <Table.Cell>
                  <Text size="small">{r.name}</Text>
                </Table.Cell>
                <Table.Cell>
                  <Text size="xsmall" className="text-ui-fg-subtle">
                    {r.date_of_birth ?? "—"}
                  </Text>
                </Table.Cell>
                <Table.Cell>
                  <Text size="xsmall" className="text-ui-fg-subtle">
                    {r.gender ?? "—"}
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
              Aadhaar {detail?.aadhaar_record.aadhaar_masked ?? "…"}
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
  const r = detail.aadhaar_record
  const addr =
    (r.address as any)?.full_address ??
    [
      (r.address as any)?.house,
      (r.address as any)?.street,
      (r.address as any)?.locality,
      (r.address as any)?.vtc,
      (r.address as any)?.district,
      (r.address as any)?.state,
      (r.address as any)?.pincode,
      (r.address as any)?.country,
    ]
      .filter(Boolean)
      .join(", ")

  return (
    <div className="flex flex-col gap-6">
      <div>
        <Text
          size="small"
          weight="plus"
          className="uppercase tracking-widest text-ui-fg-muted mb-2"
        >
          Aadhaar record
        </Text>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-sm">
          <Row
            label="Aadhaar number"
            value={
              <span className="font-mono">
                {r.aadhaar_full ?? r.aadhaar_masked}
              </span>
            }
          />
          <Row label="Holder name" value={r.name} />
          <Row label="Father / care-of" value={r.father_name} />
          <Row label="Date of birth" value={r.date_of_birth} />
          <Row label="Gender" value={r.gender} />
          {r.photo_url ? (
            <div className="md:col-span-2">
              <Text
                size="xsmall"
                className="text-ui-fg-subtle uppercase tracking-widest mb-1"
              >
                Aadhaar photo
              </Text>
              <img
                src={r.photo_url}
                alt={`Aadhaar photo of ${r.name}`}
                className="h-32 w-32 rounded-md border border-ui-border-base bg-ui-bg-subtle object-cover"
              />
            </div>
          ) : (
            <Row
              label="Photo on file"
              value={
                typeof r.has_photo === "boolean"
                  ? r.has_photo
                    ? "Yes (pre-2026-05-04 record — bytes not retained)"
                    : "No"
                  : null
              }
            />
          )}
          <Row label="Address" value={addr || null} wide />
          <Row label="Cashfree ref id" value={r.cashfree_ref_id} mono />
          <Row label="First verified" value={fmt(r.first_verified_at)} />
          <Row label="Last refreshed" value={fmt(r.last_refreshed_at)} />
          <Row
            label="Aadhaar hash (SHA-256)"
            value={r.aadhaar_hash}
            mono
            wide
            hint="One-way fingerprint of the typed Aadhaar — equality lookups only, not reversible"
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
              No customer is currently linked to this Aadhaar. Data is
              retained in the global cache; when a customer next
              completes OTP verification with this Aadhaar they will be
              linked automatically.
            </Text>
          </div>
        ) : (
          <Table>
            <Table.Header>
              <Table.Row>
                <Table.HeaderCell>Customer</Table.HeaderCell>
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
            No Aadhaar verification attempts on file for the linked
            customers.
          </Text>
        ) : (
          <Table>
            <Table.Header>
              <Table.Row>
                <Table.HeaderCell>When</Table.HeaderCell>
                <Table.HeaderCell>Customer</Table.HeaderCell>
                <Table.HeaderCell>Kind</Table.HeaderCell>
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
                    <Text size="xsmall">
                      {v.kind === "aadhaar_otp_send"
                        ? "OTP sent"
                        : "OTP verify"}
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

/**
 * Small avatar-style thumbnail of the Aadhaar holder's face crop,
 * rendered in the registry list. Falls back to a coloured initial
 * tile when no photo is on file (legacy rows pre-2026-05-04, or
 * Cashfree didn't return a photo). Click on the row still opens the
 * detail drawer — this stays purely visual.
 */
function AadhaarPhotoThumb({
  url,
  alt,
}: {
  url: string | null
  alt: string
}) {
  if (url) {
    return (
      <img
        src={url}
        alt={alt}
        className="h-9 w-9 rounded-full border border-ui-border-base object-cover bg-ui-bg-subtle"
      />
    )
  }
  const initial = (alt || "?").trim().charAt(0).toUpperCase() || "?"
  return (
    <div className="h-9 w-9 rounded-full border border-ui-border-base bg-ui-bg-subtle flex items-center justify-center text-xs text-ui-fg-muted">
      {initial}
    </div>
  )
}

/**
 * Reveal-toggle for Aadhaar (and other sensitive identifiers).
 * Default-masked; click eye to flip to unmasked. `unmasked` may be
 * null (record predates plaintext storage) — in that case the eye
 * button is hidden. Same semantics as the PAN registry's component.
 */
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
  label: "Aadhaar registry",
  icon: Key,
  // Sidebar nest under native Customers — same shelf as Customer 360
  // and PAN registry. Medusa Admin SDK whitelists only 6 native parents;
  // /customer-360 isn't on that list, so we anchor at /customers.
  nested: "/customers",
})

export default AadhaarRecordsPage
