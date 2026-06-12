// @ts-nocheck
import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { z } from "zod"
import {
    COMMUNICATION_MODULE,
    CommunicationModuleService,
} from "../../../../../modules/communication"

/**
 * GET  /admin/communication/msg91/config — fetch MSG91 SMS config
 *                                          (auth_key redacted).
 * PUT  /admin/communication/msg91/config — upsert. The auth_key follows
 *                                          the same `""=keep / null=clear /
 *                                          string=replace` rule we use
 *                                          for the SMTP password.
 */
const UpsertSchema = z.object({
    auth_key: z.string().nullable().optional(),
    sender_id: z.string().min(1).max(11).nullable().optional(),
    sms_template_id: z.string().nullable().optional(),
    otp_template_id: z.string().nullable().optional(),
    enabled: z.boolean().optional(),
})

export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
    try {
        const mod = req.scope.resolve(
            COMMUNICATION_MODULE,
        ) as CommunicationModuleService
        const view = await mod.getMsg91ConfigView()
        return res.json(view)
    } catch (err: any) {
        console.error("[admin/communication/msg91/config] GET failed:", err)
        return res
            .status(500)
            .json({ message: err?.message || "Failed to load MSG91 config" })
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
        // "" means "keep existing" — strip it before passing through.
        if (typeof input.auth_key === "string" && input.auth_key.length === 0) {
            delete input.auth_key
        }
        const mod = req.scope.resolve(
            COMMUNICATION_MODULE,
        ) as CommunicationModuleService
        const view = await mod.upsertMsg91Config(input)
        return res.json(view)
    } catch (err: any) {
        console.error("[admin/communication/msg91/config] PUT failed:", err)
        return res
            .status(500)
            .json({ message: err?.message || "Failed to save MSG91 config" })
    }
}
