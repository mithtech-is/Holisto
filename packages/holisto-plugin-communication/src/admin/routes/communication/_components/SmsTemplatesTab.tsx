// @ts-nocheck
import React, { useEffect, useMemo, useState } from "react"
import {
    Button,
    Heading,
    Text,
    Table,
    StatusBadge,
    Input,
    Label,
    Select,
    Switch,
    Drawer,
    toast,
} from "@medusajs/ui"

/**
 * SMS template registry editor.
 *
 * No "push" button here — DLT registration goes through TRAI's portal
 * via MSG91's onboarding partner. Once approved, paste the
 * `dlt_template_id` into the row and flip `dlt_status` to "approved".
 *
 * Backend routes:
 *   GET    /admin/communication/sms-templates
 *   POST   /admin/communication/sms-templates           (upsert)
 *   GET    /admin/communication/sms-templates/:slug
 *   PUT    /admin/communication/sms-templates/:slug
 *   DELETE /admin/communication/sms-templates/:slug
 */

type Variable = {
    key: string
    sample: string
    description?: string
    required?: boolean
}

type Row = {
    id: string
    slug: string
    label: string | null
    description: string | null
    body: string
    variables: Variable[] | null
    dlt_template_id: string | null
    dlt_status: "draft" | "pending" | "approved" | "rejected"
    dlt_last_error: string | null
    is_otp: boolean
    is_system: boolean
    created_at: string
    updated_at: string
}

const STATUS_COLOR: Record<Row["dlt_status"], "green" | "blue" | "red" | "grey"> = {
    approved: "green",
    pending: "blue",
    rejected: "red",
    draft: "grey",
}

const STATUS_LABEL: Record<Row["dlt_status"], string> = {
    approved: "Approved",
    pending: "Pending TRAI",
    rejected: "Rejected",
    draft: "Not registered",
}

export default function SmsTemplatesTab() {
    const [rows, setRows] = useState<Row[]>([])
    const [loading, setLoading] = useState(true)
    const [editing, setEditing] = useState<Row | null>(null)
    const [filter, setFilter] = useState<"all" | "otp" | "transactional">(
        "all",
    )

    const load = async () => {
        setLoading(true)
        try {
            const r = await fetch("/admin/communication/sms-templates", {
                credentials: "include",
            })
            const data = await r.json()
            setRows(data.templates || [])
        } catch (err: any) {
            toast.error("Failed to load templates", {
                description: err?.message,
            })
        } finally {
            setLoading(false)
        }
    }

    useEffect(() => {
        load()
    }, [])

    const visibleRows = useMemo(() => {
        if (filter === "otp") return rows.filter((r) => r.is_otp)
        if (filter === "transactional") return rows.filter((r) => !r.is_otp)
        return rows
    }, [rows, filter])

    return (
        <div className="flex flex-col gap-6">
            <div className="flex items-start justify-between gap-4 flex-wrap">
                <div>
                    <Heading level="h2">SMS templates</Heading>
                    <Text className="text-ui-fg-muted" size="small">
                        Your catalog of SMS bodies. Each row needs a
                        DLT-approved template id from MSG91 (TRAI requirement)
                        before it&apos;s used at runtime — paste the id once
                        approved.
                    </Text>
                </div>
            </div>

            <div className="flex items-center gap-3 flex-wrap">
                <Select
                    value={filter}
                    onValueChange={(v) =>
                        setFilter(v as typeof filter)
                    }
                >
                    <Select.Trigger className="w-44">
                        <Select.Value placeholder="Type" />
                    </Select.Trigger>
                    <Select.Content>
                        <Select.Item value="all">All templates</Select.Item>
                        <Select.Item value="otp">OTP only</Select.Item>
                        <Select.Item value="transactional">
                            Transactional
                        </Select.Item>
                    </Select.Content>
                </Select>
                <Button variant="secondary" onClick={load} disabled={loading}>
                    Refresh
                </Button>
                <Button
                    onClick={() =>
                        setEditing({
                            id: "",
                            slug: "",
                            label: null,
                            description: null,
                            body: "",
                            variables: [],
                            dlt_template_id: null,
                            dlt_status: "draft",
                            dlt_last_error: null,
                            is_otp: false,
                            is_system: false,
                            created_at: "",
                            updated_at: "",
                        } as Row)
                    }
                >
                    New template
                </Button>
            </div>

            <div className="overflow-x-auto rounded border border-ui-border-base">
                <Table>
                    <Table.Header>
                        <Table.Row>
                            <Table.HeaderCell>Slug</Table.HeaderCell>
                            <Table.HeaderCell>OTP?</Table.HeaderCell>
                            <Table.HeaderCell>DLT id</Table.HeaderCell>
                            <Table.HeaderCell>Status</Table.HeaderCell>
                            <Table.HeaderCell>Body preview</Table.HeaderCell>
                            <Table.HeaderCell>Actions</Table.HeaderCell>
                        </Table.Row>
                    </Table.Header>
                    <Table.Body>
                        {visibleRows.map((r) => (
                            <Table.Row key={r.id}>
                                <Table.Cell>
                                    <div className="flex flex-col">
                                        <span className="font-mono text-xs">
                                            {r.slug}
                                        </span>
                                        {r.label && (
                                            <span className="text-ui-fg-muted">
                                                {r.label}
                                            </span>
                                        )}
                                    </div>
                                </Table.Cell>
                                <Table.Cell>
                                    {r.is_otp ? "OTP" : "Transactional"}
                                </Table.Cell>
                                <Table.Cell className="font-mono text-xs">
                                    {r.dlt_template_id ?? "—"}
                                </Table.Cell>
                                <Table.Cell>
                                    <StatusBadge color={STATUS_COLOR[r.dlt_status]}>
                                        {STATUS_LABEL[r.dlt_status]}
                                    </StatusBadge>
                                </Table.Cell>
                                <Table.Cell>
                                    <span
                                        className="block max-w-md truncate text-xs"
                                        title={r.body}
                                    >
                                        {r.body}
                                    </span>
                                </Table.Cell>
                                <Table.Cell>
                                    <Button
                                        size="small"
                                        variant="secondary"
                                        onClick={() => setEditing(r)}
                                    >
                                        Edit
                                    </Button>
                                </Table.Cell>
                            </Table.Row>
                        ))}
                        {!loading && visibleRows.length === 0 && (
                            <Table.Row>
                                {/*@ts-ignore*/}<Table.Cell colSpan={6}>
                                    <Text className="text-ui-fg-muted py-6 text-center">
                                        No templates match the current filter.
                                    </Text>
                                </Table.Cell>
                            </Table.Row>
                        )}
                    </Table.Body>
                </Table>
            </div>

            {editing && (
                <SmsTemplateEditor
                    row={editing}
                    onClose={() => setEditing(null)}
                    onSaved={async () => {
                        setEditing(null)
                        await load()
                    }}
                />
            )}
        </div>
    )
}

function SmsTemplateEditor({
    row,
    onClose,
    onSaved,
}: {
    row: Row
    onClose: () => void
    onSaved: () => void
}) {
    const isNew = !row.slug || !row.id
    const [draft, setDraft] = useState<Row>(row)
    const [saving, setSaving] = useState(false)
    const [open, setOpen] = useState(true)

    const save = async () => {
        if (!draft.slug || !draft.body) {
            toast.error("Slug and body are required")
            return
        }
        setSaving(true)
        try {
            const url = isNew
                ? "/admin/communication/sms-templates"
                : `/admin/communication/sms-templates/${encodeURIComponent(draft.slug)}`
            const method = isNew ? "POST" : "PUT"
            const r = await fetch(url, {
                method,
                credentials: "include",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    slug: isNew ? draft.slug : undefined,
                    label: draft.label,
                    description: draft.description,
                    body: draft.body,
                    variables: draft.variables ?? [],
                    dlt_template_id: draft.dlt_template_id,
                    dlt_status: draft.dlt_status,
                    is_otp: draft.is_otp,
                }),
            })
            if (!r.ok) {
                const e = await r.json().catch(() => ({}))
                throw new Error(e.message || `save failed (${r.status})`)
            }
            toast.success("SMS template saved")
            setOpen(false)
            setTimeout(onSaved, 200)
        } catch (err: any) {
            toast.error("Save failed", { description: err?.message })
        } finally {
            setSaving(false)
        }
    }

    const charCount = draft.body.length
    const segments = Math.max(1, Math.ceil(charCount / 160))

    return (
        <Drawer
            open={open}
            onOpenChange={(v) => {
                setOpen(v)
                if (!v) setTimeout(onClose, 200)
            }}
        >
            <Drawer.Content className="max-w-2xl">
                <Drawer.Header>
                    <Drawer.Title>
                        {isNew ? "New SMS template" : `Edit ${draft.slug}`}
                    </Drawer.Title>
                </Drawer.Header>
                <Drawer.Body className="flex flex-col gap-4 overflow-y-auto">
                    {draft.is_system && (
                        <div className="rounded border border-ui-tag-blue-border bg-ui-tag-blue-bg p-3 text-sm">
                            System template. Edits stick across deploys.
                        </div>
                    )}
                    <div className="grid grid-cols-2 gap-4">
                        <Field label="Slug (internal key)">
                            <Input
                                value={draft.slug}
                                disabled={!isNew || draft.is_system}
                                onChange={(e) =>
                                    setDraft({ ...draft, slug: e.target.value })
                                }
                                placeholder="auth.phone_otp_login"
                            />
                        </Field>
                        <Field label="Label (admin display)">
                            <Input
                                value={draft.label ?? ""}
                                onChange={(e) =>
                                    setDraft({
                                        ...draft,
                                        label: e.target.value,
                                    })
                                }
                                placeholder="Phone OTP — login (SMS)"
                            />
                        </Field>
                    </div>
                    <Field label="Description">
                        <Input
                            value={draft.description ?? ""}
                            onChange={(e) =>
                                setDraft({
                                    ...draft,
                                    description: e.target.value,
                                })
                            }
                            placeholder="When this template is sent…"
                        />
                    </Field>
                    <Field
                        label="Body"
                        hint={`Use {{1}}, {{2}}, … placeholders. ${charCount} chars / ${segments} SMS segment${segments === 1 ? "" : "s"}.`}
                    >
                        <textarea
                            value={draft.body}
                            onChange={(e) =>
                                setDraft({ ...draft, body: e.target.value })
                            }
                            rows={4}
                            maxLength={1000}
                            className="w-full rounded border border-ui-border-base bg-ui-bg-base p-2 text-sm font-mono"
                            placeholder="{{1}} is your login OTP. Valid 10 mins. - ACME"
                        />
                    </Field>
                    <Field label="Variables (JSON)">
                        <textarea
                            value={JSON.stringify(draft.variables ?? [], null, 2)}
                            onChange={(e) => {
                                try {
                                    const v = JSON.parse(e.target.value)
                                    setDraft({ ...draft, variables: v })
                                } catch {
                                    /* ignore */
                                }
                            }}
                            rows={5}
                            className="w-full rounded border border-ui-border-base bg-ui-bg-base p-2 text-xs font-mono"
                        />
                    </Field>
                    <div className="grid grid-cols-2 gap-4">
                        <Field
                            label="DLT template id"
                            hint="From MSG91 dashboard after TRAI approval."
                        >
                            <Input
                                value={draft.dlt_template_id ?? ""}
                                onChange={(e) =>
                                    setDraft({
                                        ...draft,
                                        dlt_template_id: e.target.value,
                                    })
                                }
                                placeholder="65f1c…"
                            />
                        </Field>
                        <Field label="DLT status">
                            <Select
                                value={draft.dlt_status}
                                onValueChange={(v) =>
                                    setDraft({
                                        ...draft,
                                        dlt_status: v as Row["dlt_status"],
                                    })
                                }
                            >
                                <Select.Trigger>
                                    <Select.Value />
                                </Select.Trigger>
                                <Select.Content>
                                    <Select.Item value="draft">Draft</Select.Item>
                                    <Select.Item value="pending">
                                        Pending TRAI
                                    </Select.Item>
                                    <Select.Item value="approved">
                                        Approved
                                    </Select.Item>
                                    <Select.Item value="rejected">
                                        Rejected
                                    </Select.Item>
                                </Select.Content>
                            </Select>
                        </Field>
                    </div>
                    <div className="flex items-center gap-3 rounded border border-ui-border-base p-3">
                        <Switch
                            checked={draft.is_otp}
                            onCheckedChange={(v) =>
                                setDraft({ ...draft, is_otp: !!v })
                            }
                        />
                        <Label className="!font-normal">
                            OTP template (uses MSG91&apos;s OTP DLT category — lower
                            latency)
                        </Label>
                    </div>
                </Drawer.Body>
                <Drawer.Footer>
                    <Button variant="secondary" onClick={() => setOpen(false)}>
                        Cancel
                    </Button>
                    <Button onClick={save} disabled={saving}>
                        {saving ? "Saving…" : "Save"}
                    </Button>
                </Drawer.Footer>
            </Drawer.Content>
        </Drawer>
    )
}

function Field({
    label,
    hint,
    children,
}: {
    label: string
    hint?: string
    children: React.ReactNode
}) {
    return (
        <div className="flex flex-col gap-1.5">
            <Label className="font-medium">{label}</Label>
            {children}
            {hint && (
                <Text size="xsmall" className="text-ui-fg-muted">
                    {hint}
                </Text>
            )}
        </div>
    )
}
