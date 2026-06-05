import { useEffect, useState } from "react"
import { Container, Heading, StatusBadge, Table, Text } from "@medusajs/ui"
import { adminFetch, formatDate } from "../helpers"

type Props = { customerId: string }

type Entry = {
  id: string
  admin_user_id: string
  action: string
  target_id: string | null
  before_json: Record<string, unknown> | null
  after_json: Record<string, unknown> | null
  note: string | null
  reason_code: string | null
  created_at: string
}

export default function AuditTab({ customerId }: Props) {
  const [rows, setRows] = useState<Entry[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    ;(async () => {
      try {
        const res = await adminFetch<{ entries: Entry[] }>(
          `/admin/customers/${customerId}/audit-log`
        )
        if (alive) setRows(res.entries ?? [])
      } catch (e) {
        if (alive) setError(e instanceof Error ? e.message : "Failed")
      } finally {
        if (alive) setLoading(false)
      }
    })()
    return () => {
      alive = false
    }
  }, [customerId])

  if (loading) return <Text>Loading…</Text>
  if (error) return <Text className="text-ui-fg-error">{error}</Text>

  return (
    <Container className="p-6">
      <Heading level="h3" className="mb-3">
        Audit log ({rows.length})
      </Heading>
      {rows.length === 0 ? (
        <Text className="text-ui-fg-muted">No admin actions recorded.</Text>
      ) : (
        <Table>
          <Table.Header>
            <Table.Row>
              <Table.HeaderCell>When</Table.HeaderCell>
              <Table.HeaderCell>Action</Table.HeaderCell>
              <Table.HeaderCell>Admin</Table.HeaderCell>
              <Table.HeaderCell>Target</Table.HeaderCell>
              <Table.HeaderCell>Reason code</Table.HeaderCell>
              <Table.HeaderCell>Note</Table.HeaderCell>
            </Table.Row>
          </Table.Header>
          <Table.Body>
            {rows.map((e) => (
              <Table.Row key={e.id}>
                <Table.Cell>
                  <Text size="small">{formatDate(e.created_at)}</Text>
                </Table.Cell>
                <Table.Cell>
                  <StatusBadge color="blue">{e.action}</StatusBadge>
                </Table.Cell>
                <Table.Cell>
                  <code className="text-xs">{e.admin_user_id}</code>
                </Table.Cell>
                <Table.Cell>
                  <code className="text-xs">{e.target_id ?? "—"}</code>
                </Table.Cell>
                <Table.Cell>
                  <Text size="small">{e.reason_code ?? "—"}</Text>
                </Table.Cell>
                <Table.Cell>
                  <Text size="small" className="text-ui-fg-muted max-w-xs truncate">
                    {e.note ?? "—"}
                  </Text>
                </Table.Cell>
              </Table.Row>
            ))}
          </Table.Body>
        </Table>
      )}
    </Container>
  )
}
