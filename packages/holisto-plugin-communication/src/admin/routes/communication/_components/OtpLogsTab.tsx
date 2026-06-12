// @ts-nocheck
import React, { useEffect, useState } from "react"
import {
    Button,
    Select,
    Text,
    Table,
    StatusBadge,
    toast,
} from "@medusajs/ui"

/**
 * Read-only viewer for phone-OTP requests. Plaintext OTPs are NEVER
 * stored — each row carries only metadata (phone, purpose, sent_via,
 * derived status, expiry, attempt count).
 *
 * `derived_status` ∈ "live" | "consumed" | "expired" | "exhausted" — the
 * server computes it from `consumed_at` / `expires_at` / `attempts` so
 * the UI doesn't have to.
 */
type OtpRow = {
    id: string
    phone_e164: string
    purpose: "login" | "verify"
    customer_id: string | null
    attempts: number
    max_attempts: number
    expires_at: string
    consumed_at: string | null
    sent_via: "whatsapp" | "sms" | "failed" | null
    created_at: string
    derived_status: "live" | "consumed" | "expired" | "exhausted"
}

const PAGE = 50

export default function OtpLogsTab() {
    const [rows, setRows] = useState<OtpRow[]>([])
    const [loading, setLoading] = useState(true)
    const [offset, setOffset] = useState(0)
    const [total, setTotal] = useState(0)
    const [purpose, setPurpose] = useState<"all" | "login" | "verify">("all")

    const load = async (nextOffset = offset) => {
        setLoading(true)
        try {
            const params = new URLSearchParams()
            params.set("limit", String(PAGE))
            params.set("offset", String(nextOffset))
            if (purpose !== "all") params.set("purpose", purpose)
            const r = await fetch(
                `/admin/communication/otp-requests?${params.toString()}`,
                { credentials: "include" },
            )
            const data = await r.json()
            setRows(data.requests || [])
            setTotal(data.count || 0)
            setOffset(nextOffset)
        } catch (err: any) {
            toast.error("Failed to load OTP requests", {
                description: err?.message,
            })
        } finally {
            setLoading(false)
        }
    }

    useEffect(() => {
        load(0)
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [purpose])

    const showingStart = rows.length > 0 ? offset + 1 : 0
    const showingEnd = offset + rows.length

    const sentViaColor = (s: OtpRow["sent_via"]) =>
        s === "whatsapp"
            ? ("green" as const)
            : s === "sms"
              ? ("blue" as const)
              : s === "failed"
                ? ("red" as const)
                : ("grey" as const)

    const derivedColor = (s: OtpRow["derived_status"]) =>
        s === "consumed"
            ? ("green" as const)
            : s === "live"
              ? ("blue" as const)
              : ("grey" as const)

    return (
        <div className="flex flex-col gap-4">
            <div>
                <Text size="small" className="text-ui-fg-muted">
                    OTP plaintext is never stored — these rows are
                    metadata-only. Use them to trace delivery channel
                    (WhatsApp vs SMS), debug failed attempts, and confirm
                    the rate limits are doing their job.
                </Text>
            </div>
            <div className="flex items-center gap-3 flex-wrap">
                <Select
                    value={purpose}
                    onValueChange={(v) =>
                        setPurpose(v as typeof purpose)
                    }
                >
                    <Select.Trigger className="w-44">
                        <Select.Value placeholder="Purpose" />
                    </Select.Trigger>
                    <Select.Content>
                        <Select.Item value="all">All purposes</Select.Item>
                        <Select.Item value="login">Login</Select.Item>
                        <Select.Item value="verify">Verify</Select.Item>
                    </Select.Content>
                </Select>
                <Button variant="secondary" onClick={() => load(0)}>
                    Refresh
                </Button>
                <Text size="xsmall" className="text-ui-fg-muted ml-auto">
                    {loading
                        ? "Loading…"
                        : `${showingStart}–${showingEnd} of ${total}`}
                </Text>
            </div>

            <div className="overflow-x-auto rounded border border-ui-border-base">
                <Table>
                    <Table.Header>
                        <Table.Row>
                            <Table.HeaderCell>When</Table.HeaderCell>
                            <Table.HeaderCell>Phone</Table.HeaderCell>
                            <Table.HeaderCell>Purpose</Table.HeaderCell>
                            <Table.HeaderCell>Sent via</Table.HeaderCell>
                            <Table.HeaderCell>Status</Table.HeaderCell>
                            <Table.HeaderCell>Attempts</Table.HeaderCell>
                            <Table.HeaderCell>Expires</Table.HeaderCell>
                        </Table.Row>
                    </Table.Header>
                    <Table.Body>
                        {rows.map((r) => (
                            <Table.Row key={r.id}>
                                <Table.Cell>
                                    {new Date(r.created_at).toLocaleString()}
                                </Table.Cell>
                                <Table.Cell>{r.phone_e164}</Table.Cell>
                                <Table.Cell>{r.purpose}</Table.Cell>
                                <Table.Cell>
                                    <StatusBadge
                                        color={sentViaColor(r.sent_via)}
                                    >
                                        {r.sent_via ?? "—"}
                                    </StatusBadge>
                                </Table.Cell>
                                <Table.Cell>
                                    <StatusBadge
                                        color={derivedColor(
                                            r.derived_status,
                                        )}
                                    >
                                        {r.derived_status}
                                    </StatusBadge>
                                </Table.Cell>
                                <Table.Cell>
                                    {r.attempts}/{r.max_attempts}
                                </Table.Cell>
                                <Table.Cell>
                                    {new Date(r.expires_at).toLocaleString()}
                                </Table.Cell>
                            </Table.Row>
                        ))}
                        {!loading && rows.length === 0 && (
                            <Table.Row>
                                {/*@ts-ignore*/}<Table.Cell colSpan={7}>
                                    <Text className="text-ui-fg-muted py-6 text-center">
                                        No OTP requests yet.
                                    </Text>
                                </Table.Cell>
                            </Table.Row>
                        )}
                    </Table.Body>
                </Table>
            </div>

            <div className="flex items-center gap-2">
                <Button
                    size="small"
                    variant="secondary"
                    disabled={offset === 0 || loading}
                    onClick={() => load(Math.max(0, offset - PAGE))}
                >
                    Previous
                </Button>
                <Button
                    size="small"
                    variant="secondary"
                    disabled={loading || offset + rows.length >= total}
                    onClick={() => load(offset + PAGE)}
                >
                    Next
                </Button>
            </div>
        </div>
    )
}
