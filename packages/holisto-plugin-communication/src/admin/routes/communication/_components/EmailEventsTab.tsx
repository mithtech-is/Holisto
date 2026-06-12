// @ts-nocheck
import React, { useCallback, useEffect, useState } from "react"
import { Badge, Button, Container, Heading, Text, Input, Label, Select, Table, toast, Switch, IconButton, Tooltip } from "@medusajs/ui"
import { Trash, PencilSquare, Plus } from "@medusajs/icons"

type EventRule = {
  id: string
  event_name: string
  channel: string
  template_slug: string
  recipient_resolver: string
  static_recipient: string | null
  enabled: boolean
  delay_seconds: number
}

type Channel = "email" | "sms" | "whatsapp"

export default function EmailEventsTab() {
  return <EventRulesList channel="email" title="Email events" />
}

export { EventRulesList as EventTable }

export function EventRulesList({ channel, title }: { channel: Channel; title: string }) {
  const [rules, setRules] = useState<EventRule[]>([])
  const [editing, setEditing] = useState<Partial<EventRule> | null>(null)
  const [saving, setSaving] = useState(false)

  const load = useCallback(async () => {
    try {
      const r = await fetch(`/admin/communication/events?channel=${channel}`, { credentials: "include" })
      const data = await r.json()
      setRules(data.rules || [])
    } catch { toast.error("Failed to load event rules") }
  }, [channel])

  useEffect(() => { load() }, [load])

  const save = async () => {
    if (!editing?.event_name?.trim() || !editing?.template_slug?.trim()) {
      toast.error("Event name and template slug are required")
      return
    }
    setSaving(true)
    try {
      const r = await fetch("/admin/communication/events", {
        method: "PUT",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...editing, channel }),
      })
      if (!r.ok) throw new Error((await r.json()).message || "Save failed")
      toast.success("Event rule saved")
      setEditing(null)
      await load()
    } catch (err: any) { toast.error(err.message) }
    finally { setSaving(false) }
  }

  const deleteRule = async (rule: EventRule) => {
    try {
      const r = await fetch("/admin/communication/events", {
        method: "PUT",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...rule, enabled: false }),
      })
      if (!r.ok) throw new Error("Failed to disable rule")
      toast.success("Rule disabled")
      await load()
    } catch { toast.error("Failed to update rule") }
  }

  const toggleEnabled = async (rule: EventRule) => {
    try {
      const r = await fetch("/admin/communication/events", {
        method: "PUT",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...rule, enabled: !rule.enabled }),
      })
      if (!r.ok) throw new Error("Toggle failed")
      await load()
    } catch { toast.error("Failed to toggle rule") }
  }

  const emptyForm = { event_name: "", template_slug: "", recipient_resolver: "customer", static_recipient: "", enabled: true, delay_seconds: 0 }

  const KNOWN_EVENTS = [
    "customer.created",
    "customer.updated",
    "customer.approved",
    "customer.rejected",
    "order.placed",
    "order.completed",
    "order.cancelled",
    "kyc.approved",
    "kyc.rejected",
    "password.reset",
    "otp.sent",
    "otp.verified",
  ]

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <Heading level="h2">{title}</Heading>
        <Button size="small" onClick={() => setEditing(emptyForm)}><Plus className="mr-1" />Add rule</Button>
      </div>

      {editing && (
        <Container className="border border-ui-border-base p-4">
          <Heading level="h3">{editing.id ? "Edit rule" : "New rule"}</Heading>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mt-3">
            <Field label="Event name">
              <Select value={editing.event_name || ""} onValueChange={(v) => setEditing({ ...editing, event_name: v })}>
                <Select.Trigger><Select.Value placeholder="Select event..." /></Select.Trigger>
                <Select.Content>
                  {KNOWN_EVENTS.map((ev) => <Select.Item key={ev} value={ev}>{ev}</Select.Item>)}
                  <Select.Item value="__custom__">Custom event...</Select.Item>
                </Select.Content>
              </Select>
            </Field>
            <Field label="Template slug"><Input value={editing.template_slug || ""} onChange={(e) => setEditing({ ...editing, template_slug: e.target.value })} /></Field>
            <Field label="Recipient resolver">
              <Select value={editing.recipient_resolver || "customer"} onValueChange={(v) => setEditing({ ...editing, recipient_resolver: v })}>
                <Select.Trigger><Select.Value /></Select.Trigger>
                <Select.Content>
                  {["customer", "customer_email", "customer_phone", "admin_email", "admin_phone", "static_email", "static_phone"].map((r) => (
                    <Select.Item key={r} value={r}>{r}</Select.Item>
                  ))}
                </Select.Content>
              </Select>
            </Field>
            <Field label="Static recipient (if resolver is static)">
              <Input value={editing.static_recipient || ""} onChange={(e) => setEditing({ ...editing, static_recipient: e.target.value || null })} />
            </Field>
            <Field label="Delay (seconds)">
              <Input type="number" value={String(editing.delay_seconds || 0)} onChange={(e) => setEditing({ ...editing, delay_seconds: Number(e.target.value) })} />
            </Field>
            <Field label="Enabled">
              <Switch checked={editing.enabled ?? true} onCheckedChange={(v) => setEditing({ ...editing, enabled: v })} />
            </Field>
          </div>
          <div className="flex gap-2 mt-4">
            <Button onClick={save} disabled={saving}>{saving ? "Saving..." : "Save"}</Button>
            <Button variant="secondary" onClick={() => setEditing(null)}>Cancel</Button>
          </div>
        </Container>
      )}

      <Table>
        <Table.Header>
          <Table.Row>
            <Table.HeaderCell>Event</Table.HeaderCell>
            <Table.HeaderCell>Template</Table.HeaderCell>
            <Table.HeaderCell>Recipient</Table.HeaderCell>
            <Table.HeaderCell>Status</Table.HeaderCell>
            <Table.HeaderCell>Actions</Table.HeaderCell>
          </Table.Row>
        </Table.Header>
        <Table.Body>
          {rules.map((rule) => (
            <Table.Row key={rule.id}>
              <Table.Cell><Badge size="small">{rule.event_name}</Badge></Table.Cell>
              <Table.Cell>{rule.template_slug}</Table.Cell>
              <Table.Cell>{rule.static_recipient || rule.recipient_resolver}</Table.Cell>
              <Table.Cell>
                <Switch checked={rule.enabled} onCheckedChange={() => toggleEnabled(rule)} />
              </Table.Cell>
              <Table.Cell>
                <div className="flex gap-1">
                  <Tooltip content="Edit"><IconButton size="small" onClick={() => setEditing(rule)}><PencilSquare /></IconButton></Tooltip>
                  <Tooltip content="Disable"><IconButton size="small" onClick={() => deleteRule(rule)}><Trash /></IconButton></Tooltip>
                </div>
              </Table.Cell>
            </Table.Row>
          ))}
        </Table.Body>
      </Table>
      {rules.length === 0 && <Text className="text-ui-fg-muted">No event rules configured.</Text>}
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <div className="flex flex-col gap-1"><Label>{label}</Label>{children}</div>
}
