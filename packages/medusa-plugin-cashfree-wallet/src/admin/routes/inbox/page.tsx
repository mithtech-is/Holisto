import React, { useCallback, useEffect, useMemo, useState } from "react"
import { defineRouteConfig } from "@medusajs/admin-sdk"
import {
    Button,
    Container,
    Heading,
    Input,
    Select,
    StatusBadge,
    Table,
    Text,
    Textarea,
} from "@medusajs/ui"
import { EnvelopeSolid, BellAlert, PuzzleSolid } from "@medusajs/icons"

/**
 * /admin/inbox — unified ops inbox for the three public write-in
 * surfaces:
 *
 *   1. Contact      — customer messages from /contact (status workflow)
 *   2. Newsletter   — subscribers from the homepage opt-in (export, un/resub)
 *   3. Requests     — "please add this unlisted share" requests from the
 *                     Holdings page (approve / reject → fires notification)
 *
 * Single route with horizontal tabs (mirroring the Wallet admin page
 * convention) so ops has one sidebar item for all three.
 */

type Tab = "contact" | "newsletter" | "requests"

const TABS: Array<{ id: Tab; label: string; Icon: React.ElementType }> = [
    { id: "contact", label: "Contact", Icon: EnvelopeSolid },
    { id: "newsletter", label: "Newsletter", Icon: BellAlert },
    { id: "requests", label: "Company requests", Icon: PuzzleSolid },
]

export default function InboxPage() {
    const [tab, setTab] = useState<Tab>("contact")

    return (
        <Container>
            <div className="mb-4 flex items-center justify-between">
                <div>
                    <Heading level="h1">Inbox</Heading>
                    <Text size="small" className="text-ui-fg-subtle">
                        Public write-ins — contact messages, newsletter signups, and
                        customer requests to list new unlisted shares.
                    </Text>
                </div>
            </div>

            {/* Tabs */}
            <div className="mb-4 flex flex-wrap gap-1 border-b border-ui-border-base">
                {TABS.map((t) => {
                    const active = t.id === tab
                    return (
                        <button
                            key={t.id}
                            type="button"
                            onClick={() => setTab(t.id)}
                            className={`relative inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold transition-colors ${
                                active
                                    ? "text-ui-fg-base"
                                    : "text-ui-fg-subtle hover:text-ui-fg-base"
                            }`}
                        >
                            <t.Icon className="h-3.5 w-3.5" />
                            {t.label}
                            {active && (
                                <span className="absolute -bottom-px left-0 right-0 h-0.5 bg-ui-fg-interactive" />
                            )}
                        </button>
                    )
                })}
            </div>

            {tab === "contact" && <ContactInbox />}
            {tab === "newsletter" && <NewsletterInbox />}
            {tab === "requests" && <RequestsInbox />}
        </Container>
    )
}

/* ============================================================
 * 1. Contact submissions
 * ============================================================ */

type Submission = {
    id: string
    name: string
    email: string
    phone: string | null
    subject: string
    message: string
    source_ip: string | null
    customer_id: string | null
    status: "new" | "in_review" | "resolved" | "spam"
    reviewer_notes: string | null
    reviewer_user_id: string | null
    reviewed_at: string | null
    created_at: string
}
type ContactScope = "new" | "in_review" | "resolved" | "spam" | "all"
const CONTACT_SCOPES: { value: ContactScope; label: string }[] = [
    { value: "new", label: "New" },
    { value: "in_review", label: "In review" },
    { value: "resolved", label: "Resolved" },
    { value: "spam", label: "Spam" },
    { value: "all", label: "All" },
]
const CONTACT_COLORS: Record<
    Submission["status"],
    "blue" | "orange" | "green" | "red"
> = {
    new: "blue",
    in_review: "orange",
    resolved: "green",
    spam: "red",
}

function ContactInbox() {
    const [scope, setScope] = useState<ContactScope>("new")
    const [rows, setRows] = useState<Submission[]>([])
    const [loading, setLoading] = useState(true)
    const [selectedId, setSelectedId] = useState<string | null>(null)
    const [saving, setSaving] = useState(false)

    const load = useCallback(async () => {
        setLoading(true)
        try {
            const res = await fetch(
                `/admin/contact-submissions?status=${scope}`,
                { credentials: "include" }
            )
            const body = await res.json()
            setRows(body.submissions || [])
        } finally {
            setLoading(false)
        }
    }, [scope])
    useEffect(() => {
        void load()
    }, [load])

    const selected = useMemo(
        () => rows.find((r) => r.id === selectedId) ?? null,
        [rows, selectedId]
    )

    const updateRow = async (
        id: string,
        patch: Partial<Pick<Submission, "status" | "reviewer_notes">>
    ) => {
        setSaving(true)
        try {
            const res = await fetch(`/admin/contact-submissions/${id}`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                credentials: "include",
                body: JSON.stringify(patch),
            })
            if (!res.ok) throw new Error(await res.text())
            await load()
        } finally {
            setSaving(false)
        }
    }

    return (
        <div>
            <div className="mb-4 flex items-center justify-between gap-2">
                <Text size="small" className="text-ui-fg-subtle">
                    {rows.length} submission{rows.length === 1 ? "" : "s"} in this scope.
                </Text>
                <div className="flex items-center gap-2">
                    <Select
                        value={scope}
                        onValueChange={(v) => setScope(v as ContactScope)}
                    >
                        <Select.Trigger className="w-40">
                            <Select.Value />
                        </Select.Trigger>
                        <Select.Content>
                            {CONTACT_SCOPES.map((s) => (
                                <Select.Item key={s.value} value={s.value}>
                                    {s.label}
                                </Select.Item>
                            ))}
                        </Select.Content>
                    </Select>
                    <Button variant="secondary" onClick={load} disabled={loading}>
                        Refresh
                    </Button>
                </div>
            </div>

            <div className="grid gap-4 lg:grid-cols-[2fr_3fr]">
                <div className="overflow-hidden rounded-lg border border-ui-border-base bg-ui-bg-base">
                    <Table>
                        <Table.Header>
                            <Table.Row>
                                <Table.HeaderCell>From</Table.HeaderCell>
                                <Table.HeaderCell>Subject</Table.HeaderCell>
                                <Table.HeaderCell>Status</Table.HeaderCell>
                                <Table.HeaderCell>Received</Table.HeaderCell>
                            </Table.Row>
                        </Table.Header>
                        <Table.Body>
                            {loading ? (
                                <Table.Row>
                                    <Table.Cell colSpan={4}>
                                        <Text size="small" className="text-ui-fg-subtle">
                                            Loading…
                                        </Text>
                                    </Table.Cell>
                                </Table.Row>
                            ) : rows.length === 0 ? (
                                <Table.Row>
                                    <Table.Cell colSpan={4}>
                                        <Text size="small" className="text-ui-fg-subtle">
                                            No submissions.
                                        </Text>
                                    </Table.Cell>
                                </Table.Row>
                            ) : (
                                rows.map((r) => (
                                    <Table.Row
                                        key={r.id}
                                        onClick={() => setSelectedId(r.id)}
                                        className={`cursor-pointer ${selectedId === r.id ? "bg-ui-bg-base-hover" : ""}`}
                                    >
                                        <Table.Cell>
                                            <div className="flex flex-col">
                                                <Text size="small" weight="plus">
                                                    {r.name}
                                                </Text>
                                                <Text size="xsmall" className="text-ui-fg-subtle">
                                                    {r.email}
                                                </Text>
                                            </div>
                                        </Table.Cell>
                                        <Table.Cell>
                                            <Text size="small">{r.subject}</Text>
                                        </Table.Cell>
                                        <Table.Cell>
                                            <StatusBadge color={CONTACT_COLORS[r.status]}>
                                                {r.status.replace("_", " ")}
                                            </StatusBadge>
                                        </Table.Cell>
                                        <Table.Cell>
                                            <Text size="xsmall" className="text-ui-fg-subtle">
                                                {new Date(r.created_at).toLocaleString("en-IN")}
                                            </Text>
                                        </Table.Cell>
                                    </Table.Row>
                                ))
                            )}
                        </Table.Body>
                    </Table>
                </div>

                <div className="rounded-lg border border-ui-border-base bg-ui-bg-base p-6">
                    {!selected ? (
                        <Text size="small" className="text-ui-fg-subtle">
                            Select a submission to view details.
                        </Text>
                    ) : (
                        <ContactDetail
                            submission={selected}
                            saving={saving}
                            onUpdate={(patch) => updateRow(selected.id, patch)}
                        />
                    )}
                </div>
            </div>
        </div>
    )
}

function ContactDetail({
    submission,
    saving,
    onUpdate,
}: {
    submission: Submission
    saving: boolean
    onUpdate: (patch: Partial<Pick<Submission, "status" | "reviewer_notes">>) => void
}) {
    const [notes, setNotes] = useState(submission.reviewer_notes ?? "")
    useEffect(() => {
        setNotes(submission.reviewer_notes ?? "")
    }, [submission.id, submission.reviewer_notes])

    const mailto = `mailto:${submission.email}?subject=Re: ${encodeURIComponent(
        submission.subject
    )}`

    return (
        <div className="space-y-5">
            <div>
                <Heading level="h2">{submission.subject}</Heading>
                <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-ui-fg-subtle">
                    <span>{submission.name}</span>
                    <span>·</span>
                    <a href={mailto} className="text-ui-fg-interactive">
                        {submission.email}
                    </a>
                    {submission.phone && (
                        <>
                            <span>·</span>
                            <span>{submission.phone}</span>
                        </>
                    )}
                    <span>·</span>
                    <StatusBadge color={CONTACT_COLORS[submission.status]}>
                        {submission.status.replace("_", " ")}
                    </StatusBadge>
                </div>
            </div>

            <div className="rounded-md border border-ui-border-base bg-ui-bg-subtle p-4">
                <Text size="small" className="whitespace-pre-wrap">
                    {submission.message}
                </Text>
            </div>

            <div className="flex flex-wrap gap-2">
                <Button
                    size="small"
                    disabled={saving}
                    onClick={() => onUpdate({ status: "in_review" })}
                >
                    Mark in review
                </Button>
                <Button
                    variant="secondary"
                    size="small"
                    disabled={saving}
                    onClick={() => onUpdate({ status: "resolved" })}
                >
                    Mark resolved
                </Button>
                <Button
                    variant="transparent"
                    size="small"
                    disabled={saving}
                    onClick={() => onUpdate({ status: "spam" })}
                >
                    Mark spam
                </Button>
                <Button variant="secondary" size="small" asChild>
                    <a href={mailto}>Reply</a>
                </Button>
            </div>

            <div>
                <Text size="small" weight="plus" className="mb-2">
                    Internal notes
                </Text>
                <Textarea
                    rows={4}
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    placeholder="Private notes — only visible to ops."
                />
                <div className="mt-2 flex justify-end">
                    <Button
                        size="small"
                        disabled={saving || notes === (submission.reviewer_notes ?? "")}
                        onClick={() => onUpdate({ reviewer_notes: notes })}
                    >
                        Save notes
                    </Button>
                </div>
            </div>

            <div className="border-t border-ui-border-base pt-3 text-xs text-ui-fg-subtle">
                Submitted {new Date(submission.created_at).toLocaleString("en-IN")}
                {submission.source_ip ? ` · from ${submission.source_ip}` : ""}
                {submission.customer_id
                    ? ` · logged in as ${submission.customer_id}`
                    : ""}
            </div>
        </div>
    )
}

/* ============================================================
 * 2. Newsletter subscriptions
 * ============================================================ */

type Subscription = {
    id: string
    email: string
    source: string | null
    source_ip: string | null
    unsubscribed_at: string | null
    first_seen_at: string | null
    last_seen_at: string | null
    created_at: string
}
type NewsletterScope = "active" | "unsubscribed" | "all"
const NEWSLETTER_SCOPES: { value: NewsletterScope; label: string }[] = [
    { value: "active", label: "Active" },
    { value: "unsubscribed", label: "Unsubscribed" },
    { value: "all", label: "All" },
]

function NewsletterInbox() {
    const [scope, setScope] = useState<NewsletterScope>("active")
    const [q, setQ] = useState("")
    const [rows, setRows] = useState<Subscription[]>([])
    const [count, setCount] = useState(0)
    const [loading, setLoading] = useState(true)
    const [busyId, setBusyId] = useState<string | null>(null)

    const load = useCallback(async () => {
        setLoading(true)
        try {
            const qs = new URLSearchParams({ scope, limit: "500" })
            if (q.trim()) qs.set("q", q.trim())
            const res = await fetch(
                `/admin/newsletter-subscriptions?${qs.toString()}`,
                { credentials: "include" }
            )
            const body = await res.json()
            setRows(body.subscriptions || [])
            setCount(body.count || 0)
        } finally {
            setLoading(false)
        }
    }, [scope, q])
    useEffect(() => {
        void load()
    }, [load])

    const action = async (
        id: string,
        act: "unsubscribe" | "resubscribe" | "delete"
    ) => {
        if (act === "delete" && !confirm("Permanently delete this subscriber?"))
            return
        setBusyId(id)
        try {
            await fetch(`/admin/newsletter-subscriptions/${id}`, {
                method: "POST",
                credentials: "include",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ action: act }),
            })
            await load()
        } finally {
            setBusyId(null)
        }
    }

    const exportCsv = () => {
        const header = ["email", "source", "status", "first_seen_at", "last_seen_at"]
        const lines = [header.join(",")]
        for (const r of rows) {
            lines.push(
                [
                    r.email,
                    r.source ?? "",
                    r.unsubscribed_at ? "unsubscribed" : "active",
                    r.first_seen_at ?? "",
                    r.last_seen_at ?? "",
                ]
                    .map((v) => `"${String(v).replace(/"/g, '""')}"`)
                    .join(",")
            )
        }
        const blob = new Blob([lines.join("\n")], { type: "text/csv" })
        const url = URL.createObjectURL(blob)
        const a = document.createElement("a")
        a.href = url
        a.download = `polemarch-newsletter-${new Date().toISOString().slice(0, 10)}.csv`
        a.click()
        URL.revokeObjectURL(url)
    }

    return (
        <div>
            <div className="mb-4 flex items-start justify-between gap-3">
                <Text size="small" className="text-ui-fg-subtle">
                    {count} subscriber{count === 1 ? "" : "s"}.
                </Text>
                <div className="flex items-center gap-2">
                    <Input
                        placeholder="Search email"
                        value={q}
                        onChange={(e) => setQ(e.target.value)}
                        className="w-56"
                    />
                    <Select
                        value={scope}
                        onValueChange={(v) => setScope(v as NewsletterScope)}
                    >
                        <Select.Trigger className="w-40">
                            <Select.Value />
                        </Select.Trigger>
                        <Select.Content>
                            {NEWSLETTER_SCOPES.map((s) => (
                                <Select.Item key={s.value} value={s.value}>
                                    {s.label}
                                </Select.Item>
                            ))}
                        </Select.Content>
                    </Select>
                    <Button
                        variant="secondary"
                        onClick={exportCsv}
                        disabled={rows.length === 0}
                    >
                        Export CSV
                    </Button>
                    <Button variant="secondary" onClick={load} disabled={loading}>
                        Refresh
                    </Button>
                </div>
            </div>

            <div className="overflow-hidden rounded-lg border border-ui-border-base bg-ui-bg-base">
                <Table>
                    <Table.Header>
                        <Table.Row>
                            <Table.HeaderCell>Email</Table.HeaderCell>
                            <Table.HeaderCell>Source</Table.HeaderCell>
                            <Table.HeaderCell>Status</Table.HeaderCell>
                            <Table.HeaderCell>Signed up</Table.HeaderCell>
                            <Table.HeaderCell>Actions</Table.HeaderCell>
                        </Table.Row>
                    </Table.Header>
                    <Table.Body>
                        {loading ? (
                            <Table.Row>
                                <Table.Cell colSpan={5}>
                                    <Text size="small" className="text-ui-fg-subtle">
                                        Loading…
                                    </Text>
                                </Table.Cell>
                            </Table.Row>
                        ) : rows.length === 0 ? (
                            <Table.Row>
                                <Table.Cell colSpan={5}>
                                    <Text size="small" className="text-ui-fg-subtle">
                                        No subscribers.
                                    </Text>
                                </Table.Cell>
                            </Table.Row>
                        ) : (
                            rows.map((r) => {
                                const unsubbed = !!r.unsubscribed_at
                                return (
                                    <Table.Row key={r.id}>
                                        <Table.Cell>
                                            <Text size="small" weight="plus">
                                                {r.email}
                                            </Text>
                                        </Table.Cell>
                                        <Table.Cell>
                                            <Text size="small" className="text-ui-fg-subtle">
                                                {r.source || "—"}
                                            </Text>
                                        </Table.Cell>
                                        <Table.Cell>
                                            <StatusBadge color={unsubbed ? "red" : "green"}>
                                                {unsubbed ? "unsubscribed" : "active"}
                                            </StatusBadge>
                                        </Table.Cell>
                                        <Table.Cell>
                                            <Text size="xsmall" className="text-ui-fg-subtle">
                                                {r.first_seen_at
                                                    ? new Date(r.first_seen_at).toLocaleDateString("en-IN")
                                                    : "—"}
                                            </Text>
                                        </Table.Cell>
                                        <Table.Cell>
                                            <div className="flex gap-1.5">
                                                {unsubbed ? (
                                                    <Button
                                                        size="small"
                                                        variant="secondary"
                                                        disabled={busyId === r.id}
                                                        onClick={() => action(r.id, "resubscribe")}
                                                    >
                                                        Resub
                                                    </Button>
                                                ) : (
                                                    <Button
                                                        size="small"
                                                        variant="secondary"
                                                        disabled={busyId === r.id}
                                                        onClick={() => action(r.id, "unsubscribe")}
                                                    >
                                                        Unsub
                                                    </Button>
                                                )}
                                                <Button
                                                    size="small"
                                                    variant="transparent"
                                                    disabled={busyId === r.id}
                                                    onClick={() => action(r.id, "delete")}
                                                >
                                                    Delete
                                                </Button>
                                            </div>
                                        </Table.Cell>
                                    </Table.Row>
                                )
                            })
                        )}
                    </Table.Body>
                </Table>
            </div>
        </div>
    )
}

/* ============================================================
 * 3. Company requests ("please add share X")
 * ============================================================ */

type CompanyRequest = {
    id: string
    customer_id: string
    company_name: string
    isin: string | null
    customer_note: string | null
    status: "pending" | "approved" | "rejected"
    reviewer_notes: string | null
    reviewer_user_id: string | null
    reviewed_at: string | null
    created_at: string
}
type RequestScope = "pending" | "approved" | "rejected" | "all"
const REQUEST_SCOPES: { value: RequestScope; label: string }[] = [
    { value: "pending", label: "Pending" },
    { value: "approved", label: "Approved" },
    { value: "rejected", label: "Rejected" },
    { value: "all", label: "All" },
]
const REQUEST_COLORS: Record<
    CompanyRequest["status"],
    "blue" | "green" | "red"
> = {
    pending: "blue",
    approved: "green",
    rejected: "red",
}

function RequestsInbox() {
    const [scope, setScope] = useState<RequestScope>("pending")
    const [rows, setRows] = useState<CompanyRequest[]>([])
    const [loading, setLoading] = useState(true)
    const [selectedId, setSelectedId] = useState<string | null>(null)
    const [notes, setNotes] = useState("")
    const [busy, setBusy] = useState(false)

    const load = useCallback(async () => {
        setLoading(true)
        try {
            const res = await fetch(
                `/admin/company-requests?status=${scope}`,
                { credentials: "include" }
            )
            const body = await res.json()
            setRows(body.requests || [])
        } finally {
            setLoading(false)
        }
    }, [scope])
    useEffect(() => {
        void load()
    }, [load])

    const selected = useMemo(
        () => rows.find((r) => r.id === selectedId) ?? null,
        [rows, selectedId]
    )
    useEffect(() => {
        setNotes(selected?.reviewer_notes ?? "")
    }, [selected?.id, selected?.reviewer_notes])

    const decide = async (decision: "approved" | "rejected") => {
        if (!selected) return
        setBusy(true)
        try {
            const res = await fetch(`/admin/company-requests/${selected.id}/decide`, {
                method: "POST",
                credentials: "include",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ decision, notes: notes.trim() || null }),
            })
            if (!res.ok) throw new Error(await res.text())
            await load()
            setSelectedId(null)
        } finally {
            setBusy(false)
        }
    }

    return (
        <div>
            <div className="mb-4 flex items-center justify-between gap-2">
                <Text size="small" className="text-ui-fg-subtle">
                    {rows.length} request{rows.length === 1 ? "" : "s"} in this scope.
                </Text>
                <div className="flex items-center gap-2">
                    <Select
                        value={scope}
                        onValueChange={(v) => setScope(v as RequestScope)}
                    >
                        <Select.Trigger className="w-40">
                            <Select.Value />
                        </Select.Trigger>
                        <Select.Content>
                            {REQUEST_SCOPES.map((s) => (
                                <Select.Item key={s.value} value={s.value}>
                                    {s.label}
                                </Select.Item>
                            ))}
                        </Select.Content>
                    </Select>
                    <Button variant="secondary" onClick={load} disabled={loading}>
                        Refresh
                    </Button>
                </div>
            </div>

            <div className="grid gap-4 lg:grid-cols-[2fr_3fr]">
                <div className="overflow-hidden rounded-lg border border-ui-border-base bg-ui-bg-base">
                    <Table>
                        <Table.Header>
                            <Table.Row>
                                <Table.HeaderCell>Company</Table.HeaderCell>
                                <Table.HeaderCell>ISIN</Table.HeaderCell>
                                <Table.HeaderCell>Status</Table.HeaderCell>
                                <Table.HeaderCell>Submitted</Table.HeaderCell>
                            </Table.Row>
                        </Table.Header>
                        <Table.Body>
                            {loading ? (
                                <Table.Row>
                                    <Table.Cell colSpan={4}>
                                        <Text size="small" className="text-ui-fg-subtle">
                                            Loading…
                                        </Text>
                                    </Table.Cell>
                                </Table.Row>
                            ) : rows.length === 0 ? (
                                <Table.Row>
                                    <Table.Cell colSpan={4}>
                                        <Text size="small" className="text-ui-fg-subtle">
                                            No requests.
                                        </Text>
                                    </Table.Cell>
                                </Table.Row>
                            ) : (
                                rows.map((r) => (
                                    <Table.Row
                                        key={r.id}
                                        onClick={() => setSelectedId(r.id)}
                                        className={`cursor-pointer ${selectedId === r.id ? "bg-ui-bg-base-hover" : ""}`}
                                    >
                                        <Table.Cell>
                                            <Text size="small" weight="plus">
                                                {r.company_name}
                                            </Text>
                                        </Table.Cell>
                                        <Table.Cell>
                                            <code className="text-xs text-ui-fg-muted">
                                                {r.isin || "—"}
                                            </code>
                                        </Table.Cell>
                                        <Table.Cell>
                                            <StatusBadge color={REQUEST_COLORS[r.status]}>
                                                {r.status}
                                            </StatusBadge>
                                        </Table.Cell>
                                        <Table.Cell>
                                            <Text size="xsmall" className="text-ui-fg-subtle">
                                                {new Date(r.created_at).toLocaleDateString("en-IN")}
                                            </Text>
                                        </Table.Cell>
                                    </Table.Row>
                                ))
                            )}
                        </Table.Body>
                    </Table>
                </div>

                <div className="rounded-lg border border-ui-border-base bg-ui-bg-base p-6">
                    {!selected ? (
                        <Text size="small" className="text-ui-fg-subtle">
                            Select a request to review.
                        </Text>
                    ) : (
                        <div className="space-y-5">
                            <div>
                                <Heading level="h2">{selected.company_name}</Heading>
                                <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-ui-fg-subtle">
                                    {selected.isin && (
                                        <code className="rounded bg-ui-bg-subtle px-1.5 py-0.5 text-xs">
                                            {selected.isin}
                                        </code>
                                    )}
                                    <span>
                                        from {selected.customer_id}
                                    </span>
                                    <span>·</span>
                                    <StatusBadge color={REQUEST_COLORS[selected.status]}>
                                        {selected.status}
                                    </StatusBadge>
                                </div>
                            </div>

                            {selected.customer_note && (
                                <div className="rounded-md border border-ui-border-base bg-ui-bg-subtle p-4">
                                    <Text size="xsmall" className="mb-1 text-ui-fg-subtle">
                                        Customer note
                                    </Text>
                                    <Text size="small" className="whitespace-pre-wrap">
                                        {selected.customer_note}
                                    </Text>
                                </div>
                            )}

                            <div>
                                <Text size="small" weight="plus" className="mb-2">
                                    Reviewer notes (optional — shown to customer on rejection)
                                </Text>
                                <Textarea
                                    rows={3}
                                    value={notes}
                                    onChange={(e) => setNotes(e.target.value)}
                                    placeholder="Why was this approved / rejected?"
                                />
                            </div>

                            {selected.status === "pending" ? (
                                <div className="flex gap-2">
                                    <Button
                                        size="small"
                                        disabled={busy}
                                        onClick={() => decide("approved")}
                                    >
                                        Approve + notify customer
                                    </Button>
                                    <Button
                                        size="small"
                                        variant="secondary"
                                        disabled={busy}
                                        onClick={() => decide("rejected")}
                                    >
                                        Reject
                                    </Button>
                                </div>
                            ) : (
                                <Text size="xsmall" className="text-ui-fg-subtle">
                                    Already {selected.status}
                                    {selected.reviewed_at
                                        ? ` on ${new Date(selected.reviewed_at).toLocaleString("en-IN")}`
                                        : ""}
                                    .
                                </Text>
                            )}

                            <div className="border-t border-ui-border-base pt-3 text-xs text-ui-fg-subtle">
                                Submitted {new Date(selected.created_at).toLocaleString("en-IN")}
                            </div>
                        </div>
                    )}
                </div>
            </div>
        </div>
    )
}

export const config = defineRouteConfig({
    label: "Inbox",
    icon: EnvelopeSolid,
})
