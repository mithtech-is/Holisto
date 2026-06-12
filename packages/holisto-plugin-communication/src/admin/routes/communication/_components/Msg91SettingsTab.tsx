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
 * MSG91 SMS gateway settings — mirrors the SMTP SettingsTab's UX
 * deliberately so admins don't have to learn a second pattern. Backed by:
 *   GET  /admin/communication/msg91/config
 *   PUT  /admin/communication/msg91/config
 *   POST /admin/communication/msg91/test  { to }
 *
 * The auth_key follows the same secret-handling rule as SMTP password:
 * empty draft = leave existing, "Clear" button = clear, non-empty draft
 * = replace.
 */
type ConfigView = {
    configured: boolean
    auth_key_set: boolean
    sender_id: string | null
    sms_template_id: string | null
    otp_template_id: string | null
    enabled: boolean
    last_test_at: string | Date | null
    last_test_ok: boolean | null
    last_test_error: string | null
}

type Draft = {
    auth_key: string // "" = unchanged
    sender_id: string
    sms_template_id: string
    otp_template_id: string
    enabled: boolean
}

const emptyDraft = (): Draft => ({
    auth_key: "",
    sender_id: "",
    sms_template_id: "",
    otp_template_id: "",
    enabled: true,
})

export default function Msg91SettingsTab() {
    const [loading, setLoading] = useState(true)
    const [saving, setSaving] = useState(false)
    const [testing, setTesting] = useState(false)
    const [view, setView] = useState<ConfigView | null>(null)
    const [draft, setDraft] = useState<Draft>(emptyDraft())
    const [testTo, setTestTo] = useState("")

    const load = async () => {
        setLoading(true)
        try {
            const r = await fetch("/admin/communication/msg91/config", {
                credentials: "include",
            })
            const data = (await r.json()) as ConfigView
            setView(data)
            setDraft({
                auth_key: "",
                sender_id: data.sender_id ?? "",
                sms_template_id: data.sms_template_id ?? "",
                otp_template_id: data.otp_template_id ?? "",
                enabled: !!data.enabled,
            })
        } catch (err: any) {
            toast.error("Failed to load MSG91 config", {
                description: err?.message ?? "Unknown error",
            })
        } finally {
            setLoading(false)
        }
    }

    useEffect(() => {
        load()
    }, [])

    const save = async (clearKey: boolean = false) => {
        setSaving(true)
        try {
            const body: any = {
                sender_id: draft.sender_id || null,
                sms_template_id: draft.sms_template_id || null,
                otp_template_id: draft.otp_template_id || null,
                enabled: draft.enabled,
            }
            if (clearKey) {
                body.auth_key = null
            } else if (draft.auth_key.length > 0) {
                body.auth_key = draft.auth_key
            }
            const r = await fetch("/admin/communication/msg91/config", {
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
            setDraft((d) => ({ ...d, auth_key: "" }))
            toast.success("MSG91 config saved")
        } catch (err: any) {
            toast.error("Couldn't save MSG91 config", {
                description: err?.message,
            })
        } finally {
            setSaving(false)
        }
    }

    const runTest = async () => {
        if (!testTo) {
            toast.error("Enter a phone number for the test SMS")
            return
        }
        setTesting(true)
        try {
            const r = await fetch("/admin/communication/msg91/test", {
                method: "POST",
                credentials: "include",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ to: testTo }),
            })
            const data = await r.json()
            if (data.ok) {
                toast.success("MSG91 test SMS sent", {
                    description: data.message,
                })
            } else {
                toast.error("MSG91 test failed", { description: data.message })
            }
            load()
        } catch (err: any) {
            toast.error("MSG91 test failed", { description: err?.message })
        } finally {
            setTesting(false)
        }
    }

    if (loading) {
        return (
            <Text className="text-ui-fg-muted">Loading MSG91 settings…</Text>
        )
    }

    const testStatus = view?.last_test_at
        ? view.last_test_ok
            ? { color: "green" as const, label: "Last test: OK" }
            : { color: "red" as const, label: "Last test: Failed" }
        : { color: "grey" as const, label: "Never tested" }

    const hasUnsaved =
        !!view &&
        (draft.sender_id !== (view.sender_id ?? "") ||
            draft.sms_template_id !== (view.sms_template_id ?? "") ||
            draft.otp_template_id !== (view.otp_template_id ?? "") ||
            draft.enabled !== !!view.enabled ||
            draft.auth_key.length > 0)

    return (
        <div className="flex flex-col gap-6 max-w-3xl">
            <div className="flex items-start justify-between gap-4">
                <div>
                    <Heading level="h2">MSG91 SMS connection</Heading>
                    <Text className="text-ui-fg-muted" size="small">
                        Outgoing SMS runs through MSG91&apos;s Flow API. The
                        OTP fallback uses the OTP-specific DLT template id;
                        general SMS sends use the default template id.
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
                                ? "MSG91 SMS is active."
                                : "MSG91 SMS is paused."}
                        </Text>
                        <Text size="xsmall" className="text-ui-fg-muted">
                            {view.enabled
                                ? "Phone OTPs that can't be delivered via WhatsApp will fall through to SMS."
                                : "WhatsApp-only OTPs — no SMS fallback. Re-enable to restore delivery on devices without WhatsApp."}
                        </Text>
                    </div>
                </div>
            )}

            {hasUnsaved && (
                <div className="rounded-lg border border-ui-tag-orange-border bg-ui-tag-orange-bg p-3">
                    <Text size="small" className="font-medium">
                        Unsaved changes
                    </Text>
                    <Text size="xsmall" className="text-ui-fg-muted">
                        Click <b>Save settings</b> to persist.
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
                    label="Auth key"
                    hint={
                        view?.auth_key_set
                            ? "An auth_key is stored. Leave blank to keep, or paste a new one to replace."
                            : "Paste the MSG91 auth_key from your dashboard."
                    }
                >
                    <div className="flex items-center gap-2">
                        <Input
                            type="password"
                            value={draft.auth_key}
                            onChange={(e) =>
                                setDraft({ ...draft, auth_key: e.target.value })
                            }
                            placeholder={
                                view?.auth_key_set
                                    ? "••••••••"
                                    : "Paste auth_key"
                            }
                        />
                        {view?.auth_key_set && (
                            <Button
                                size="small"
                                variant="secondary"
                                onClick={() => save(true)}
                                disabled={saving}
                            >
                                Clear
                            </Button>
                        )}
                    </div>
                </Field>
                <Field
                    label="Sender ID"
                    hint="6-character DLT-approved sender header (e.g. POLMRC)."
                >
                    <Input
                        value={draft.sender_id}
                        maxLength={11}
                        onChange={(e) =>
                            setDraft({
                                ...draft,
                                sender_id: e.target.value.toUpperCase(),
                            })
                        }
                        placeholder="POLMRC"
                    />
                </Field>
                <Field
                    label="Default SMS template id"
                    hint="DLT-approved transactional template id used for general-purpose SMS sends."
                >
                    <Input
                        value={draft.sms_template_id}
                        onChange={(e) =>
                            setDraft({
                                ...draft,
                                sms_template_id: e.target.value,
                            })
                        }
                        placeholder="65f1b…"
                    />
                </Field>
                <Field
                    label="OTP template id"
                    hint="DLT-approved OTP template id used specifically for phone-OTP fallback. Body var1 is the OTP."
                >
                    <Input
                        value={draft.otp_template_id}
                        onChange={(e) =>
                            setDraft({
                                ...draft,
                                otp_template_id: e.target.value,
                            })
                        }
                        placeholder="65f1c…"
                    />
                </Field>
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
                            ? "SMS delivery is ON"
                            : "SMS delivery is OFF"}
                    </Label>
                    <Text size="xsmall" className="text-ui-fg-muted">
                        {draft.enabled
                            ? "MSG91 is the SMS fallback for phone OTPs and notifications when WhatsApp delivery fails."
                            : "MSG91 is paused. WhatsApp-only phone messages — if WhatsApp delivery fails, the user sees a full failure (no SMS attempted)."}
                    </Text>
                </div>
            </div>

            <div className="flex items-center gap-2">
                <Button onClick={() => save(false)} disabled={saving}>
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
                <Heading level="h3">Test SMS</Heading>
                <Text className="text-ui-fg-muted" size="small">
                    Sends a one-line probe through MSG91 Flow. Updates the
                    badge above based on the provider&apos;s response.
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
                        {testing ? "Sending…" : "Send test SMS"}
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
