// @ts-nocheck
import React, { useCallback, useEffect, useState } from "react"
import { Badge, Button, Container, Heading, Text, Input, Label, Select, Textarea, Table, toast, Switch, Tooltip, IconButton } from "@medusajs/ui"
import { Trash, PencilSquare, Plus, ArrowPath } from "@medusajs/icons"

type Template = {
  id: string
  slug: string
  label: string
  subject: string
  body: string | null
  html: string | null
  category: string | null
  language: string | null
  is_system: boolean
  enabled: boolean
}

const emptyForm: Partial<Template> = {
  slug: "",
  label: "",
  subject: "",
  body: "",
  html: "",
  category: "transactional",
  language: "en_US",
}

export default function EmailTemplatesTab() {
  const [templates, setTemplates] = useState<Template[]>([])
  const [editing, setEditing] = useState<Partial<Template> | null>(null)
  const [saving, setSaving] = useState(false)

  const load = useCallback(async () => {
    try {
      const r = await fetch("/admin/communication/email-templates?limit=500", { credentials: "include" })
      const data = await r.json()
      setTemplates(data.templates || [])
    } catch { toast.error("Failed to load email templates") }
  }, [])

  useEffect(() => { load() }, [load])

  const save = async () => {
    if (!editing?.slug?.trim()) { toast.error("Slug is required"); return }
    setSaving(true)
    try {
      const r = await fetch("/admin/communication/email-templates", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(editing),
      })
      if (!r.ok) throw new Error((await r.json()).message || "Save failed")
      toast.success("Template saved")
      setEditing(null)
      await load()
    } catch (err: any) { toast.error(err.message) }
    finally { setSaving(false) }
  }

  const deleteTemplate = async (tpl: Template) => {
    if (tpl.is_system) { toast.error("System templates cannot be deleted"); return }
    try {
      const r = await fetch(`/admin/communication/email-templates/${tpl.slug}`, { method: "DELETE", credentials: "include" })
      if (!r.ok) throw new Error("Delete failed")
      toast.success("Template deleted")
      await load()
    } catch { toast.error("Failed to delete template") }
  }

  const refreshSystem = async () => {
    try {
      const r = await fetch("/admin/communication/email-templates/refresh-system", { method: "POST", credentials: "include" })
      const data = await r.json()
      toast.success(`Inserted ${data.inserted}, updated ${data.updated}`)
      await load()
    } catch { toast.error("Failed to refresh system templates") }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <Heading level="h2">Email templates</Heading>
        <div className="flex gap-2">
          <Button variant="secondary" size="small" onClick={refreshSystem}><ArrowPath className="mr-1" />Refresh system</Button>
          <Button size="small" onClick={() => setEditing(emptyForm)}><Plus className="mr-1" />New template</Button>
        </div>
      </div>

      {editing && (
        <Container className="border border-ui-border-base p-4">
          <Heading level="h3">{editing.id ? "Edit template" : "New template"}</Heading>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mt-3">
            <Field label="Slug"><Input value={editing.slug || ""} onChange={(e) => setEditing({ ...editing, slug: e.target.value })} disabled={!!editing.id} /></Field>
            <Field label="Label"><Input value={editing.label || ""} onChange={(e) => setEditing({ ...editing, label: e.target.value })} /></Field>
            <Field label="Subject"><Input value={editing.subject || ""} onChange={(e) => setEditing({ ...editing, subject: e.target.value })} /></Field>
            <Field label="Category"><Input value={editing.category || ""} onChange={(e) => setEditing({ ...editing, category: e.target.value })} /></Field>
            <Field label="Language"><Input value={editing.language || ""} onChange={(e) => setEditing({ ...editing, language: e.target.value })} /></Field>
          </div>
          <div className="mt-3">
            <Label>HTML body</Label>
            <Textarea className="mt-1 font-mono" rows={10} value={editing.html || ""} onChange={(e) => setEditing({ ...editing, html: e.target.value })} />
          </div>
          <div className="mt-3">
            <Label>Text body (plain text fallback)</Label>
            <Textarea className="mt-1 font-mono" rows={4} value={editing.body || ""} onChange={(e) => setEditing({ ...editing, body: e.target.value })} />
          </div>
          {(editing.html || editing.body) && (
            <div className="mt-3">
              <Label>Preview</Label>
              <div className="mt-1 border border-ui-border-base rounded p-3 bg-white max-h-64 overflow-auto">
                <div dangerouslySetInnerHTML={{ __html: editing.html || editing.body || "" }} />
              </div>
            </div>
          )}
          <div className="flex gap-2 mt-4">
            <Button onClick={save} disabled={saving}>{saving ? "Saving..." : "Save"}</Button>
            <Button variant="secondary" onClick={() => setEditing(null)}>Cancel</Button>
          </div>
        </Container>
      )}

      <Table>
        <Table.Header>
          <Table.Row>
            <Table.HeaderCell>Slug</Table.HeaderCell>
            <Table.HeaderCell>Label</Table.HeaderCell>
            <Table.HeaderCell>Subject</Table.HeaderCell>
            <Table.HeaderCell>Type</Table.HeaderCell>
            <Table.HeaderCell>Actions</Table.HeaderCell>
          </Table.Row>
        </Table.Header>
        <Table.Body>
          {templates.map((tpl) => (
            <Table.Row key={tpl.id}>
              <Table.Cell><Badge size="small">{tpl.slug}</Badge></Table.Cell>
              <Table.Cell>{tpl.label || tpl.slug}</Table.Cell>
              <Table.Cell className="max-w-xs truncate">{tpl.subject}</Table.Cell>
              <Table.Cell><Badge color={tpl.is_system ? "blue" : "grey"}>{tpl.is_system ? "system" : "custom"}</Badge></Table.Cell>
              <Table.Cell>
                <div className="flex gap-1">
                  <Tooltip content="Edit"><IconButton size="small" onClick={() => setEditing(tpl)}><PencilSquare /></IconButton></Tooltip>
                  {!tpl.is_system && (
                    <Tooltip content="Delete"><IconButton size="small" onClick={() => deleteTemplate(tpl)}><Trash /></IconButton></Tooltip>
                  )}
                </div>
              </Table.Cell>
            </Table.Row>
          ))}
        </Table.Body>
      </Table>
      {templates.length === 0 && <Text className="text-ui-fg-muted">No email templates configured.</Text>}
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <div className="flex flex-col gap-1"><Label>{label}</Label>{children}</div>
}
