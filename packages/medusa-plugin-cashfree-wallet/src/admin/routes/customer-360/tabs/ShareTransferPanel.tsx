import { useEffect, useState } from "react"
import { Button, StatusBadge, Text } from "@medusajs/ui"
import { adminFetch, formatDate } from "../helpers"

type Props = { orderId: string }

type ShareTransferRow = {
  id: string
  order_id: string
  status:
    | "order_authorised"
    | "shares_received_in_ops"
    | "boid_added_as_beneficiary"
    | "shares_transferred"
    | "cancelled"
  actor_user_id: string
  at_time: string
  cancellation_reason: string | null
  transitions:
    | Array<{
        status: string
        actor_user_id: string
        at_time: string
        note?: string | null
      }>
    | null
  created_at: string
  updated_at: string
}

const STEPS: Array<{
  key: ShareTransferRow["status"]
  label: string
  short: string
}> = [
  { key: "order_authorised", label: "Order authorised", short: "Authorised" },
  {
    key: "shares_received_in_ops",
    label: "Shares received in operations",
    short: "Shares received",
  },
  {
    key: "boid_added_as_beneficiary",
    label: "BOID added as beneficiary",
    short: "BOID added",
  },
  {
    key: "shares_transferred",
    label: "Shares transferred to demat",
    short: "Transferred",
  },
]

const NEXT_OF: Record<string, ShareTransferRow["status"] | null> = {
  order_authorised: "shares_received_in_ops",
  shares_received_in_ops: "boid_added_as_beneficiary",
  boid_added_as_beneficiary: "shares_transferred",
  shares_transferred: null,
  cancelled: null,
}

export default function ShareTransferPanel({ orderId }: Props) {
  const [row, setRow] = useState<ShareTransferRow | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState<"advance" | "cancel" | null>(null)
  const [note, setNote] = useState("")
  const [cancelReason, setCancelReason] = useState("")
  const [showCancel, setShowCancel] = useState(false)

  const load = async () => {
    setLoading(true)
    setError(null)
    try {
      const r = await adminFetch<{ share_transfer: ShareTransferRow }>(
        `/admin/share-transfers/${orderId}`,
      )
      setRow(r.share_transfer)
    } catch (e: any) {
      // 404 just means the share_transfer_status row hasn't been
      // created yet (subscriber hasn't fired). Render an empty state
      // instead of an angry red error.
      const msg = e?.message || ""
      if (/no share_transfer_status row/i.test(msg) || /404/.test(msg)) {
        setRow(null)
      } else {
        setError(msg || "Failed to load share transfer status")
      }
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orderId])

  const advance = async () => {
    if (!row) return
    const next = NEXT_OF[row.status]
    if (!next) return
    setBusy("advance")
    try {
      const r = await adminFetch<{ share_transfer: ShareTransferRow }>(
        `/admin/share-transfers/${orderId}`,
        {
          method: "POST",
          body: JSON.stringify({
            next_status: next,
            note: note.trim() || null,
          }),
        },
      )
      setRow(r.share_transfer)
      setNote("")
    } catch (e: any) {
      alert(e?.message ?? "Advance failed")
    } finally {
      setBusy(null)
    }
  }

  const cancel = async () => {
    if (!row) return
    if (cancelReason.trim().length < 3) {
      alert("Please enter a reason (min 3 chars).")
      return
    }
    setBusy("cancel")
    try {
      const r = await adminFetch<{ share_transfer: ShareTransferRow }>(
        `/admin/share-transfers/${orderId}`,
        {
          method: "POST",
          body: JSON.stringify({
            cancel: true,
            reason: cancelReason.trim(),
          }),
        },
      )
      setRow(r.share_transfer)
      setShowCancel(false)
      setCancelReason("")
    } catch (e: any) {
      alert(e?.message ?? "Cancel failed")
    } finally {
      setBusy(null)
    }
  }

  if (loading) {
    return (
      <Text size="small" className="text-ui-fg-subtle">
        Loading transfer status…
      </Text>
    )
  }

  if (error) {
    return (
      <div className="flex items-center gap-2">
        <Text size="small" className="text-ui-fg-error">
          {error}
        </Text>
        <Button size="small" variant="secondary" onClick={load}>
          Retry
        </Button>
      </div>
    )
  }

  if (!row) {
    return (
      <Text size="small" className="text-ui-fg-subtle">
        No share-transfer record yet — it is created automatically when the
        order is placed.
      </Text>
    )
  }

  const isCancelled = row.status === "cancelled"
  const isTerminal = isCancelled || row.status === "shares_transferred"
  const currentIdx = isCancelled
    ? -1
    : STEPS.findIndex((s) => s.key === row.status)
  const transitionByStatus = new Map<string, { at_time: string; actor_user_id: string }>()
  for (const t of row.transitions ?? []) {
    transitionByStatus.set(t.status, {
      at_time: t.at_time,
      actor_user_id: t.actor_user_id,
    })
  }
  // The HEAD row carries the timestamp for the current status.
  transitionByStatus.set(row.status, {
    at_time: row.at_time,
    actor_user_id: row.actor_user_id,
  })

  const next = NEXT_OF[row.status]
  const nextLabel = next
    ? STEPS.find((s) => s.key === next)?.short ?? next
    : null

  return (
    <div className="flex flex-col gap-4 rounded border border-ui-border-base p-3">
      <div className="flex items-center justify-between">
        <Text size="small" className="text-ui-fg-muted font-medium uppercase tracking-widest">
          Share transfer pipeline
        </Text>
        <StatusBadge
          color={
            isCancelled
              ? "red"
              : row.status === "shares_transferred"
                ? "green"
                : "blue"
          }
        >
          {isCancelled ? "cancelled" : row.status}
        </StatusBadge>
      </div>

      {/* Vertical timeline */}
      <ol className="flex flex-col gap-2">
        {STEPS.map((step, idx) => {
          const done = !isCancelled && idx < currentIdx
          const current = !isCancelled && idx === currentIdx
          const pending = isCancelled ? idx > -1 : idx > currentIdx
          const meta = transitionByStatus.get(step.key)
          return (
            <li
              key={step.key}
              className="flex items-start gap-3"
            >
              <div
                className={[
                  "mt-1 h-3 w-3 shrink-0 rounded-full border",
                  done
                    ? "bg-ui-tag-green-bg border-ui-tag-green-border"
                    : current
                      ? "bg-ui-tag-blue-bg border-ui-tag-blue-border animate-pulse"
                      : "bg-ui-bg-base border-ui-border-base",
                ].join(" ")}
              />
              <div className="min-w-0 flex-1">
                <Text
                  size="small"
                  className={pending ? "text-ui-fg-muted" : "text-ui-fg-base font-medium"}
                >
                  {step.label}
                </Text>
                {meta && !pending && (
                  <Text size="xsmall" className="text-ui-fg-subtle">
                    {formatDate(meta.at_time)} · {meta.actor_user_id}
                  </Text>
                )}
              </div>
            </li>
          )
        })}
        {isCancelled && (
          <li className="flex items-start gap-3">
            <div className="mt-1 h-3 w-3 shrink-0 rounded-full bg-ui-tag-red-bg border border-ui-tag-red-border" />
            <div className="min-w-0 flex-1">
              <Text size="small" className="text-ui-fg-base font-medium">
                Cancelled — {row.cancellation_reason || "no reason recorded"}
              </Text>
              <Text size="xsmall" className="text-ui-fg-subtle">
                {formatDate(row.at_time)} · {row.actor_user_id}
              </Text>
            </div>
          </li>
        )}
      </ol>

      {/* Operator controls */}
      {!isTerminal && (
        <div className="flex flex-col gap-2 border-t border-ui-border-base pt-3">
          <div className="flex flex-wrap items-center gap-2">
            <input
              type="text"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Optional note for the audit log"
              className="flex-1 min-w-[200px] rounded border border-ui-border-base bg-ui-bg-base px-2 py-1 text-sm"
              disabled={!!busy}
            />
            <Button
              size="small"
              variant="primary"
              onClick={advance}
              isLoading={busy === "advance"}
              disabled={!!busy || !next}
            >
              Advance to {nextLabel}
            </Button>
            <Button
              size="small"
              variant="danger"
              onClick={() => setShowCancel((v) => !v)}
              disabled={!!busy}
            >
              Cancel order
            </Button>
          </div>
          {showCancel && (
            <div className="flex flex-wrap items-center gap-2 rounded bg-ui-bg-subtle p-2">
              <input
                type="text"
                value={cancelReason}
                onChange={(e) => setCancelReason(e.target.value)}
                placeholder="Reason (required, ≥3 chars)"
                className="flex-1 min-w-[200px] rounded border border-ui-border-base bg-ui-bg-base px-2 py-1 text-sm"
                disabled={!!busy}
              />
              <Button
                size="small"
                variant="danger"
                onClick={cancel}
                isLoading={busy === "cancel"}
                disabled={!!busy || cancelReason.trim().length < 3}
              >
                Confirm cancel
              </Button>
              <Button
                size="small"
                variant="transparent"
                onClick={() => {
                  setShowCancel(false)
                  setCancelReason("")
                }}
                disabled={!!busy}
              >
                Back
              </Button>
            </div>
          )}
        </div>
      )}

      {isTerminal && (
        <Text size="xsmall" className="text-ui-fg-subtle border-t border-ui-border-base pt-3">
          Terminal state — no further transitions are allowed.
        </Text>
      )}
    </div>
  )
}
