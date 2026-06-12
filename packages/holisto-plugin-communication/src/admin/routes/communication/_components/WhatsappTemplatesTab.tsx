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
    Drawer,
    toast,
} from "@medusajs/ui"

/**
 * Catalog viewer + Polygin-side controls for the store's WhatsApp
 * template registry.
 *
 * Brand fields are managed on the Communication → Brand tab (one
 * source of truth for placeholder substitution). This tab handles
 * everything specific to a template:
 *   - Browse + filter the catalog
 *   - Edit body / variables / category
 *   - Copy brand-resolved fields (for manual recreation on polyg.in)
 *   - Push template content to polyg.in / Meta (when dashboard JWT set)
 *   - Sync status + content from polyg.in (when dashboard JWT set)
 *   - Manually flip status (always available — fallback for the manual
 *     workflow when no dashboard JWT is present)
 *
 * Backend routes:
 *   GET    /admin/communication/whatsapp-templates
 *   POST   /admin/communication/whatsapp-templates              (upsert)
 *   GET    /admin/communication/whatsapp-templates/:slug
 *   PUT    /admin/communication/whatsapp-templates/:slug
 *   DELETE /admin/communication/whatsapp-templates/:slug
 *   GET    /admin/communication/whatsapp-templates/:slug/preview
 *   POST   /admin/communication/whatsapp-templates/:slug/push    (needs dashboard JWT)
 *   POST   /admin/communication/whatsapp-templates/sync          (needs dashboard JWT)
 *   GET    /admin/communication/polygin/config                   (gates push/sync)
 */

const POLYGIN_TEMPLATE_EDITOR_URL =
    "https://polyg.in/user/?page=create-meta-template"

type Component =
    | { type: "HEADER"; format?: string; text?: string; example?: any }
    | { type: "BODY"; text: string; example?: any }
    | { type: "FOOTER"; text: string }
    | {
          type: "BUTTONS"
          buttons: Array<{
              type: "QUICK_REPLY" | "URL" | "PHONE_NUMBER"
              text: string
              url?: string
              phone_number?: string
          }>
      }

type Variable = {
    key: string
    sample: string
    description?: string
    required?: boolean
}

type Row = {
    id: string
    slug: string
    name: string
    label: string | null
    description: string | null
    category: "AUTHENTICATION" | "UTILITY" | "MARKETING"
    language: string
    template_type: string
    components: Component[]
    variables: Variable[] | null
    is_system: boolean
    polygin_status: "draft" | "pushed" | "approved" | "rejected" | "paused"
    polygin_template_id: string | null
    polygin_pushed_at: string | null
    polygin_last_synced_at: string | null
    polygin_last_error: string | null
    created_at: string
    updated_at: string
}

const STATUS_COLOR: Record<Row["polygin_status"], "green" | "blue" | "red" | "orange" | "grey"> = {
    approved: "green",
    pushed: "blue",
    paused: "orange",
    rejected: "red",
    draft: "grey",
}

const STATUS_LABEL: Record<Row["polygin_status"], string> = {
    approved: "Approved",
    pushed: "In review",
    paused: "Paused",
    rejected: "Rejected",
    draft: "Not created",
}

type BrandView = {
    brand_name: string
    storefront_url: string
    support_email: string | null
}

type PreviewVariable = {
    position: number
    placeholder: string
    key: string
    sample: string
    description: string | null
    required: boolean
}

type PreviewView = {
    ok: true
    name: string
    category: string
    language: string
    template_type: string
    components: any[]
    variables: PreviewVariable[]
    brand: BrandView
}

type PolyginGate = {
    token_set: boolean
    dashboard_token_set: boolean
}

export default function WhatsappTemplatesTab() {
    const [rows, setRows] = useState<Row[]>([])
    const [loading, setLoading] = useState(true)
    const [updatingStatusSlug, setUpdatingStatusSlug] = useState<
        string | null
    >(null)
    const [pushingSlug, setPushingSlug] = useState<string | null>(null)
    const [syncing, setSyncing] = useState(false)
    const [editing, setEditing] = useState<Row | null>(null)
    const [previewing, setPreviewing] = useState<Row | null>(null)
    const [filter, setFilter] = useState<"all" | Row["polygin_status"]>("all")
    const [polyginGate, setPolyginGate] = useState<PolyginGate>({
        token_set: false,
        dashboard_token_set: false,
    })

    const load = async () => {
        setLoading(true)
        try {
            const [r1, r2] = await Promise.all([
                fetch("/admin/communication/whatsapp-templates", {
                    credentials: "include",
                }),
                fetch("/admin/communication/polygin/config", {
                    credentials: "include",
                }),
            ])
            const data = await r1.json()
            setRows(data.templates || [])
            const cfg = await r2.json().catch(() => ({}))
            setPolyginGate({
                token_set: !!cfg?.token_set,
                dashboard_token_set: !!cfg?.dashboard_token_set,
            })
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
        if (filter === "all") return rows
        return rows.filter((r) => r.polygin_status === filter)
    }, [rows, filter])

    const onStatusChange = async (
        slug: string,
        next: Row["polygin_status"],
    ) => {
        setUpdatingStatusSlug(slug)
        try {
            const r = await fetch(
                `/admin/communication/whatsapp-templates/${encodeURIComponent(slug)}`,
                {
                    method: "PUT",
                    credentials: "include",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ polygin_status: next }),
                },
            )
            if (!r.ok) {
                const e = await r.json().catch(() => ({}))
                throw new Error(e.message || `update failed (${r.status})`)
            }
            toast.success(`Marked as ${STATUS_LABEL[next]}`)
            await load()
        } catch (err: any) {
            toast.error("Status update failed", {
                description: err?.message,
            })
        } finally {
            setUpdatingStatusSlug(null)
        }
    }

    const onPush = async (slug: string) => {
        setPushingSlug(slug)
        try {
            const r = await fetch(
                `/admin/communication/whatsapp-templates/${encodeURIComponent(slug)}/push`,
                { method: "POST", credentials: "include" },
            )
            const data = await r.json().catch(() => ({}))
            if (!r.ok || data.ok === false) {
                throw new Error(data.message || `push failed (${r.status})`)
            }
            toast.success("Pushed to polyg.in", {
                description:
                    "Template submitted to Meta for review. Click Sync after a few minutes to refresh status.",
            })
            await load()
        } catch (err: any) {
            toast.error("Push failed", { description: err?.message })
        } finally {
            setPushingSlug(null)
        }
    }

    const onSync = async () => {
        setSyncing(true)
        try {
            const r = await fetch(
                "/admin/communication/whatsapp-templates/sync",
                { method: "POST", credentials: "include" },
            )
            const data = await r.json().catch(() => ({}))
            if (!r.ok || data.ok === false) {
                throw new Error(data.message || `sync failed (${r.status})`)
            }
            toast.success(`Synced from polyg.in`, {
                description: `${data.updated || 0} template(s) updated.`,
            })
            await load()
        } catch (err: any) {
            toast.error("Sync failed", { description: err?.message })
        } finally {
            setSyncing(false)
        }
    }

    const counts = useMemo(() => {
        const c: Record<Row["polygin_status"] | "total", number> = {
            total: rows.length,
            draft: 0,
            pushed: 0,
            approved: 0,
            rejected: 0,
            paused: 0,
        }
        for (const r of rows) c[r.polygin_status]++
        return c
    }, [rows])

    return (
        <div className="flex flex-col gap-6">
            <div className="flex items-start justify-between gap-4 flex-wrap">
                <div>
                    <Heading level="h2">WhatsApp templates</Heading>
                    <Text className="text-ui-fg-muted" size="small">
                        Your catalog of Meta WhatsApp templates.
                        Brand placeholders ({`{{brand}}`}, etc.) resolve
                        from the <b>Brand</b> tab. Use{" "}
                        <b>Push to polyg.in</b> for automatic submission
                        when the dashboard JWT is set, or <b>Copy for
                        polyg.in</b> for the manual paste flow.
                    </Text>
                </div>
            </div>

            {!polyginGate.dashboard_token_set && (
                <div className="rounded-lg border border-ui-tag-orange-border bg-ui-tag-orange-bg p-3 flex flex-col gap-2">
                    <Text size="small" className="font-medium">
                        Dashboard JWT not set — automatic push + sync are
                        disabled.
                    </Text>
                    <Text size="xsmall" className="text-ui-fg-muted">
                        Manual workflow still works: use <b>Copy for
                        polyg.in</b> on each row, paste into Polygin&apos;s
                        editor, then mark the row Approved when Meta
                        accepts. To enable the automated flow, capture
                        the dashboard JWT — full step-by-step instructions
                        are on the WhatsApp settings tab.
                    </Text>
                    <div>
                        <Button
                            size="small"
                            variant="secondary"
                            onClick={() => {
                                const url = new URL(window.location.href)
                                url.searchParams.set("tab", "whatsapp")
                                window.location.assign(url.toString())
                            }}
                        >
                            Open WhatsApp settings →
                        </Button>
                    </div>
                </div>
            )}

            <div className="flex items-start justify-between gap-4 flex-wrap">
                <div />
                <div className="flex items-center gap-2 flex-wrap">
                    <StatusBadge color="green">
                        {counts.approved} approved
                    </StatusBadge>
                    <StatusBadge color="blue">
                        {counts.pushed} in review
                    </StatusBadge>
                    <StatusBadge color="grey">
                        {counts.draft} not created
                    </StatusBadge>
                    {counts.rejected > 0 && (
                        <StatusBadge color="red">
                            {counts.rejected} rejected
                        </StatusBadge>
                    )}
                    {counts.paused > 0 && (
                        <StatusBadge color="orange">
                            {counts.paused} paused
                        </StatusBadge>
                    )}
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
                        <Select.Value placeholder="Status" />
                    </Select.Trigger>
                    <Select.Content>
                        <Select.Item value="all">All statuses</Select.Item>
                        <Select.Item value="draft">Not created</Select.Item>
                        <Select.Item value="pushed">In review</Select.Item>
                        <Select.Item value="approved">Approved</Select.Item>
                        <Select.Item value="rejected">Rejected</Select.Item>
                        <Select.Item value="paused">Paused</Select.Item>
                    </Select.Content>
                </Select>
                <Button
                    variant="secondary"
                    onClick={onSync}
                    disabled={syncing || !polyginGate.dashboard_token_set}
                    title={
                        polyginGate.dashboard_token_set
                            ? "Pull current status from polyg.in for every template"
                            : "Set the dashboard JWT in WhatsApp settings to enable automatic sync."
                    }
                >
                    {syncing ? "Syncing…" : "Sync from polyg.in"}
                </Button>
                <Button
                    variant="secondary"
                    onClick={() =>
                        window.open(POLYGIN_TEMPLATE_EDITOR_URL, "_blank")
                    }
                >
                    Open polyg.in editor
                </Button>
                <Button variant="secondary" onClick={load} disabled={loading}>
                    Refresh
                </Button>
                <Button
                    onClick={() =>
                        setEditing({
                            id: "",
                            slug: "",
                            name: "",
                            label: null,
                            description: null,
                            category: "UTILITY",
                            language: "en",
                            template_type: "STANDARD",
                            components: [{ type: "BODY", text: "" }],
                            variables: [],
                            is_system: false,
                            polygin_status: "draft",
                            polygin_template_id: null,
                            polygin_pushed_at: null,
                            polygin_last_synced_at: null,
                            polygin_last_error: null,
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
                            <Table.HeaderCell>Meta name</Table.HeaderCell>
                            <Table.HeaderCell>Category</Table.HeaderCell>
                            <Table.HeaderCell>Language</Table.HeaderCell>
                            <Table.HeaderCell>Status</Table.HeaderCell>
                            <Table.HeaderCell className="min-w-[360px]">
                                Actions
                            </Table.HeaderCell>
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
                                <Table.Cell className="font-mono text-xs">
                                    {r.name}
                                </Table.Cell>
                                <Table.Cell>{r.category}</Table.Cell>
                                <Table.Cell>{r.language}</Table.Cell>
                                <Table.Cell>
                                    <div className="flex flex-col gap-1">
                                        <StatusBadge
                                            color={STATUS_COLOR[r.polygin_status]}
                                        >
                                            {STATUS_LABEL[r.polygin_status]}
                                        </StatusBadge>
                                        <Select
                                            value={r.polygin_status}
                                            onValueChange={(v) =>
                                                onStatusChange(
                                                    r.slug,
                                                    v as Row["polygin_status"],
                                                )
                                            }
                                            disabled={
                                                updatingStatusSlug === r.slug
                                            }
                                        >
                                            <Select.Trigger className="w-40 h-7 text-xs">
                                                <Select.Value />
                                            </Select.Trigger>
                                            <Select.Content>
                                                <Select.Item value="draft">
                                                    Not created
                                                </Select.Item>
                                                <Select.Item value="pushed">
                                                    In review
                                                </Select.Item>
                                                <Select.Item value="approved">
                                                    Approved
                                                </Select.Item>
                                                <Select.Item value="rejected">
                                                    Rejected
                                                </Select.Item>
                                                <Select.Item value="paused">
                                                    Paused
                                                </Select.Item>
                                            </Select.Content>
                                        </Select>
                                        {r.polygin_last_error && (
                                            <Text
                                                size="xsmall"
                                                className="font-mono text-ui-fg-error truncate max-w-xs"
                                                title={r.polygin_last_error}
                                            >
                                                {r.polygin_last_error}
                                            </Text>
                                        )}
                                    </div>
                                </Table.Cell>
                                <Table.Cell className="min-w-[360px] whitespace-nowrap">
                                    <div className="flex items-center gap-2">
                                        <Button
                                            size="small"
                                            variant="primary"
                                            onClick={() => onPush(r.slug)}
                                            disabled={
                                                pushingSlug === r.slug ||
                                                !polyginGate.dashboard_token_set ||
                                                r.polygin_status === "approved"
                                            }
                                            title={
                                                !polyginGate.dashboard_token_set
                                                    ? "Set the dashboard JWT in WhatsApp settings to enable Push."
                                                    : r.polygin_status === "approved"
                                                      ? "Already approved on Meta — edit the body first to re-push."
                                                      : "Submit to polyg.in for Meta review"
                                            }
                                        >
                                            {pushingSlug === r.slug
                                                ? "Pushing…"
                                                : r.polygin_status === "approved"
                                                  ? "Approved"
                                                  : r.polygin_status === "draft"
                                                    ? "Push to polyg.in"
                                                    : "Re-push"}
                                        </Button>
                                        <Button
                                            size="small"
                                            variant="secondary"
                                            onClick={() => setPreviewing(r)}
                                        >
                                            Copy for polyg.in
                                        </Button>
                                        <Button
                                            size="small"
                                            variant="secondary"
                                            onClick={() => setEditing(r)}
                                        >
                                            Edit
                                        </Button>
                                    </div>
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
                <TemplateEditor
                    row={editing}
                    onClose={() => setEditing(null)}
                    onSaved={async () => {
                        setEditing(null)
                        await load()
                    }}
                />
            )}

            {previewing && (
                <TemplatePreview
                    slug={previewing.slug}
                    onClose={() => setPreviewing(null)}
                />
            )}
        </div>
    )
}

/* ───────────────── Copy-for-polyg.in modal ──────────────────── */
function TemplatePreview({
    slug,
    onClose,
}: {
    slug: string
    onClose: () => void
}) {
    const [open, setOpen] = useState(true)
    const [data, setData] = useState<PreviewView | null>(null)
    const [loading, setLoading] = useState(true)

    useEffect(() => {
        let cancelled = false
        ;(async () => {
            setLoading(true)
            try {
                const r = await fetch(
                    `/admin/communication/whatsapp-templates/${encodeURIComponent(slug)}/preview`,
                    { credentials: "include" },
                )
                if (!r.ok) {
                    const e = await r.json().catch(() => ({}))
                    throw new Error(e.message || `preview failed (${r.status})`)
                }
                const json = (await r.json()) as PreviewView
                if (!cancelled) setData(json)
            } catch (err: any) {
                if (!cancelled) {
                    toast.error("Couldn't load preview", {
                        description: err?.message,
                    })
                }
            } finally {
                if (!cancelled) setLoading(false)
            }
        })()
        return () => {
            cancelled = true
        }
    }, [slug])

    const copy = async (label: string, value: string) => {
        try {
            await navigator.clipboard.writeText(value)
            toast.success(`Copied ${label}`)
        } catch (err: any) {
            toast.error("Copy failed", { description: err?.message })
        }
    }

    const bodyText = useMemo(() => {
        if (!data) return ""
        const c = (data.components || []).find((x: any) => x?.type === "BODY")
        return (c?.text as string) ?? ""
    }, [data])

    const headerText = useMemo(() => {
        if (!data) return ""
        const c = (data.components || []).find((x: any) => x?.type === "HEADER")
        return (c?.text as string) ?? ""
    }, [data])

    const footerText = useMemo(() => {
        if (!data) return ""
        const c = (data.components || []).find((x: any) => x?.type === "FOOTER")
        return (c?.text as string) ?? ""
    }, [data])

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
                    <Drawer.Title>Copy for polyg.in — {slug}</Drawer.Title>
                </Drawer.Header>
                <Drawer.Body className="flex flex-col gap-4 overflow-y-auto">
                    {loading && (
                        <Text className="text-ui-fg-muted">Loading…</Text>
                    )}
                    {!loading && data && (
                        <>
                            <div className="rounded border border-ui-tag-blue-border bg-ui-tag-blue-bg p-3">
                                <Text size="small" className="font-medium">
                                    How to use this
                                </Text>
                                <Text size="xsmall" className="text-ui-fg-muted">
                                    1. Open{" "}
                                    <a
                                        href="https://polyg.in/user/?page=create-meta-template"
                                        target="_blank"
                                        rel="noreferrer"
                                        className="underline"
                                    >
                                        polyg.in&apos;s template editor
                                    </a>
                                    . 2. Copy each field below into the
                                    matching input. 3. Submit for Meta
                                    review. 4. Once Meta approves, set this
                                    row&apos;s status to <b>Approved</b>.
                                </Text>
                                <Text size="xsmall" className="text-ui-fg-muted mt-2">
                                    Brand applied: <b>{data.brand.brand_name}</b>{" "}
                                    · {data.brand.storefront_url}
                                    {data.brand.support_email
                                        ? ` · ${data.brand.support_email}`
                                        : ""}
                                </Text>
                            </div>

                            <CopyField
                                label="Template name"
                                value={data.name}
                                onCopy={copy}
                            />
                            <CopyField
                                label="Category"
                                value={data.category}
                                onCopy={copy}
                            />
                            <CopyField
                                label="Language"
                                value={data.language}
                                onCopy={copy}
                            />
                            {headerText && (
                                <CopyField
                                    label="Header"
                                    value={headerText}
                                    multiline
                                    onCopy={copy}
                                />
                            )}
                            <CopyField
                                label="Body"
                                value={bodyText}
                                multiline
                                onCopy={copy}
                            />
                            {footerText && (
                                <CopyField
                                    label="Footer"
                                    value={footerText}
                                    multiline
                                    onCopy={copy}
                                />
                            )}

                            {data.variables.length > 0 && (
                                <div className="flex flex-col gap-2">
                                    <Label className="font-medium">
                                        Variables ({data.variables.length})
                                    </Label>
                                    <Text size="xsmall" className="text-ui-fg-muted">
                                        Polygin&apos;s Variables step uses these
                                        sample values for Meta&apos;s template
                                        review. Position numbers map to{" "}
                                        <code>{`{{1}}`}</code>,{" "}
                                        <code>{`{{2}}`}</code> in the body above.
                                    </Text>
                                    <div className="flex flex-col gap-2 rounded border border-ui-border-base p-3">
                                        {data.variables.map((v) => (
                                            <div
                                                key={v.position}
                                                className="grid grid-cols-[auto_1fr_1fr_auto] gap-2 items-center"
                                            >
                                                <code className="text-xs font-mono px-1.5 py-0.5 rounded bg-ui-bg-subtle">
                                                    {v.placeholder}
                                                </code>
                                                <Input
                                                    readOnly
                                                    value={v.key}
                                                    className="text-xs"
                                                />
                                                <Input
                                                    readOnly
                                                    value={v.sample}
                                                    className="text-xs"
                                                />
                                                <Button
                                                    size="small"
                                                    variant="secondary"
                                                    onClick={() =>
                                                        copy(
                                                            `${v.placeholder} sample`,
                                                            v.sample,
                                                        )
                                                    }
                                                >
                                                    Copy sample
                                                </Button>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            )}

                            <CopyField
                                label="Components (full JSON)"
                                value={JSON.stringify(
                                    data.components,
                                    null,
                                    2,
                                )}
                                multiline
                                rows={10}
                                onCopy={copy}
                            />
                        </>
                    )}
                </Drawer.Body>
                <Drawer.Footer>
                    <Button variant="secondary" onClick={() => setOpen(false)}>
                        Close
                    </Button>
                </Drawer.Footer>
            </Drawer.Content>
        </Drawer>
    )
}

function CopyField({
    label,
    value,
    multiline,
    rows,
    onCopy,
}: {
    label: string
    value: string
    multiline?: boolean
    rows?: number
    onCopy: (label: string, value: string) => void
}) {
    return (
        <div className="flex flex-col gap-1.5">
            <div className="flex items-center justify-between gap-2">
                <Label className="font-medium">{label}</Label>
                <Button
                    size="small"
                    variant="secondary"
                    onClick={() => onCopy(label, value)}
                >
                    Copy
                </Button>
            </div>
            {multiline ? (
                <textarea
                    readOnly
                    value={value}
                    rows={rows ?? Math.min(8, Math.max(2, value.split("\n").length))}
                    className="w-full rounded border border-ui-border-base bg-ui-bg-base p-2 text-sm font-mono"
                />
            ) : (
                <Input readOnly value={value} />
            )}
        </div>
    )
}

/* ───────────────── Editor drawer ──────────────────── */
function TemplateEditor({
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
    const [deleting, setDeleting] = useState(false)
    const [open, setOpen] = useState(true)

    const bodyIndex = draft.components.findIndex((c) => c.type === "BODY")
    const bodyText =
        bodyIndex >= 0 ? (draft.components[bodyIndex] as any).text || "" : ""

    const setBody = (text: string) => {
        const next = draft.components.slice()
        if (bodyIndex >= 0) {
            next[bodyIndex] = { ...(next[bodyIndex] as any), text }
        } else {
            next.unshift({ type: "BODY", text })
        }
        setDraft({ ...draft, components: next })
    }

    const save = async () => {
        if (!draft.slug || !draft.name) {
            toast.error("Slug and Meta template name are required")
            return
        }
        setSaving(true)
        try {
            const url = isNew
                ? "/admin/communication/whatsapp-templates"
                : `/admin/communication/whatsapp-templates/${encodeURIComponent(draft.slug)}`
            const method = isNew ? "POST" : "PUT"
            const r = await fetch(url, {
                method,
                credentials: "include",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    slug: isNew ? draft.slug : undefined,
                    name: draft.name,
                    label: draft.label,
                    description: draft.description,
                    category: draft.category,
                    language: draft.language,
                    template_type: draft.template_type,
                    components: draft.components,
                    variables: draft.variables ?? [],
                }),
            })
            if (!r.ok) {
                const e = await r.json().catch(() => ({}))
                throw new Error(e.message || `save failed (${r.status})`)
            }
            toast.success("Template saved")
            setOpen(false)
            setTimeout(onSaved, 200)
        } catch (err: any) {
            toast.error("Save failed", { description: err?.message })
        } finally {
            setSaving(false)
        }
    }

    const remove = async () => {
        if (
            !window.confirm(
                "Delete this template? This is local only — Meta's copy on polyg.in is not affected.",
            )
        )
            return
        setDeleting(true)
        try {
            const r = await fetch(
                `/admin/communication/whatsapp-templates/${encodeURIComponent(draft.slug)}`,
                { method: "DELETE", credentials: "include" },
            )
            const e = await r.json().catch(() => ({}))
            if (!r.ok) throw new Error(e.message || `delete failed (${r.status})`)
            toast.success("Deleted")
            setOpen(false)
            setTimeout(onSaved, 200)
        } catch (err: any) {
            toast.error("Delete failed", { description: err?.message })
        } finally {
            setDeleting(false)
        }
    }

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
                        {isNew ? "New WhatsApp template" : `Edit ${draft.slug}`}
                    </Drawer.Title>
                </Drawer.Header>
                <Drawer.Body className="flex flex-col gap-4 overflow-y-auto">
                    {draft.is_system && (
                        <div className="rounded border border-ui-tag-blue-border bg-ui-tag-blue-bg p-3 text-sm">
                            System template. Edits to body / name / language /
                            category reset the lifecycle to &quot;Not created&quot;
                            — recreate (or push) on polyg.in for Meta to
                            re-approve.
                        </div>
                    )}
                    <div className="grid grid-cols-2 gap-4">
                        <Field label="Slug (internal key)">
                            <Input
                                value={draft.slug}
                                disabled={!isNew || draft.is_system}
                                maxLength={120}
                                onChange={(e) =>
                                    setDraft({ ...draft, slug: e.target.value })
                                }
                                placeholder="auth.phone_otp_login"
                            />
                        </Field>
                        <Field
                            label="Meta template name"
                            hint={`${draft.name.length}/512 — Meta limit. Lowercase letters, digits, underscores only.`}
                        >
                            <Input
                                value={draft.name}
                                maxLength={512}
                                onChange={(e) =>
                                    setDraft({
                                        ...draft,
                                        name: e.target.value
                                            .toLowerCase()
                                            .replace(/[^a-z0-9_]/g, "_"),
                                    })
                                }
                                placeholder="store_phone_otp_login"
                            />
                        </Field>
                        <Field label="Category">
                            <Select
                                value={draft.category}
                                onValueChange={(v) =>
                                    setDraft({
                                        ...draft,
                                        category: v as Row["category"],
                                    })
                                }
                            >
                                <Select.Trigger>
                                    <Select.Value />
                                </Select.Trigger>
                                <Select.Content>
                                    <Select.Item value="AUTHENTICATION">
                                        AUTHENTICATION
                                    </Select.Item>
                                    <Select.Item value="UTILITY">
                                        UTILITY
                                    </Select.Item>
                                    <Select.Item value="MARKETING">
                                        MARKETING
                                    </Select.Item>
                                </Select.Content>
                            </Select>
                        </Field>
                        <Field label="Language">
                            <Input
                                value={draft.language}
                                onChange={(e) =>
                                    setDraft({
                                        ...draft,
                                        language: e.target.value,
                                    })
                                }
                                placeholder="en"
                            />
                        </Field>
                    </div>
                    <Field label="Label (admin display)">
                        <Input
                            value={draft.label ?? ""}
                            maxLength={120}
                            onChange={(e) =>
                                setDraft({ ...draft, label: e.target.value })
                            }
                            placeholder="Phone OTP — login"
                        />
                    </Field>
                    <Field label="Description">
                        <Input
                            value={draft.description ?? ""}
                            maxLength={500}
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
                        hint={`${bodyText.length}/1024 — Meta limit. Use {{1}}, {{2}}, … for variable slots. Match the variable order below.`}
                    >
                        <textarea
                            value={bodyText}
                            onChange={(e) => setBody(e.target.value)}
                            rows={6}
                            maxLength={1024}
                            className="w-full rounded border border-ui-border-base bg-ui-bg-base p-2 text-sm font-mono"
                            placeholder="{{1}} is your {{brand}} verification code."
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
                                    /* ignore parse errors mid-typing */
                                }
                            }}
                            rows={5}
                            className="w-full rounded border border-ui-border-base bg-ui-bg-base p-2 text-xs font-mono"
                        />
                    </Field>
                    <Field label="Components (JSON)">
                        <textarea
                            value={JSON.stringify(draft.components, null, 2)}
                            onChange={(e) => {
                                try {
                                    const v = JSON.parse(e.target.value)
                                    setDraft({ ...draft, components: v })
                                } catch {
                                    /* ignore */
                                }
                            }}
                            rows={10}
                            className="w-full rounded border border-ui-border-base bg-ui-bg-base p-2 text-xs font-mono"
                        />
                    </Field>
                </Drawer.Body>
                <Drawer.Footer>
                    {!isNew && !draft.is_system && (
                        <Button
                            variant="danger"
                            onClick={remove}
                            disabled={deleting}
                        >
                            {deleting ? "Deleting…" : "Delete"}
                        </Button>
                    )}
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
