// @ts-nocheck
import React, { useEffect, useState } from "react"
import {
    Button,
    Input,
    Text,
    Select,
    Table,
    StatusBadge,
    toast,
} from "@medusajs/ui"

/**
 * Paginated viewer for outbound WhatsApp attempts. Same shape as the
 * SMS log — kept as separate components rather than a parameterised one
 * so each can grow independently (e.g. WhatsApp will likely add media-
 * type columns later).
 */
type LogRow = {
    id: string
    to_phone: string
    body: string | null
    provider: string
    status: "sent" | "failed" | "skipped"
    error: string | null
    provider_message_id: string | null
    otp_request_id: string | null
    meta: any
    created_at: string
}

const PAGE = 50

export default function WhatsappLogsTab() {
    const [rows, setRows] = useState<LogRow[]>([])
    const [loading, setLoading] = useState(true)
    const [offset, setOffset] = useState(0)
    const [total, setTotal] = useState(0)
    const [status, setStatus] = useState<"all" | "sent" | "failed" | "skipped">(
        "all",
    )
    const [q, setQ] = useState("")
    const [expanded, setExpanded] = useState<string | null>(null)

    const load = async (nextOffset = offset) => {
        setLoading(true)
        try {
            const params = new URLSearchParams()
            params.set("limit", String(PAGE))
            params.set("offset", String(nextOffset))
            if (status !== "all") params.set("status", status)
            if (q.trim()) params.set("q", q.trim())
            const r = await fetch(
                `/admin/communication/whatsapp-logs?${params.toString()}`,
                { credentials: "include" },
            )
            const data = await r.json()
            setRows(data.logs || [])
            setTotal(data.count || 0)
            setOffset(nextOffset)
        } catch (err: any) {
            toast.error("Failed to load WhatsApp logs", {
                description: err?.message,
            })
        } finally {
            setLoading(false)
        }
    }

    useEffect(() => {
        load(0)
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [status])

    const showingStart = rows.length > 0 ? offset + 1 : 0
    const showingEnd = offset + rows.length

    const statusColor = (s: LogRow["status"]) =>
        s === "sent"
            ? ("green" as const)
            : s === "failed"
              ? ("red" as const)
              : ("grey" as const)

    return (
        <div className="flex flex-col gap-4">
            <div className="flex items-center gap-3 flex-wrap">
                <Input
                    placeholder="Search phone or error…"
                    value={q}
                    onChange={(e) => setQ(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && load(0)}
                    className="max-w-sm"
                />
                <Select
                    value={status}
                    onValueChange={(v) =>
                        setStatus(v as typeof status)
                    }
                >
                    <Select.Trigger className="w-44">
                        <Select.Value placeholder="Status" />
                    </Select.Trigger>
                    <Select.Content>
                        <Select.Item value="all">All</Select.Item>
                        <Select.Item value="sent">Sent</Select.Item>
                        <Select.Item value="failed">Failed</Select.Item>
                        <Select.Item value="skipped">Skipped</Select.Item>
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
                            <Table.HeaderCell>To phone</Table.HeaderCell>
                            <Table.HeaderCell>Status</Table.HeaderCell>
                            <Table.HeaderCell>Provider msg id</Table.HeaderCell>
                            <Table.HeaderCell>Error</Table.HeaderCell>
                            <Table.HeaderCell>Body</Table.HeaderCell>
                        </Table.Row>
                    </Table.Header>
                    <Table.Body>
                        {rows.map((r) => (
                            <Table.Row key={r.id}>
                                <Table.Cell>
                                    {new Date(r.created_at).toLocaleString()}
                                </Table.Cell>
                                <Table.Cell>{r.to_phone}</Table.Cell>
                                <Table.Cell>
                                    <StatusBadge color={statusColor(r.status)}>
                                        {r.status}
                                    </StatusBadge>
                                </Table.Cell>
                                <Table.Cell className="font-mono text-xs">
                                    {r.provider_message_id ?? "—"}
                                </Table.Cell>
                                <Table.Cell className="max-w-xs truncate">
                                    {r.error && (
                                        <span className="text-ui-fg-error">
                                            {r.error}
                                        </span>
                                    )}
                                </Table.Cell>
                                <Table.Cell>
                                    {r.body ? (
                                        <Button
                                            size="small"
                                            variant="secondary"
                                            onClick={() =>
                                                setExpanded(
                                                    expanded === r.id
                                                        ? null
                                                        : r.id,
                                                )
                                            }
                                        >
                                            {expanded === r.id
                                                ? "Hide"
                                                : "Show"}
                                        </Button>
                                    ) : (
                                        "—"
                                    )}
                                </Table.Cell>
                            </Table.Row>
                        ))}
                        {!loading && rows.length === 0 && (
                            <Table.Row>
                                {/*@ts-ignore*/}<Table.Cell colSpan={6}>
                                    <Text className="text-ui-fg-muted py-6 text-center">
                                        No WhatsApp logs match the current filter.
                                    </Text>
                                </Table.Cell>
                            </Table.Row>
                        )}
                    </Table.Body>
                </Table>
            </div>

            {expanded &&
                (() => {
                    const row = rows.find((r) => r.id === expanded)
                    if (!row?.body) return null
                    return (
                        <div className="rounded border border-ui-border-base p-3">
                            <Text size="xsmall" className="text-ui-fg-muted">
                                Body (sensitive — may contain a plaintext OTP)
                            </Text>
                            <pre className="mt-1 whitespace-pre-wrap font-mono text-xs">
                                {row.body}
                            </pre>
                        </div>
                    )
                })()}

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
