import { useEffect, useState } from "react"
import { Container, Heading, StatusBadge, Table, Text, Button } from "@medusajs/ui"
import {
  adminFetch,
  formatInr,
  formatInrFromRupees,
  formatDate,
  statusBadgeColor,
} from "../helpers"
import ShareTransferPanel from "./ShareTransferPanel"

type Props = { customerId: string }

export default function OrdersTab({ customerId }: Props) {
  const [orders, setOrders] = useState<any[]>([])
  const [held, setHeld] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [expanded, setExpanded] = useState<Record<string, boolean>>({})

  const load = async () => {
    setLoading(true)
    try {
      const [o, h] = await Promise.all([
        adminFetch<{ orders: any[] }>(
          `/admin/orders?customer_id=${customerId}&limit=100`
        ).catch(() => ({ orders: [] })),
        adminFetch<{ held_orders: any[] }>(
          `/admin/held-orders?customer_id=${customerId}&limit=50`
        ).catch(() => ({ held_orders: [] })),
      ])
      setOrders(o.orders ?? [])
      setHeld(h.held_orders ?? [])
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

  const cancelHeld = async (id: string) => {
    if (!confirm("Cancel this held order?")) return
    try {
      await adminFetch(`/admin/held-orders/${id}/cancel`, { method: "POST" })
      await load()
    } catch (e) {
      alert(e instanceof Error ? e.message : "Cancel failed")
    }
  }

  if (loading) return <Text>Loading…</Text>
  if (error) return <Text className="text-ui-fg-error">{error}</Text>

  return (
    <div className="flex flex-col gap-4">
      <Container className="p-6">
        <Heading level="h3" className="mb-3">
          Held orders ({held.length})
        </Heading>
        {held.length === 0 ? (
          <Text className="text-ui-fg-muted">No held orders.</Text>
        ) : (
          <Table>
            <Table.Header>
              <Table.Row>
                <Table.HeaderCell>When</Table.HeaderCell>
                <Table.HeaderCell>Order</Table.HeaderCell>
                <Table.HeaderCell className="text-right">Required</Table.HeaderCell>
                <Table.HeaderCell className="text-right">Shortfall</Table.HeaderCell>
                <Table.HeaderCell>Status</Table.HeaderCell>
                <Table.HeaderCell>Actions</Table.HeaderCell>
              </Table.Row>
            </Table.Header>
            <Table.Body>
              {held.map((h) => (
                <Table.Row key={h.id}>
                  <Table.Cell>{formatDate(h.created_at)}</Table.Cell>
                  <Table.Cell>
                    <code className="text-xs">{h.order_id ?? h.cart_id}</code>
                  </Table.Cell>
                  <Table.Cell className="text-right tabular-nums">
                    {formatInr(h.required_total_inr ?? h.amount_inr)}
                  </Table.Cell>
                  <Table.Cell className="text-right tabular-nums">
                    {formatInr(
                      h.shortfall_inr_at_creation ?? h.shortfall_inr ?? 0
                    )}
                  </Table.Cell>
                  <Table.Cell>
                    <StatusBadge color={statusBadgeColor(h.status)}>
                      {h.status}
                    </StatusBadge>
                  </Table.Cell>
                  <Table.Cell>
                    {h.status === "awaiting_funds" && (
                      <Button
                        size="small"
                        variant="danger"
                        onClick={() => cancelHeld(h.id)}
                      >
                        Cancel
                      </Button>
                    )}
                  </Table.Cell>
                </Table.Row>
              ))}
            </Table.Body>
          </Table>
        )}
      </Container>

      <Container className="p-6">
        <Heading level="h3" className="mb-3">
          Orders ({orders.length})
        </Heading>
        {orders.length === 0 ? (
          <Text className="text-ui-fg-muted">No orders yet.</Text>
        ) : (
          <Table>
            <Table.Header>
              <Table.Row>
                <Table.HeaderCell>When</Table.HeaderCell>
                <Table.HeaderCell>Display ID</Table.HeaderCell>
                <Table.HeaderCell>Payment</Table.HeaderCell>
                <Table.HeaderCell>Share transfer</Table.HeaderCell>
                <Table.HeaderCell className="text-right">Total</Table.HeaderCell>
              </Table.Row>
            </Table.Header>
            <Table.Body>
              {orders.flatMap((o) => {
                const isOpen = !!expanded[o.id]
                const rows = [
                  <Table.Row key={o.id}>
                    <Table.Cell>{formatDate(o.created_at)}</Table.Cell>
                    <Table.Cell>#{o.display_id}</Table.Cell>
                    <Table.Cell>
                      <StatusBadge color={statusBadgeColor(o.payment_status)}>
                        {o.payment_status}
                      </StatusBadge>
                    </Table.Cell>
                    <Table.Cell>
                      <Button
                        size="small"
                        variant="secondary"
                        onClick={() =>
                          setExpanded((e) => ({ ...e, [o.id]: !e[o.id] }))
                        }
                      >
                        {isOpen ? "Hide pipeline" : "Show pipeline"}
                      </Button>
                    </Table.Cell>
                    <Table.Cell className="text-right tabular-nums">
                      {formatInrFromRupees(o.total)}
                    </Table.Cell>
                  </Table.Row>,
                ]
                if (isOpen) {
                  rows.push(
                    <Table.Row key={`${o.id}-panel`}>
                      <Table.Cell colSpan={5}>
                        <ShareTransferPanel orderId={o.id} />
                      </Table.Cell>
                    </Table.Row>,
                  )
                }
                return rows
              })}
            </Table.Body>
          </Table>
        )}
      </Container>
    </div>
  )
}
