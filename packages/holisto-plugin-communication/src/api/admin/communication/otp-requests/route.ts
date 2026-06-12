// @ts-nocheck
import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import {
    COMMUNICATION_MODULE,
    CommunicationModuleService,
} from "../../../../modules/communication"

/**
 * GET /admin/communication/otp-requests
 *
 * Read-only paginated view of OTP requests. The plaintext OTP is never
 * stored anywhere, so the columns we return are purely metadata — phone,
 * purpose, sent_via, status (computed from consumed_at + expires_at +
 * attempts), expiry, attempt count.
 */
type Row = {
    id: string
    phone_e164: string
    purpose: "login" | "verify"
    customer_id: string | null
    attempts: number
    max_attempts: number
    expires_at: Date
    consumed_at: Date | null
    sent_via: "whatsapp" | "sms" | "failed" | null
    created_at: Date
}

function deriveStatus(
    row: Row,
): "consumed" | "expired" | "exhausted" | "live" {
    if (row.consumed_at) return "consumed"
    if (new Date(row.expires_at).getTime() < Date.now()) return "expired"
    if ((row.attempts ?? 0) >= (row.max_attempts ?? 5)) return "exhausted"
    return "live"
}

export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
    try {
        const mod = req.scope.resolve(
            COMMUNICATION_MODULE,
        ) as CommunicationModuleService
        const q = req.query as Record<string, string | undefined>

        const limit = Math.max(
            1,
            Math.min(500, Number.parseInt(q.limit ?? "50", 10) || 50),
        )
        const offset = Math.max(0, Number.parseInt(q.offset ?? "0", 10) || 0)

        const filters: any = {}
        if (q.purpose && ["login", "verify"].includes(q.purpose)) {
            filters.purpose = q.purpose
        }

        const [rows, count] = await (mod as any).listAndCountOtpRequests(
            filters,
            { order: { created_at: "DESC" }, take: limit, skip: offset },
        )

        const decorated = (rows as Row[]).map((r) => ({
            id: r.id,
            phone_e164: r.phone_e164,
            purpose: r.purpose,
            customer_id: r.customer_id,
            attempts: r.attempts,
            max_attempts: r.max_attempts,
            expires_at: r.expires_at,
            consumed_at: r.consumed_at,
            sent_via: r.sent_via,
            created_at: r.created_at,
            derived_status: deriveStatus(r),
        }))

        return res.json({ requests: decorated, count, limit, offset })
    } catch (err: any) {
        console.error("[admin/communication/otp-requests] GET failed:", err)
        return res
            .status(500)
            .json({ message: err?.message || "Failed to load OTP requests" })
    }
}
