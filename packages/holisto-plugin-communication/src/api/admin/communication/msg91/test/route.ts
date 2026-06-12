// @ts-nocheck
import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { z } from "zod"
import {
    COMMUNICATION_MODULE,
    CommunicationModuleService,
} from "../../../../../modules/communication"

/**
 * POST /admin/communication/msg91/test
 *
 * Sends a one-line probe SMS to the address in the payload via the
 * MSG91 Flow API. Updates `last_test_*` on Msg91Config so the Settings
 * tab can show the result. Live-only (no useful "dry-run" since MSG91
 * Flow doesn't expose a separate verify call).
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

        const cfg = await mod.getMsg91ConfigDecrypted()
        if (!cfg || !cfg.auth_key || !cfg.sender_id || !cfg.sms_template_id) {
            return res.status(400).json({
                ok: false,
                message:
                    "MSG91 isn't fully configured. Set auth_key, sender_id, and sms_template_id first.",
            })
        }

        const result = await mod.sendSms({
            to: parsed.data.to,
            body: "Admin SMS test — if you received this, MSG91 is configured correctly.",
        })

        if (!result.ok) {
            const reason = "reason" in result ? result.reason : "unknown"
            await mod.recordMsg91TestResult(false, reason)
            return res.json({
                ok: false,
                message: reason,
            })
        }
        await mod.recordMsg91TestResult(true, null)
        return res.json({
            ok: true,
            message_id: result.message_id,
            message: `Test SMS sent to ${parsed.data.to}.`,
        })
    } catch (err: any) {
        console.error("[admin/communication/msg91/test] POST failed:", err)
        return res
            .status(500)
            .json({ ok: false, message: err?.message || "Test failed" })
    }
}
