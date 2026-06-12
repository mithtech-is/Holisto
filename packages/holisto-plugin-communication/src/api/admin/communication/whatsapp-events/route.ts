// @ts-nocheck
import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { z } from "zod"
import {
    COMMUNICATION_MODULE,
    CommunicationModuleService,
} from "../../../../modules/communication"

/**
 * GET  /admin/communication/whatsapp-events
 * PUT  /admin/communication/whatsapp-events
 *
 * Lists / upserts WhatsApp event-bindings — separate from the email
 * event-bindings at /admin/email/events. An event like "kyc.approved"
 * can have a binding here AND an email binding; they fire independently.
 */
const UpsertSchema = z.object({
    event_name: z.string().min(1).max(120),
    template_slug: z.string().min(1).max(120),
    to_resolver: z.enum(["customer_phone", "static"]).optional(),
    static_to: z.string().nullable().optional(),
    enabled: z.boolean().optional(),
})

export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
    try {
        const mod = req.scope.resolve(
            COMMUNICATION_MODULE,
        ) as CommunicationModuleService
        const rows = await mod.listWhatsappEventMappingsView()
        return res.json({ mappings: rows, count: rows.length })
    } catch (err: any) {
        console.error(
            "[admin/communication/whatsapp-events] GET failed:",
            err,
        )
        return res
            .status(500)
            .json({ message: err?.message || "Failed to load mappings" })
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
        const mod = req.scope.resolve(
            COMMUNICATION_MODULE,
        ) as CommunicationModuleService
        const row = await mod.upsertWhatsappEventMapping(
            parsed.data as Parameters<
                CommunicationModuleService["upsertWhatsappEventMapping"]
            >[0],
        )
        return res.json(row)
    } catch (err: any) {
        return res.status(500).json({ message: err?.message })
    }
}
