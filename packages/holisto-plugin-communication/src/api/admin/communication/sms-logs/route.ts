// @ts-nocheck
import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import {
    COMMUNICATION_MODULE,
    CommunicationModuleService,
} from "../../../../modules/communication"

/**
 * GET /admin/communication/sms-logs
 *   query: limit (default 50, max 500), offset (default 0),
 *          status sent|failed|skipped (optional),
 *          q substring match on to_phone or error (optional)
 *
 * Newest-first. The body column is admin-only (it can contain plaintext
 * OTPs) — never proxy this route through the storefront.
 */
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
        if (q.status && ["sent", "failed", "skipped"].includes(q.status)) {
            filters.status = q.status
        }

        const [logs, count] = await (mod as any).listAndCountSmsLogs(
            filters,
            { order: { created_at: "DESC" }, take: limit, skip: offset },
        )

        const needle = (q.q || "").trim().toLowerCase()
        const filtered = needle
            ? logs.filter(
                  (r: any) =>
                      (r.to_phone || "").toLowerCase().includes(needle) ||
                      (r.error || "").toLowerCase().includes(needle),
              )
            : logs

        return res.json({ logs: filtered, count, limit, offset })
    } catch (err: any) {
        console.error("[admin/communication/sms-logs] GET failed:", err)
        return res
            .status(500)
            .json({ message: err?.message || "Failed to load SMS logs" })
    }
}
