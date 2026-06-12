// @ts-nocheck
import React, { useEffect, useMemo, useState } from "react"
import {
    Button,
    Checkbox,
    Heading,
    Input,
    Label,
    Text,
    Textarea,
    toast,
} from "@medusajs/ui"

/**
 * Communication → Brand tab.
 *
 * Single source of truth for placeholder substitution across Email,
 * SMS, and WhatsApp templates. Saving here drives:
 *   {{brand}}, {{company_name}}, {{storefront_url}}, {{support_email}},
 *   {{support_phone}}, {{address}}, {{tagline}}, {{whatsapp_bot}}
 *
 * Backend routes:
 *   GET  /admin/communication/brand
 *   PUT  /admin/communication/brand
 *
 * After a brand change, WhatsApp templates that have ALREADY been
 * approved on Meta still deliver with the old wording — Meta keys
 * approval to the literal text. The "Reset brand-using templates"
 * button bulk-flips affected templates back to "Not created" so the
 * admin recreates them on polyg.in in one click.
 */

type BotCategory = "AUTHENTICATION" | "UTILITY" | "MARKETING"

type BrandView = {
    brand_name: string
    company_name: string | null
    storefront_url: string
    support_email: string | null
    support_phone: string | null
    address: string | null
    tagline: string | null
    whatsapp_bot_label: string
    whatsapp_bot_categories: BotCategory[]
}

type WhatsappTemplateRow = {
    slug: string
    components: any[]
    polygin_status: "draft" | "pushed" | "approved" | "rejected" | "paused"
}

const PLACEHOLDER_DOCS: Array<{
    placeholder: string
    field: keyof BrandView
    description: string
}> = [
    {
        placeholder: "{{brand}}",
        field: "brand_name",
        description: "Display brand name shown in messages.",
    },
    {
        placeholder: "{{company_name}}",
        field: "company_name",
        description: "Legal entity for footers + compliance lines.",
    },
    {
        placeholder: "{{storefront_url}}",
        field: "storefront_url",
        description: "Where templates with action buttons send recipients.",
    },
    {
        placeholder: "{{support_email}}",
        field: "support_email",
        description: "Cited in template footers when present.",
    },
    {
        placeholder: "{{support_phone}}",
        field: "support_phone",
        description: "E.164 contact number for templates referencing support.",
    },
    {
        placeholder: "{{address}}",
        field: "address",
        description: "Postal / registered-office line for compliance footers.",
    },
    {
        placeholder: "{{tagline}}",
        field: "tagline",
        description: "Short marketing line shown in WhatsApp template footers.",
    },
    {
        placeholder: "{{whatsapp_bot}}",
        field: "whatsapp_bot_label",
        description:
            "Text on the QUICK_REPLY bot button every UTILITY WhatsApp template carries (max 25 chars).",
    },
]

const empty = (): BrandView => ({
    brand_name: "",
    company_name: null,
    storefront_url: "",
    support_email: null,
    support_phone: null,
    address: null,
    tagline: null,
    whatsapp_bot_label: "Initiate Bot",
    whatsapp_bot_categories: ["UTILITY", "MARKETING"],
})

const usesBrandPlaceholder = (components: any[]): boolean => {
    const haystack = JSON.stringify(components ?? [])
    return /\{\{\s*(brand|company_name|storefront_url|support_email|support_phone|address|tagline|whatsapp_bot)\s*\}\}/.test(
        haystack,
    )
}

export default function BrandTab() {
    const [view, setView] = useState<BrandView | null>(null)
    const [draft, setDraft] = useState<BrandView>(empty())
    const [loading, setLoading] = useState(true)
    const [saving, setSaving] = useState(false)
    const [bulkResetting, setBulkResetting] = useState(false)
    const [refreshing, setRefreshing] = useState(false)
    const [waTemplates, setWaTemplates] = useState<WhatsappTemplateRow[]>([])

    const load = async () => {
        setLoading(true)
        try {
            const [r1, r2] = await Promise.all([
                fetch("/admin/communication/brand", {
                    credentials: "include",
                }),
                fetch("/admin/communication/whatsapp-templates", {
                    credentials: "include",
                }),
            ])
            const b = (await r1.json()) as BrandView
            setView(b)
            setDraft({
                brand_name: b.brand_name || "",
                company_name: b.company_name,
                storefront_url: b.storefront_url || "",
                support_email: b.support_email,
                support_phone: b.support_phone,
                address: b.address,
                tagline: b.tagline,
                whatsapp_bot_label: b.whatsapp_bot_label || "Initiate Bot",
                whatsapp_bot_categories: Array.isArray(
                    b.whatsapp_bot_categories,
                )
                    ? b.whatsapp_bot_categories
                    : ["UTILITY", "MARKETING"],
            })
            const t = await r2.json().catch(() => ({ templates: [] }))
            setWaTemplates(
                (t.templates || []).map((row: any) => ({
                    slug: row.slug,
                    components: row.components,
                    polygin_status: row.polygin_status,
                })),
            )
        } catch (err: any) {
            toast.error("Failed to load brand", { description: err?.message })
        } finally {
            setLoading(false)
        }
    }

    useEffect(() => {
        load()
    }, [])

    const dirty = useMemo(() => {
        if (!view) return false
        const fields: Array<
            Exclude<keyof BrandView, "whatsapp_bot_categories">
        > = [
            "brand_name",
            "company_name",
            "storefront_url",
            "support_email",
            "support_phone",
            "address",
            "tagline",
            "whatsapp_bot_label",
        ]
        if (fields.some((k) => (draft[k] ?? "") !== (view[k] ?? ""))) return true
        const a = [...draft.whatsapp_bot_categories].sort().join(",")
        const b = [...view.whatsapp_bot_categories].sort().join(",")
        return a !== b
    }, [draft, view])

    const save = async () => {
        setSaving(true)
        try {
            const body: any = {
                brand_name: draft.brand_name || undefined,
                company_name: draft.company_name,
                storefront_url: draft.storefront_url || undefined,
                support_email: draft.support_email,
                support_phone: draft.support_phone,
                address: draft.address,
                tagline: draft.tagline,
                whatsapp_bot_label:
                    draft.whatsapp_bot_label?.trim() || undefined,
                whatsapp_bot_categories: draft.whatsapp_bot_categories,
            }
            const r = await fetch("/admin/communication/brand", {
                method: "PUT",
                credentials: "include",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(body),
            })
            if (!r.ok) {
                const e = await r.json().catch(() => ({}))
                throw new Error(e.message || `Save failed (${r.status})`)
            }
            const next = (await r.json()) as BrandView
            setView(next)
            setDraft(next)
            toast.success("Brand saved", {
                description:
                    "All channels now substitute these values. Re-create approved WhatsApp templates on polyg.in to refresh Meta-side wording.",
            })
        } catch (err: any) {
            toast.error("Couldn't save brand", { description: err?.message })
        } finally {
            setSaving(false)
        }
    }

    const affectedTemplates = useMemo(
        () =>
            waTemplates.filter(
                (t) =>
                    usesBrandPlaceholder(t.components) &&
                    t.polygin_status !== "draft",
            ),
        [waTemplates],
    )

    /**
     * Re-apply the in-source seed catalogs (whatsapp + sms) to the
     * existing system rows. Picks up brand-placeholder updates,
     * adds newly seeded templates, wires new event mappings.
     *
     * Skips admin-customized rows (is_system = false). On the
     * WhatsApp side, every overwritten row's polygin_status resets
     * to "draft" because the wording changed → Meta-side approval
     * is stale.
     */
    const refreshSystemTemplates = async () => {
        if (
            !window.confirm(
                "Refresh system templates from the in-source catalog? Existing system rows will be overwritten with the canonical wording. Admin-customized rows are skipped. WhatsApp templates will be reset to 'Not created' since the wording change invalidates Meta-side approval.",
            )
        )
            return
        setRefreshing(true)
        try {
            const [r1, r2] = await Promise.all([
                fetch(
                    "/admin/communication/whatsapp-templates/refresh-system",
                    { method: "POST", credentials: "include" },
                ),
                fetch(
                    "/admin/communication/sms-templates/refresh-system",
                    { method: "POST", credentials: "include" },
                ),
            ])
            const wa = await r1.json().catch(() => ({}))
            const sms = await r2.json().catch(() => ({}))
            const lines: string[] = []
            if (wa?.ok !== false) {
                lines.push(
                    `WhatsApp: ${wa.inserted ?? 0} new, ${wa.updated ?? 0} updated${
                        wa.skipped?.length
                            ? `, ${wa.skipped.length} skipped (admin-customized)`
                            : ""
                    }`,
                )
            } else {
                lines.push(`WhatsApp refresh failed: ${wa.message ?? ""}`)
            }
            if (sms?.ok !== false) {
                lines.push(
                    `SMS: ${sms.inserted ?? 0} new, ${sms.updated ?? 0} updated${
                        sms.skipped?.length
                            ? `, ${sms.skipped.length} skipped (admin-customized)`
                            : ""
                    }`,
                )
            } else {
                lines.push(`SMS refresh failed: ${sms.message ?? ""}`)
            }
            toast.success("System templates refreshed", {
                description: lines.join(" · "),
            })
            await load()
        } catch (err: any) {
            toast.error("Refresh failed", { description: err?.message })
        } finally {
            setRefreshing(false)
        }
    }

    const bulkReset = async () => {
        if (affectedTemplates.length === 0) {
            toast.success(
                "Nothing to reset — every brand-using template is already 'Not created'.",
            )
            return
        }
        if (
            !window.confirm(
                `Mark ${affectedTemplates.length} WhatsApp template(s) as 'Not created'? They use brand placeholders, so the wording on Meta is now stale and they need recreating on polyg.in.`,
            )
        )
            return
        setBulkResetting(true)
        try {
            let succeeded = 0
            const failures: string[] = []
            for (const t of affectedTemplates) {
                try {
                    const r = await fetch(
                        `/admin/communication/whatsapp-templates/${encodeURIComponent(t.slug)}`,
                        {
                            method: "PUT",
                            credentials: "include",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify({ polygin_status: "draft" }),
                        },
                    )
                    if (!r.ok) {
                        const e = await r.json().catch(() => ({}))
                        failures.push(
                            `${t.slug}: ${e.message || `HTTP ${r.status}`}`,
                        )
                    } else succeeded++
                } catch (err: any) {
                    failures.push(`${t.slug}: ${err?.message ?? String(err)}`)
                }
            }
            if (failures.length === 0) {
                toast.success(
                    `Reset ${succeeded} template(s) to 'Not created'.`,
                    {
                        description:
                            "Open the WhatsApp templates tab, click Copy for polyg.in on each, and recreate them with the new brand wording.",
                    },
                )
            } else {
                toast.error(
                    `Reset ${succeeded} of ${affectedTemplates.length} — ${failures.length} failed.`,
                    { description: failures.slice(0, 3).join("; ") },
                )
            }
            await load()
        } finally {
            setBulkResetting(false)
        }
    }

    if (loading) {
        return <Text className="text-ui-fg-muted">Loading brand…</Text>
    }

    return (
        <div className="flex flex-col gap-6 max-w-4xl">
            <div>
                <Heading level="h2">Brand details</Heading>
                <Text className="text-ui-fg-muted" size="small">
                    These fields drive placeholder substitution across
                    Email, SMS, and WhatsApp templates. Templates that use
                    a placeholder render the live brand value at send time
                    (or copy time, for Meta-approved WhatsApp templates).
                </Text>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 rounded-lg border border-ui-border-base p-4">
                <Field
                    label="Brand name"
                    hint={`${draft.brand_name.length}/80 — {{brand}} placeholder. Keep short; appears in WhatsApp footers (60-char limit).`}
                >
                    <Input
                        value={draft.brand_name}
                        maxLength={80}
                        onChange={(e) =>
                            setDraft({ ...draft, brand_name: e.target.value })
                        }
                        placeholder="Acme"
                    />
                </Field>
                <Field
                    label="Company name"
                    hint={`${(draft.company_name ?? "").length}/160 — {{company_name}} placeholder. Legal entity for compliance footers.`}
                >
                    <Input
                        value={draft.company_name ?? ""}
                        maxLength={160}
                        onChange={(e) =>
                            setDraft({
                                ...draft,
                                company_name: e.target.value || null,
                            })
                        }
                        placeholder="Acme Pvt Ltd"
                    />
                </Field>
                <Field
                    label="Storefront URL"
                    hint={`${draft.storefront_url.length}/2000 — {{storefront_url}} placeholder. Must include https:// (Meta requirement).`}
                >
                    <Input
                        type="url"
                        value={draft.storefront_url}
                        maxLength={2000}
                        onChange={(e) =>
                            setDraft({
                                ...draft,
                                storefront_url: e.target.value,
                            })
                        }
                        placeholder="https://example.com"
                    />
                </Field>
                <Field
                    label="Tagline"
                    hint={`${(draft.tagline ?? "").length}/45 — {{tagline}} placeholder. Stays under 45 so "<brand> — <tagline>" fits Meta's 60-char footer limit.`}
                >
                    <Input
                        value={draft.tagline ?? ""}
                        maxLength={45}
                        onChange={(e) =>
                            setDraft({
                                ...draft,
                                tagline: e.target.value || null,
                            })
                        }
                        placeholder="Unlisted Shares Platform"
                    />
                </Field>
                <Field
                    label="Support email"
                    hint={`${(draft.support_email ?? "").length}/254 — {{support_email}} placeholder. Standard email format.`}
                >
                    <Input
                        type="email"
                        value={draft.support_email ?? ""}
                        maxLength={254}
                        onChange={(e) =>
                            setDraft({
                                ...draft,
                                support_email: e.target.value || null,
                            })
                        }
                        placeholder="support@example.com"
                    />
                </Field>
                <Field
                    label="Support phone"
                    hint={`${(draft.support_phone ?? "").length}/20 — {{support_phone}} placeholder. E.164 format (+countrycode).`}
                >
                    <Input
                        type="tel"
                        value={draft.support_phone ?? ""}
                        maxLength={20}
                        onChange={(e) =>
                            setDraft({
                                ...draft,
                                support_phone: e.target.value || null,
                            })
                        }
                        placeholder="+918041234567"
                    />
                </Field>
                <div className="md:col-span-2">
                    <Field
                        label="Registered address"
                        hint={`${(draft.address ?? "").length}/500 — {{address}} placeholder. Multiline OK; used in compliance footers.`}
                    >
                        <Textarea
                            value={draft.address ?? ""}
                            maxLength={500}
                            onChange={(e) =>
                                setDraft({
                                    ...draft,
                                    address: e.target.value || null,
                                })
                            }
                            placeholder="3rd Floor, ABC Towers, MG Road, Bengaluru 560001, KA, India"
                            rows={2}
                        />
                    </Field>
                </div>
            </div>

            {/* WhatsApp bot button — adds a QUICK_REPLY button + a
                "For more info, click '<bot>'." footer to system
                templates of the selected categories at refresh time. */}
            <div className="rounded-lg border border-ui-tag-blue-border bg-ui-tag-blue-bg p-4 flex flex-col gap-4">
                <div>
                    <Heading level="h3">WhatsApp bot button</Heading>
                    <Text size="xsmall" className="text-ui-fg-muted">
                        Adds a QUICK_REPLY button + a{" "}
                        <code>{`"For more info, click '{{whatsapp_bot}}'."`}</code>{" "}
                        footer to system WhatsApp templates of the
                        selected categories at refresh time. Resolves
                        with the label below.
                    </Text>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <Field
                        label="Bot button label"
                        hint={`${draft.whatsapp_bot_label.length}/25 — {{whatsapp_bot}} placeholder. Meta caps QUICK_REPLY button text at 25 chars.`}
                    >
                        <Input
                            value={draft.whatsapp_bot_label}
                            maxLength={25}
                            onChange={(e) =>
                                setDraft({
                                    ...draft,
                                    whatsapp_bot_label:
                                        e.target.value || "Initiate Bot",
                                })
                            }
                            placeholder="Initiate Bot"
                        />
                    </Field>
                    <div className="flex flex-col gap-2">
                        <Label className="font-medium">
                            Add bot button to which categories?
                        </Label>
                        <div className="flex flex-col gap-2">
                            {(
                                [
                                    "UTILITY",
                                    "MARKETING",
                                    "AUTHENTICATION",
                                ] as const
                            ).map((cat) => {
                                const checked =
                                    draft.whatsapp_bot_categories.includes(cat)
                                const isAuth = cat === "AUTHENTICATION"
                                return (
                                    <label
                                        key={cat}
                                        className="flex items-start gap-2 text-sm"
                                    >
                                        <Checkbox
                                            checked={checked}
                                            onCheckedChange={(v) => {
                                                const next = new Set(
                                                    draft.whatsapp_bot_categories,
                                                )
                                                if (v) next.add(cat)
                                                else next.delete(cat)
                                                setDraft({
                                                    ...draft,
                                                    whatsapp_bot_categories: [
                                                        ...next,
                                                    ] as BotCategory[],
                                                })
                                            }}
                                            className="mt-0.5"
                                        />
                                        <div className="flex-1">
                                            <span className="font-medium">
                                                {cat}
                                            </span>
                                            {isAuth && (
                                                <Text
                                                    size="xsmall"
                                                    className="text-ui-fg-muted"
                                                >
                                                    Meta blocks custom
                                                    QUICK_REPLY buttons on
                                                    AUTHENTICATION
                                                    templates — enabling
                                                    this will cause Meta
                                                    to reject the template.
                                                </Text>
                                            )}
                                        </div>
                                    </label>
                                )
                            })}
                        </div>
                    </div>
                </div>
                <Text size="xsmall" className="text-ui-fg-muted">
                    Click <b>Refresh system templates</b> below after
                    saving so the bot button is added (or removed)
                    across the catalog.
                </Text>
            </div>

            <div className="flex items-center gap-2 flex-wrap">
                <Button onClick={save} disabled={saving || !dirty}>
                    {saving ? "Saving…" : "Save brand"}
                </Button>
                {dirty && (
                    <Button
                        variant="secondary"
                        onClick={() =>
                            view &&
                            setDraft({
                                brand_name: view.brand_name,
                                company_name: view.company_name,
                                storefront_url: view.storefront_url,
                                support_email: view.support_email,
                                support_phone: view.support_phone,
                                address: view.address,
                                tagline: view.tagline,
                                whatsapp_bot_label: view.whatsapp_bot_label,
                                whatsapp_bot_categories:
                                    view.whatsapp_bot_categories,
                            })
                        }
                        disabled={saving}
                    >
                        Revert
                    </Button>
                )}
                <Button
                    variant="secondary"
                    onClick={bulkReset}
                    disabled={bulkResetting || affectedTemplates.length === 0}
                    title={
                        affectedTemplates.length === 0
                            ? "No brand-using templates need resetting."
                            : `Mark ${affectedTemplates.length} WhatsApp template(s) as 'Not created' so the admin recreates them on polyg.in with the new wording.`
                    }
                >
                    {bulkResetting
                        ? "Resetting…"
                        : `Reset ${affectedTemplates.length} brand-using WhatsApp template${affectedTemplates.length === 1 ? "" : "s"}`}
                </Button>
                <Button
                    variant="secondary"
                    onClick={refreshSystemTemplates}
                    disabled={refreshing}
                    title="Re-apply the in-source seed catalogs to existing system rows. Picks up new brand placeholders + newly seeded templates. Admin-customized rows are left alone."
                >
                    {refreshing
                        ? "Refreshing…"
                        : "Refresh system templates"}
                </Button>
            </div>

            <div className="h-px bg-ui-border-base my-2" />

            <div>
                <Heading level="h3">Placeholder reference</Heading>
                <Text className="text-ui-fg-muted" size="small">
                    Drop any of these into an Email, SMS, or WhatsApp
                    template body. They&apos;re replaced with the values
                    above at send time (and at copy time for the
                    Copy-for-polyg.in flow).
                </Text>
                <div className="mt-3 grid grid-cols-1 md:grid-cols-2 gap-2">
                    {PLACEHOLDER_DOCS.map((p) => {
                        const value = (draft[p.field] ?? "") as string
                        return (
                            <div
                                key={p.placeholder}
                                className="rounded border border-ui-border-base p-3"
                            >
                                <div className="flex items-center justify-between gap-2">
                                    <code className="text-xs font-mono px-1.5 py-0.5 rounded bg-ui-bg-subtle">
                                        {p.placeholder}
                                    </code>
                                    <Text size="xsmall" className="text-ui-fg-muted">
                                        {value || "—"}
                                    </Text>
                                </div>
                                <Text
                                    size="xsmall"
                                    className="text-ui-fg-muted mt-1"
                                >
                                    {p.description}
                                </Text>
                            </div>
                        )
                    })}
                </div>
            </div>
        </div>
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
