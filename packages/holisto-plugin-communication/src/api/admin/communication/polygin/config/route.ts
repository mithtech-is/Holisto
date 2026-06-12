// @ts-nocheck
import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { z } from "zod"
import {
    COMMUNICATION_MODULE,
    CommunicationModuleService,
} from "../../../../../modules/communication"

/**
 * GET  /admin/communication/polygin/config — fetch Polygin WhatsApp
 *                                            config (token redacted).
 * PUT  /admin/communication/polygin/config — upsert. `token` follows the
 *                                            same `""=keep / null=clear /
 *                                            string=replace` rule used by
 *                                            SMTP password + MSG91 auth.
 */
const UpsertSchema = z.object({
    /** REST API token — used for /api/qr/rest/send_message +
     *  /api/v1/send_templet. Shown on polyg.in's Rest API /
     *  Conversational API / Template API pages. REQUIRED for sends. */
    token: z.string().nullable().optional(),
    /** Dashboard JWT — captured from localStorage.wacrm_user on
     *  polyg.in. OPTIONAL: only used by the template-management
     *  endpoints (status sync + push template). The manual
     *  copy-and-paste flow works without it. */
    dashboard_token: z.string().nullable().optional(),
    /** Sender phone in E.164 form. The Polygin API requires a country
     *  code; we accept either "+91…" or "91…" and normalize to "+91…"
     *  on save. */
    sender_phone: z.string().min(8).max(20).nullable().optional(),
    /** Saved destination for "Send test" probes. E.164. Same
     *  normalization as sender_phone. */
    test_phone: z.string().min(8).max(20).nullable().optional(),
    enabled: z.boolean().optional(),
})

function normalizeE164(phone: string | null | undefined): string | null {
    if (!phone) return null
    const trimmed = phone.trim()
    if (trimmed.startsWith("+")) return trimmed
    return `+${trimmed.replace(/\D/g, "")}`
}

export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
    try {
        const mod = req.scope.resolve(
            COMMUNICATION_MODULE,
        ) as CommunicationModuleService
        const view = await mod.getPolyginConfigView()
        return res.json(view)
    } catch (err: any) {
        console.error("[admin/communication/polygin/config] GET failed:", err)
        return res
            .status(500)
            .json({ message: err?.message || "Failed to load Polygin config" })
    }
}

export const PUT = async (req: MedusaRequest, res: MedusaResponse) => {
    try {
        const parsed = UpsertSchema.safeParse(req.body)
        if (!parsed.success) {
            return res.status(400).json({
                message: "Invalid payload",
                errors: parsed.error.flatten(),
            })
        }
        const input = { ...parsed.data }
        if (typeof input.token === "string" && input.token.length === 0) {
            delete input.token
        }
        if (
            typeof input.dashboard_token === "string" &&
            input.dashboard_token.length === 0
        ) {
            delete input.dashboard_token
        }
        if (input.sender_phone !== undefined) {
            input.sender_phone = normalizeE164(input.sender_phone)
        }
        if (input.test_phone !== undefined) {
            input.test_phone = normalizeE164(input.test_phone)
        }
        const mod = req.scope.resolve(
            COMMUNICATION_MODULE,
        ) as CommunicationModuleService
        const view = await mod.upsertPolyginConfig(input)
        return res.json(view)
    } catch (err: any) {
        console.error("[admin/communication/polygin/config] PUT failed:", err)
        return res
            .status(500)
            .json({ message: err?.message || "Failed to save Polygin config" })
    }
}
