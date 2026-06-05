import { useEffect, useState } from "react"
import { Container, Heading, StatusBadge, Table, Text, Button } from "@medusajs/ui"
import { adminFetch, formatInr, formatDate, statusBadgeColor } from "../helpers"

type Props = { customerId: string }

export default function DepositsTab({ customerId }: Props) {
  const [rows, setRows] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = async () => {
    setLoading(true)
    try {
      const res = await adminFetch<{ deposit_proofs: any[] }>(
        `/admin/deposit-proofs?customer_id=${customerId}&limit=100`
      )
      setRows(res.deposit_proofs ?? [])
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed")
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [customerId])

  const decide = async (id: string, decision: "approve" | "reject") => {
    const reason = prompt(`Reason for ${decision}?`)
    if (!reason || reason.trim().length < 4) return
    let creditAmount: number | null = null
    if (decision === "approve") {
      const raw = prompt("Credit amount in ₹ (leave blank to use claimed amount)")
      if (raw && raw.trim()) {
        const n = Number(raw)
        if (!Number.isFinite(n) || n <= 0) {
          alert("Invalid amount")
          return
        }
        creditAmount = n
      }
    }
    try {
      await adminFetch(`/admin/deposit-proofs/${id}/decide`, {
        method: "POST",
        body: JSON.stringify({
          decision,
          reason,
          ...(creditAmount !== null ? { credited_amount_inr: creditAmount } : {}),
        }),
      })
      await load()
    } catch (e) {
      alert(e instanceof Error ? e.message : "Decide failed")
    }
  }

  if (loading) return <Text>Loading…</Text>
  if (error) return <Text className="text-ui-fg-error">{error}</Text>

  return (
    <Container className="p-6">
      <Heading level="h3" className="mb-3">
        Deposit proofs ({rows.length})
      </Heading>
      {rows.length === 0 ? (
        <Text className="text-ui-fg-muted">No deposit proofs submitted.</Text>
      ) : (
        <Table>
          <Table.Header>
            <Table.Row>
              <Table.HeaderCell>When</Table.HeaderCell>
              <Table.HeaderCell className="text-right">Claimed</Table.HeaderCell>
              <Table.HeaderCell className="text-right">Credited</Table.HeaderCell>
              <Table.HeaderCell>UTR</Table.HeaderCell>
              <Table.HeaderCell>Proof</Table.HeaderCell>
              <Table.HeaderCell>Status</Table.HeaderCell>
              <Table.HeaderCell>Actions</Table.HeaderCell>
            </Table.Row>
          </Table.Header>
          <Table.Body>
            {rows.map((p) => (
              <Table.Row key={p.id}>
                <Table.Cell>{formatDate(p.created_at)}</Table.Cell>
                <Table.Cell className="text-right tabular-nums">
                  {formatInr(p.claimed_amount_inr)}
                </Table.Cell>
                <Table.Cell className="text-right tabular-nums">
                  {p.credited_amount_inr
                    ? formatInr(p.credited_amount_inr)
                    : "—"}
                </Table.Cell>
                <Table.Cell>
                  <code className="text-xs">{p.utr ?? "—"}</code>
                </Table.Cell>
                <Table.Cell>
                  {p.proof_file_url ? (
                    <a
                      href={p.proof_file_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-ui-fg-interactive underline text-sm"
                    >
                      View
                    </a>
                  ) : (
                    "—"
                  )}
                </Table.Cell>
                <Table.Cell>
                  <StatusBadge color={statusBadgeColor(p.status)}>
                    {p.status}
                  </StatusBadge>
                </Table.Cell>
                <Table.Cell>
                  {p.status === "pending" && (
                    <div className="flex gap-1">
                      <Button
                        size="small"
                        variant="secondary"
                        onClick={() => decide(p.id, "approve")}
                      >
                        Approve
                      </Button>
                      <Button
                        size="small"
                        variant="danger"
                        onClick={() => decide(p.id, "reject")}
                      >
                        Reject
                      </Button>
                    </div>
                  )}
                </Table.Cell>
              </Table.Row>
            ))}
          </Table.Body>
        </Table>
      )}
    </Container>
  )
}
