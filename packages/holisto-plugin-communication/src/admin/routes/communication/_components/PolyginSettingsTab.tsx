// @ts-nocheck
import React, { useEffect, useState } from "react"
import {
    Button,
    Input,
    Label,
    Switch,
    Text,
    Heading,
    Badge,
    toast,
} from "@medusajs/ui"

/**
 * Polygin WhatsApp gateway settings. Same UX as MSG91 / SMTP. Backed by:
 *   GET  /admin/communication/polygin/config
 *   PUT  /admin/communication/polygin/config
 *   POST /admin/communication/polygin/test  { to }
 *
 * Templates themselves are managed on polyg.in's web UI directly — see
 * the "WhatsApp Templates" tab for the catalog + copy-for-polyg.in tool.
 */
type ConfigView = {
    configured: boolean
    token_set: boolean
    /** True when an optional dashboard JWT is stored. Gates the
     *  "Push to polyg.in" + "Sync from polyg.in" features on the
     *  WhatsApp Templates tab. */
    dashboard_token_set: boolean
    sender_phone: string | null
    /** Saved destination for "Send test" probes. Auto-fills the
     *  test-send input on this tab if present. */
    test_phone: string | null
    enabled: boolean
    last_test_at: string | Date | null
    last_test_ok: boolean | null
    last_test_error: string | null
}

type Draft = {
    token: string // "" = unchanged — REST API token (sends)
    dashboard_token: string // "" = unchanged — dashboard JWT (template management)
    sender_phone: string
    test_phone: string
    enabled: boolean
}

const emptyDraft = (): Draft => ({
    token: "",
    dashboard_token: "",
    sender_phone: "",
    test_phone: "",
    enabled: true,
})

export default function PolyginSettingsTab() {
    const [loading, setLoading] = useState(true)
    const [saving, setSaving] = useState(false)
    const [testing, setTesting] = useState(false)
    const [view, setView] = useState<ConfigView | null>(null)
    const [draft, setDraft] = useState<Draft>(emptyDraft())
    const [testTo, setTestTo] = useState("")

    const load = async () => {
        setLoading(true)
        try {
            const r = await fetch("/admin/communication/polygin/config", {
                credentials: "include",
            })
            const data = (await r.json()) as ConfigView
            setView(data)
            setDraft({
                token: "",
                dashboard_token: "",
                sender_phone: data.sender_phone ?? "",
                test_phone: data.test_phone ?? "",
                enabled: !!data.enabled,
            })
            // Pre-populate the test-send input from the saved value so
            // the operator can hit "Send test" without retyping.
            if (data.test_phone) setTestTo(data.test_phone)
        } catch (err: any) {
            toast.error("Failed to load Polygin config", {
                description: err?.message,
            })
        } finally {
            setLoading(false)
        }
    }

    useEffect(() => {
        load()
    }, [])

    /** clearWhich=undefined → save normal; "api" wipes the REST API
     *  token; "dashboard" wipes the dashboard JWT. */
    const save = async (clearWhich?: "api" | "dashboard") => {
        setSaving(true)
        try {
            const body: any = {
                sender_phone: draft.sender_phone || null,
                test_phone: draft.test_phone || null,
                enabled: draft.enabled,
            }
            if (clearWhich === "api") {
                body.token = null
            } else if (draft.token.length > 0) {
                body.token = draft.token
            }
            if (clearWhich === "dashboard") {
                body.dashboard_token = null
            } else if (draft.dashboard_token.length > 0) {
                body.dashboard_token = draft.dashboard_token
            }
            const r = await fetch("/admin/communication/polygin/config", {
                method: "PUT",
                credentials: "include",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(body),
            })
            if (!r.ok) {
                const e = await r.json().catch(() => ({}))
                throw new Error(e.message || `Save failed (${r.status})`)
            }
            const data = (await r.json()) as ConfigView
            setView(data)
            setDraft((d) => ({ ...d, token: "", dashboard_token: "" }))
            // Reflect newly-saved test_phone in the inline test input
            // so "Send test" works without retyping.
            if (data.test_phone) setTestTo(data.test_phone)
            toast.success("Polygin config saved")
        } catch (err: any) {
            toast.error("Couldn't save Polygin config", {
                description: err?.message,
            })
        } finally {
            setSaving(false)
        }
    }

    const runTest = async () => {
        if (!testTo) {
            toast.error("Enter a phone number for the test WhatsApp")
            return
        }
        setTesting(true)
        try {
            const r = await fetch("/admin/communication/polygin/test", {
                method: "POST",
                credentials: "include",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ to: testTo }),
            })
            const data = await r.json()
            if (data.ok) {
                toast.success("Polygin test message sent", {
                    description: data.message,
                })
            } else {
                toast.error("Polygin test failed", {
                    description: data.message,
                })
            }
            load()
        } catch (err: any) {
            toast.error("Polygin test failed", { description: err?.message })
        } finally {
            setTesting(false)
        }
    }

    if (loading) {
        return (
            <Text className="text-ui-fg-muted">
                Loading Polygin settings…
            </Text>
        )
    }

    const testStatus = view?.last_test_at
        ? view.last_test_ok
            ? { color: "green" as const, label: "Last test: OK" }
            : { color: "red" as const, label: "Last test: Failed" }
        : { color: "grey" as const, label: "Never tested" }

    const hasUnsaved =
        !!view &&
        (draft.sender_phone !== (view.sender_phone ?? "") ||
            draft.enabled !== !!view.enabled ||
            draft.token.length > 0 ||
            draft.dashboard_token.length > 0)

    return (
        <div className="flex flex-col gap-6 max-w-3xl">
            <div className="flex items-start justify-between gap-4">
                <div>
                    <Heading level="h2">Polygin WhatsApp connection</Heading>
                    <Text className="text-ui-fg-muted" size="small">
                        Outgoing WhatsApp runs through Polygin&apos;s REST
                        API. This is the primary channel for phone OTPs —
                        MSG91 only kicks in when WhatsApp delivery fails.
                    </Text>
                </div>
                <Badge color={testStatus.color}>{testStatus.label}</Badge>
            </div>

            {view && (
                <div
                    className={
                        "rounded-lg border p-3 flex items-start gap-3 " +
                        (view.enabled
                            ? "border-ui-tag-green-border bg-ui-tag-green-bg"
                            : "border-ui-tag-orange-border bg-ui-tag-orange-bg")
                    }
                >
                    <div className="mt-0.5">
                        <span
                            className={
                                "inline-block h-2.5 w-2.5 rounded-full " +
                                (view.enabled
                                    ? "bg-ui-tag-green-icon"
                                    : "bg-ui-tag-orange-icon")
                            }
                        />
                    </div>
                    <div className="flex-1">
                        <Text size="small" className="font-medium">
                            {view.enabled
                                ? "Polygin WhatsApp is active."
                                : "Polygin WhatsApp is paused."}
                        </Text>
                        <Text size="xsmall" className="text-ui-fg-muted">
                            {view.enabled
                                ? "Phone OTPs and notifications go via WhatsApp first; SMS is the fallback."
                                : "All phone messages route directly to MSG91 SMS while this is paused."}
                        </Text>
                    </div>
                </div>
            )}

            {hasUnsaved && (
                <div className="rounded-lg border border-ui-tag-orange-border bg-ui-tag-orange-bg p-3">
                    <Text size="small" className="font-medium">
                        Unsaved changes
                    </Text>
                </div>
            )}

            {view?.last_test_error && (
                <div className="rounded-lg border border-ui-border-error bg-ui-bg-subtle-pressed/40 p-3">
                    <Text size="xsmall" className="font-mono text-ui-fg-error">
                        {view.last_test_error}
                    </Text>
                </div>
            )}

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <Field
                    label="REST API token"
                    hint={
                        view?.token_set
                            ? "Stored. Leave blank to keep; paste a new one to replace."
                            : "Paste the JWT shown on https://polyg.in/user/?page=wa-qr-rest-api (used for /api/v1/send_templet + /api/qr/rest/send_message)."
                    }
                >
                    <div className="flex items-center gap-2">
                        <Input
                            type="password"
                            value={draft.token}
                            onChange={(e) =>
                                setDraft({ ...draft, token: e.target.value })
                            }
                            placeholder={
                                view?.token_set
                                    ? "••••••••"
                                    : "eyJhbGciOiJIUzI1Ni…"
                            }
                        />
                        {view?.token_set && (
                            <Button
                                size="small"
                                variant="secondary"
                                onClick={() => save("api")}
                                disabled={saving}
                            >
                                Clear
                            </Button>
                        )}
                    </div>
                </Field>
                <Field
                    label="Sender phone (E.164)"
                    hint="The WhatsApp-enabled number Polygin has provisioned."
                >
                    <Input
                        type="tel"
                        value={draft.sender_phone}
                        onChange={(e) =>
                            setDraft({
                                ...draft,
                                sender_phone: e.target.value,
                            })
                        }
                        placeholder="+919876543210"
                    />
                </Field>
                <Field
                    label="Test phone (E.164)"
                    hint="Saved destination for the 'Send test' button below. E.164. Optional — left blank, you'll type the phone manually each time."
                >
                    <Input
                        type="tel"
                        value={draft.test_phone}
                        onChange={(e) =>
                            setDraft({
                                ...draft,
                                test_phone: e.target.value,
                            })
                        }
                        placeholder="+918861577838"
                    />
                </Field>
            </div>

            {/* Optional dashboard JWT — gates the auto-push + auto-sync
                features on the WhatsApp Templates tab. The manual
                copy-and-paste flow works without it. */}
            <div className="rounded-lg border border-ui-tag-blue-border bg-ui-tag-blue-bg p-4 flex flex-col gap-3">
                <div>
                    <Label className="!font-medium">
                        Dashboard token (optional — for template push +
                        status sync)
                    </Label>
                    <Text size="xsmall" className="text-ui-fg-muted">
                        Polygin&apos;s template-management endpoints
                        (<code>/api/user/add_meta_templet</code> + {" "}
                        <code>get_my_meta_templets_beta</code>) reject the
                        public REST API token, so we capture a separate
                        dashboard session JWT for the automated flow.
                        Without it the manual <b>Copy for polyg.in</b> +
                        manual approval flow still works fine.
                    </Text>
                </div>

                <div className="rounded border border-ui-border-base bg-ui-bg-base p-3">
                    <Text size="small" className="font-medium">
                        How to capture the token (one-time setup)
                    </Text>
                    <ol className="mt-2 space-y-2 list-decimal list-inside text-xs text-ui-fg-base">
                        <li>
                            Open{" "}
                            <a
                                href="https://polyg.in/user/"
                                target="_blank"
                                rel="noreferrer"
                                className="underline font-medium"
                            >
                                polyg.in/user
                            </a>{" "}
                            in another tab and log in.
                        </li>
                        <li>
                            Open browser DevTools → Console
                            (<code>F12</code> or{" "}
                            <code>Cmd+Option+I</code> on macOS).
                        </li>
                        <li>
                            Paste the snippet below into the console and
                            press Enter — the JWT lands in your clipboard.
                            <div className="mt-1 flex items-center gap-2">
                                <code className="flex-1 rounded bg-ui-bg-subtle px-2 py-1 font-mono text-xs">
                                    copy(localStorage.wacrm_user)
                                </code>
                                <Button
                                    size="small"
                                    variant="secondary"
                                    onClick={async () => {
                                        try {
                                            await navigator.clipboard.writeText(
                                                "copy(localStorage.wacrm_user)",
                                            )
                                            toast.success(
                                                "Snippet copied — paste into the polyg.in DevTools console.",
                                            )
                                        } catch (err: any) {
                                            toast.error("Copy failed", {
                                                description: err?.message,
                                            })
                                        }
                                    }}
                                >
                                    Copy snippet
                                </Button>
                            </div>
                        </li>
                        <li>
                            Paste the JWT into the field below (~316
                            characters, starts with{" "}
                            <code>eyJhbG…</code>).
                        </li>
                        <li>
                            Click <b>Save settings</b>.
                        </li>
                    </ol>
                    <Text size="xsmall" className="text-ui-fg-muted mt-2">
                        Heads up: the JWT expires when your polyg.in
                        session ends. If push/sync starts failing with auth
                        errors, repeat steps 1–5 to capture a fresh token.
                    </Text>
                </div>

                <div className="flex items-center gap-2">
                    <Input
                        type="password"
                        value={draft.dashboard_token}
                        onChange={(e) =>
                            setDraft({
                                ...draft,
                                dashboard_token: e.target.value,
                            })
                        }
                        placeholder={
                            view?.dashboard_token_set
                                ? "••••••••"
                                : "eyJhbGciOiJIUzI1Ni…"
                        }
                    />
                    {view?.dashboard_token_set && (
                        <Button
                            size="small"
                            variant="secondary"
                            onClick={() => save("dashboard")}
                            disabled={saving}
                        >
                            Clear
                        </Button>
                    )}
                </div>
                <Text size="xsmall" className="text-ui-fg-muted">
                    {view?.dashboard_token_set
                        ? "Stored — automatic push + sync are enabled."
                        : "Not set — automatic push + sync are disabled. Manual flow on the WhatsApp Templates tab still works."}
                </Text>
            </div>

            <div className="rounded-lg border border-ui-border-base p-4 flex items-start gap-3">
                <Switch
                    checked={draft.enabled}
                    onCheckedChange={(v) =>
                        setDraft({ ...draft, enabled: !!v })
                    }
                    className="mt-0.5"
                />
                <div className="flex-1">
                    <Label className="!font-medium">
                        {draft.enabled
                            ? "WhatsApp delivery is ON"
                            : "WhatsApp delivery is OFF"}
                    </Label>
                    <Text size="xsmall" className="text-ui-fg-muted">
                        {draft.enabled
                            ? "Phone OTPs and notifications are sent via WhatsApp first; MSG91 SMS is only used as a fallback when WhatsApp delivery fails."
                            : "WhatsApp is paused. Every phone message routes directly through MSG91 SMS — make sure SMS is also configured or sends will fail."}
                    </Text>
                </div>
            </div>

            <div className="flex items-center gap-2">
                <Button onClick={() => save()} disabled={saving}>
                    {saving ? "Saving…" : "Save settings"}
                </Button>
                <Button
                    variant="secondary"
                    onClick={load}
                    disabled={saving}
                >
                    Revert
                </Button>
            </div>

            <div className="h-px bg-ui-border-base my-2" />

            <div>
                <Heading level="h3">Test WhatsApp</Heading>
                <Text className="text-ui-fg-muted" size="small">
                    Sends a one-line probe via Polygin. The recipient must
                    have WhatsApp installed and accept messages from the
                    sender phone.
                </Text>
                <div className="mt-3 flex items-center gap-2 flex-wrap">
                    <Input
                        type="tel"
                        value={testTo}
                        onChange={(e) => setTestTo(e.target.value)}
                        placeholder="+919876543210"
                        className="max-w-xs"
                    />
                    <Button
                        onClick={runTest}
                        disabled={
                            testing || !view?.configured || !testTo
                        }
                    >
                        {testing ? "Sending…" : "Send test message"}
                    </Button>
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
