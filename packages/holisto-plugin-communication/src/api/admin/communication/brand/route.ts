// @ts-nocheck
import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { z } from "zod"
import {
    COMMUNICATION_MODULE,
    CommunicationModuleService,
} from "../../../../modules/communication"

/**
 * GET  /admin/communication/brand
 * PUT  /admin/communication/brand
 *
 * Read / update the brand singleton. Drives the placeholder substitution
 * used by every Email, SMS, and WhatsApp template across the
 * Communication module. Available placeholders:
 *   {{brand}}, {{company_name}}, {{storefront_url}}, {{support_email}},
 *   {{support_phone}}, {{address}}, {{tagline}}
 *
 * Important: changing brand fields AFTER WhatsApp templates have been
 * approved on Meta requires recreating each affected template on
 * polyg.in — Meta locks approval to the exact wording. The Brand tab
 * exposes a one-click "Reset brand-using templates" action for this.
 */
const UpsertSchema = z.object({
    brand_name: z.string().min(1).max(80).optional(),
    company_name: z.string().min(1).max(160).nullable().optional(),
    storefront_url: z.string().url().optional(),
    support_email: z.string().email().nullable().optional(),
    support_phone: z.string().min(6).max(20).nullable().optional(),
    address: z.string().max(500).nullable().optional(),
    tagline: z.string().max(140).nullable().optional(),
    /** Meta caps QUICK_REPLY button text at 25 chars. */
    whatsapp_bot_label: z.string().min(1).max(25).optional(),
    /** Categories that get the bot button injected at refresh time. */
    whatsapp_bot_categories: z
        .array(z.enum(["AUTHENTICATION", "UTILITY", "MARKETING"]))
        .optional(),
})

export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
    try {
        const mod = req.scope.resolve(
            COMMUNICATION_MODULE,
        ) as CommunicationModuleService
        const view = await mod.getBrandConfigView()
        return res.json(view)
    } catch (err: any) {
        return res
            .status(500)
            .json({ message: err?.message || "Failed to load brand config" })
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
        const view = await mod.upsertBrandConfig(parsed.data)
        return res.json(view)
    } catch (err: any) {
        return res
            .status(500)
            .json({ message: err?.message || "Failed to save brand config" })
    }
}
