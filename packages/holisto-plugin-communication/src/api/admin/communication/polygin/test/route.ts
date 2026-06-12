// @ts-nocheck
import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { z } from "zod"
import {
    COMMUNICATION_MODULE,
    CommunicationModuleService,
} from "../../../../../modules/communication"

/**
 * POST /admin/communication/polygin/test
 *
 * Sends a one-line probe WhatsApp message to the address in the payload
 * via Polygin. Updates `last_test_*` on PolyginConfig.
 */
const BodySchema = z.object({
    /** Recipient in E.164 form ("+919876543210"). */
    to: z.string().min(8).max(20),
})

export const POST = async (req: MedusaRequest, res: MedusaResponse) => {
    try {
        const parsed = BodySchema.safeParse(req.body ?? {})
        if (!parsed.success) {
            return res
                .status(400)
                .json({ ok: false, message: "Invalid payload" })
        }

        const mod = req.scope.resolve(
            COMMUNICATION_MODULE,
        ) as CommunicationModuleService

        const cfg = await mod.getPolyginConfigDecrypted()
        if (!cfg || !cfg.token || !cfg.sender_phone) {
            return res.status(400).json({
                ok: false,
                message:
                    "Polygin isn't fully configured. Set token + sender_phone first.",
            })
        }

        const result = await mod.sendWhatsapp({
            to: parsed.data.to,
            text: "Admin WhatsApp test — if you received this, Polygin is configured correctly.",
        })

        if (!result.ok) {
            const reason = "reason" in result ? result.reason : "unknown"
            await mod.recordPolyginTestResult(false, reason)
            return res.json({
                ok: false,
                message: reason,
            })
        }
        await mod.recordPolyginTestResult(true, null)
        return res.json({
            ok: true,
            message_id: result.message_id,
            message: `Test WhatsApp message sent to ${parsed.data.to}.`,
        })
    } catch (err: any) {
        console.error("[admin/communication/polygin/test] POST failed:", err)
        return res
            .status(500)
            .json({ ok: false, message: err?.message || "Test failed" })
    }
}
