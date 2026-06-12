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
    toast,
} from "@medusajs/ui"

/**
 * Event → WhatsApp template binding manager.
 *
 * Companion to the existing Email "Event mapping" tab — kept on a
 * SEPARATE backend table so an event like `kyc.approved` can fire both
 * an email AND a WhatsApp template independently.
 *
 * Routes:
 *   GET /admin/communication/whatsapp-events
 *   PUT /admin/communication/whatsapp-events    (upsert)
 *   GET /admin/communication/whatsapp-templates (for the slug dropdown)
 */

type Mapping = {
    id: string
    event_name: string
    template_slug: string
    to_resolver: "customer_phone" | "static"
    static_to: string | null
    enabled: boolean
    created_at: string
    updated_at: string
}

type WaTemplate = {
    slug: string
    label: string | null
    polygin_status: "draft" | "pushed" | "approved" | "rejected" | "paused"
}

const STATUS_TONE: Record<WaTemplate["polygin_status"], "green" | "blue" | "red" | "orange" | "grey"> = {
    approved: "green",
    pushed: "blue",
    paused: "orange",
    rejected: "red",
    draft: "grey",
}

export default function WhatsappEventsTab() {
    const [rows, setRows] = useState<Mapping[]>([])
    const [templates, setTemplates] = useState<WaTemplate[]>([])
    const [loading, setLoading] = useState(true)
    const [savingEvent, setSavingEvent] = useState<string | null>(null)
    const [draftEvent, setDraftEvent] = useState("")
    const [draftSlug, setDraftSlug] = useState("")
    const [draftResolver, setDraftResolver] = useState<
        "customer_phone" | "static"
    >("customer_phone")
    const [draftStaticTo, setDraftStaticTo] = useState("")

    const load = async () => {
        setLoading(true)
        try {
            const [r1, r2] = await Promise.all([
                fetch("/admin/communication/whatsapp-events", {
                    credentials: "include",
                }).then((r) => r.json()),
                fetch("/admin/communication/whatsapp-templates", {
                    credentials: "include",
                }).then((r) => r.json()),
            ])
            setRows(r1.mappings || [])
            setTemplates(r2.templates || [])
        } catch (err: any) {
            toast.error("Failed to load WhatsApp events", {
                description: err?.message,
            })
        } finally {
            setLoading(false)
        }
    }

    useEffect(() => {
        load()
    }, [])

    const templateBySlug = useMemo(() => {
        const m = new Map<string, WaTemplate>()
        for (const t of templates) m.set(t.slug, t)
        return m
    }, [templates])

    const update = async (
        event_name: string,
        next: Partial<Mapping>,
    ) => {
        const existing = rows.find((r) => r.event_name === event_name)
        const payload = {
            event_name,
            template_slug: next.template_slug ?? existing?.template_slug,
            to_resolver: next.to_resolver ?? existing?.to_resolver,
            static_to: next.static_to ?? existing?.static_to,
            enabled:
                typeof next.enabled === "boolean"
                    ? next.enabled
                    : existing?.enabled,
        }
        if (!payload.template_slug) {
            toast.error("Pick a template")
            return
        }
        setSavingEvent(event_name)
        try {
            const r = await fetch(
                "/admin/communication/whatsapp-events",
                {
                    method: "PUT",
                    credentials: "include",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify(payload),
                },
            )
            if (!r.ok) {
                const e = await r.json().catch(() => ({}))
                throw new Error(e.message || `save failed (${r.status})`)
            }
            toast.success(`Updated ${event_name}`)
            await load()
        } catch (err: any) {
            toast.error("Save failed", { description: err?.message })
        } finally {
            setSavingEvent(null)
        }
    }

    const addBinding = async (e: React.FormEvent) => {
        e.preventDefault()
        if (!draftEvent || !draftSlug) {
            toast.error("Event name and template are required")
            return
        }
        await update(draftEvent, {
            template_slug: draftSlug,
            to_resolver: draftResolver,
            static_to: draftResolver === "static" ? draftStaticTo : null,
            enabled: true,
        })
        setDraftEvent("")
        setDraftSlug("")
        setDraftStaticTo("")
        setDraftResolver("customer_phone")
    }

    return (
        <div className="flex flex-col gap-6 max-w-4xl">
            <div>
                <Heading level="h2">WhatsApp event bindings</Heading>
                <Text className="text-ui-fg-muted" size="small">
                    Bind a domain event (KYC approved, order placed,
                    etc.) to a WhatsApp template. Email bindings live on the
                    separate <b>Event mapping</b> tab — both fire independently
                    for the same event.
                </Text>
            </div>

            <div className="rounded-lg border border-ui-tag-blue-border bg-ui-tag-blue-bg p-3 text-sm">
                Auth-OTP events (login / verify) bypass this table entirely —
                the OTP send path calls the template by slug directly with the
                generated code, so no event row is needed.
            </div>

            <div className="overflow-x-auto rounded border border-ui-border-base">
                <Table>
                    <Table.Header>
                        <Table.Row>
                            <Table.HeaderCell>Event</Table.HeaderCell>
                            <Table.HeaderCell>Template</Table.HeaderCell>
                            <Table.HeaderCell>Recipient</Table.HeaderCell>
                            <Table.HeaderCell>Static to</Table.HeaderCell>
                            <Table.HeaderCell>Enabled</Table.HeaderCell>
                        </Table.Row>
                    </Table.Header>
                    <Table.Body>
                        {rows.map((r) => {
                            const tpl = templateBySlug.get(r.template_slug)
                            return (
                                <Table.Row key={r.id}>
                                    <Table.Cell className="font-mono text-xs">
                                        {r.event_name}
                                    </Table.Cell>
                                    <Table.Cell>
                                        <div className="flex items-center gap-2">
                                            <Select
                                                value={r.template_slug}
                                                onValueChange={(v) =>
                                                    update(r.event_name, {
                                                        template_slug: v,
                                                    })
                                                }
                                            >
                                                <Select.Trigger className="w-56">
                                                    <Select.Value />
                                                </Select.Trigger>
                                                <Select.Content>
                                                    {templates.map((t) => (
                                                        <Select.Item
                                                            key={t.slug}
                                                            value={t.slug}
                                                        >
                                                            {t.slug}
                                                        </Select.Item>
                                                    ))}
                                                </Select.Content>
                                            </Select>
                                            {tpl && (
                                                <StatusBadge
                                                    color={
                                                        STATUS_TONE[
                                                            tpl.polygin_status
                                                        ]
                                                    }
                                                >
                                                    {tpl.polygin_status}
                                                </StatusBadge>
                                            )}
                                        </div>
                                    </Table.Cell>
                                    <Table.Cell>
                                        <Select
                                            value={r.to_resolver}
                                            onValueChange={(v) =>
                                                update(r.event_name, {
                                                    to_resolver:
                                                        v as Mapping["to_resolver"],
                                                })
                                            }
                                        >
                                            <Select.Trigger className="w-44">
                                                <Select.Value />
                                            </Select.Trigger>
                                            <Select.Content>
                                                <Select.Item value="customer_phone">
                                                    Customer phone
                                                </Select.Item>
                                                <Select.Item value="static">
                                                    Static
                                                </Select.Item>
                                            </Select.Content>
                                        </Select>
                                    </Table.Cell>
                                    <Table.Cell>
                                        {r.to_resolver === "static" ? (
                                            <Input
                                                value={r.static_to ?? ""}
                                                onChange={(e) =>
                                                    update(r.event_name, {
                                                        static_to:
                                                            e.target.value,
                                                    })
                                                }
                                                placeholder="+919876543210"
                                                className="w-44"
                                            />
                                        ) : (
                                            <Text
                                                size="xsmall"
                                                className="text-ui-fg-muted"
                                            >
                                                from event payload
                                            </Text>
                                        )}
                                    </Table.Cell>
                                    <Table.Cell>
                                        <Switch
                                            checked={r.enabled}
                                            onCheckedChange={(v) =>
                                                update(r.event_name, {
                                                    enabled: !!v,
                                                })
                                            }
                                            disabled={
                                                savingEvent === r.event_name
                                            }
                                        />
                                    </Table.Cell>
                                </Table.Row>
                            )
                        })}
                        {!loading && rows.length === 0 && (
                            <Table.Row>
                                {/*@ts-ignore*/}<Table.Cell colSpan={5}>
                                    <Text className="text-ui-fg-muted py-6 text-center">
                                        No WhatsApp event bindings yet.
                                    </Text>
                                </Table.Cell>
                            </Table.Row>
                        )}
                    </Table.Body>
                </Table>
            </div>

            <div className="rounded-lg border border-ui-border-base p-4">
                <Heading level="h3">Add binding</Heading>
                <form onSubmit={addBinding} className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div className="flex flex-col gap-1.5">
                        <Label>Event name</Label>
                        <Input
                            value={draftEvent}
                            onChange={(e) => setDraftEvent(e.target.value)}
                            placeholder="kyc.approved"
                        />
                    </div>
                    <div className="flex flex-col gap-1.5">
                        <Label>Template slug</Label>
                        <Select
                            value={draftSlug}
                            onValueChange={setDraftSlug}
                        >
                            <Select.Trigger>
                                <Select.Value placeholder="Pick a template" />
                            </Select.Trigger>
                            <Select.Content>
                                {templates.map((t) => (
                                    <Select.Item key={t.slug} value={t.slug}>
                                        {t.slug}
                                    </Select.Item>
                                ))}
                            </Select.Content>
                        </Select>
                    </div>
                    <div className="flex flex-col gap-1.5">
                        <Label>Recipient</Label>
                        <Select
                            value={draftResolver}
                            onValueChange={(v) =>
                                setDraftResolver(
                                    v as "customer_phone" | "static",
                                )
                            }
                        >
                            <Select.Trigger>
                                <Select.Value />
                            </Select.Trigger>
                            <Select.Content>
                                <Select.Item value="customer_phone">
                                    Customer phone
                                </Select.Item>
                                <Select.Item value="static">
                                    Static
                                </Select.Item>
                            </Select.Content>
                        </Select>
                    </div>
                    {draftResolver === "static" && (
                        <div className="flex flex-col gap-1.5">
                            <Label>Static recipient</Label>
                            <Input
                                value={draftStaticTo}
                                onChange={(e) =>
                                    setDraftStaticTo(e.target.value)
                                }
                                placeholder="+919876543210"
                            />
                        </div>
                    )}
                    <div className="sm:col-span-2 flex justify-end">
                        <Button type="submit" disabled={!draftEvent || !draftSlug}>
                            Add binding
                        </Button>
                    </div>
                </form>
            </div>
        </div>
    )
}
