// @ts-nocheck
import React, { useEffect, useState } from "react"
import { Button, Heading, Input, Label, Select, Switch, Text, toast } from "@medusajs/ui"

type Draft = {
  provider: string
  enabled: boolean
  host: string
  port: string
  username: string
  password: string
  encryption: string
  api_key: string
  region: string
  from_email: string
  from_name: string
  reply_to: string
  test_email: string
}

const empty: Draft = {
  provider: "smtp",
  enabled: false,
  host: "",
  port: "587",
  username: "",
  password: "",
  encryption: "tls",
  api_key: "",
  region: "",
  from_email: "",
  from_name: "",
  reply_to: "",
  test_email: "",
}

export default function EmailSettingsTab() {
  const [draft, setDraft] = useState<Draft>(empty)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    fetch("/admin/communication/email/config", { credentials: "include" })
      .then((r) => r.json())
      .then((v) => setDraft((d) => ({ ...d, ...v, password: "", api_key: "" })))
      .catch((err) => toast.error("Failed to load email settings", { description: err?.message }))
  }, [])

  const save = async () => {
    setSaving(true)
    try {
      const r = await fetch("/admin/communication/email/config", {
        method: "PUT",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(draft),
      })
      if (!r.ok) throw new Error((await r.json()).message || "Save failed")
      toast.success("Email settings saved")
    } catch (err: any) {
      toast.error("Email settings failed", { description: err?.message })
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="flex max-w-4xl flex-col gap-4">
      <div>
        <Heading level="h2">Email provider</Heading>
        <Text size="small" className="text-ui-fg-muted">SMTP, SendGrid, Resend, and AWS SES credentials are encrypted at rest.</Text>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 rounded-lg border border-ui-border-base p-4">
        <Field label="Provider">
          <Select value={draft.provider} onValueChange={(provider) => setDraft({ ...draft, provider })}>
            <Select.Trigger><Select.Value /></Select.Trigger>
            <Select.Content>
              {["smtp", "sendgrid", "resend", "aws_ses"].map((p) => <Select.Item key={p} value={p}>{p}</Select.Item>)}
            </Select.Content>
          </Select>
        </Field>
        <Field label="Enabled"><Switch checked={draft.enabled} onCheckedChange={(enabled) => setDraft({ ...draft, enabled })} /></Field>
        <Field label="From email"><Input value={draft.from_email} onChange={(e) => setDraft({ ...draft, from_email: e.target.value })} /></Field>
        <Field label="From name"><Input value={draft.from_name} onChange={(e) => setDraft({ ...draft, from_name: e.target.value })} /></Field>
        <Field label="Reply to"><Input value={draft.reply_to} onChange={(e) => setDraft({ ...draft, reply_to: e.target.value })} /></Field>
        <Field label="Host"><Input value={draft.host} onChange={(e) => setDraft({ ...draft, host: e.target.value })} /></Field>
        <Field label="Port"><Input value={draft.port} onChange={(e) => setDraft({ ...draft, port: e.target.value })} /></Field>
        <Field label="Encryption"><Input value={draft.encryption} onChange={(e) => setDraft({ ...draft, encryption: e.target.value })} /></Field>
        <Field label="Username"><Input value={draft.username} onChange={(e) => setDraft({ ...draft, username: e.target.value })} /></Field>
        <Field label="Password"><Input type="password" value={draft.password} onChange={(e) => setDraft({ ...draft, password: e.target.value })} placeholder="Leave blank to keep existing" /></Field>
        <Field label="API key"><Input type="password" value={draft.api_key} onChange={(e) => setDraft({ ...draft, api_key: e.target.value })} placeholder="SendGrid/Resend/SES key" /></Field>
        <Field label="AWS region"><Input value={draft.region} onChange={(e) => setDraft({ ...draft, region: e.target.value })} /></Field>
      </div>
      <div className="flex gap-2">
        <Button onClick={save} disabled={saving}>{saving ? "Saving..." : "Save email provider"}</Button>
        <Input className="max-w-xs" placeholder="test@example.com" value={draft.test_email} onChange={(e) => setDraft({ ...draft, test_email: e.target.value })} />
        <Button variant="secondary" onClick={() => fetch("/admin/communication/email/test", { method: "POST", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ to: draft.test_email }) }).then(() => toast.success("Test email queued"))}>Test Email</Button>
      </div>
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <div className="flex flex-col gap-1.5"><Label>{label}</Label>{children}</div>
}
