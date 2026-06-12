import { useEffect, useState } from "react"
import { Container, Heading, StatusBadge, Table, Text, Button } from "@medusajs/ui"
import { adminFetch, formatDate, statusBadgeColor } from "../helpers"

type Props = { customerId: string }

export default function RequestsTab({ customerId }: Props) {
  const [rows, setRows] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = async () => {
    setLoading(true)
    try {
      const res = await adminFetch<{ requests: any[] }>(
        `/admin/company-requests?customer_id=${customerId}&limit=100`
      )
      setRows(res.requests ?? [])
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
    try {
      await adminFetch(`/admin/company-requests/${id}/decide`, {
        method: "POST",
        body: JSON.stringify({ decision, reason }),
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
        Company requests ({rows.length})
      </Heading>
      {rows.length === 0 ? (
        <Text className="text-ui-fg-muted">No company add requests.</Text>
      ) : (
        <Table>
          <Table.Header>
            <Table.Row>
              <Table.HeaderCell>When</Table.HeaderCell>
              <Table.HeaderCell>Company</Table.HeaderCell>
              <Table.HeaderCell>ISIN</Table.HeaderCell>
              <Table.HeaderCell>Note</Table.HeaderCell>
              <Table.HeaderCell>Status</Table.HeaderCell>
              <Table.HeaderCell>Actions</Table.HeaderCell>
            </Table.Row>
          </Table.Header>
          <Table.Body>
            {rows.map((r) => (
              <Table.Row key={r.id}>
                <Table.Cell>{formatDate(r.created_at)}</Table.Cell>
                <Table.Cell>{r.company_name}</Table.Cell>
                <Table.Cell>
                  <code className="text-xs">{r.isin ?? "—"}</code>
                </Table.Cell>
                <Table.Cell>
                  <Text size="small" className="text-ui-fg-muted max-w-xs truncate">
                    {r.customer_note ?? "—"}
                  </Text>
                </Table.Cell>
                <Table.Cell>
                  <StatusBadge color={statusBadgeColor(r.status)}>
                    {r.status}
                  </StatusBadge>
                </Table.Cell>
                <Table.Cell>
                  {r.status === "pending" && (
                    <div className="flex gap-1">
                      <Button
                        size="small"
                        variant="secondary"
                        onClick={() => decide(r.id, "approve")}
                      >
                        Approve
                      </Button>
                      <Button
                        size="small"
                        variant="danger"
                        onClick={() => decide(r.id, "reject")}
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
