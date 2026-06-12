// @ts-nocheck
import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { z } from "zod"
import {
    COMMUNICATION_MODULE,
    CommunicationModuleService,
} from "../../../../modules/communication"

/**
 * GET  /admin/communication/whatsapp-templates
 *   query: ?category=AUTHENTICATION|UTILITY|MARKETING
 *           &polygin_status=draft|pushed|approved|rejected|paused
 *
 *   List the WhatsApp template catalog. Each row carries the
 *   Meta-template structure plus our local lifecycle state on polyg.in.
 *
 * POST /admin/communication/whatsapp-templates
 *   body: { slug, name, label?, description?, category, language?,
 *           components, variables? }
 *
 *   Create or update a custom (non-system) template. Editing the body
 *   resets `polygin_status` to "draft" so the admin must re-push for
 *   Meta to re-approve.
 */
const UpsertSchema = z.object({
    slug: z
        .string()
        .min(1)
        .max(80)
        .regex(/^[a-z0-9._-]+$/, "slug must be lowercase + dots/hyphens"),
    name: z
        .string()
        .min(1)
        .max(512)
        .regex(/^[a-z0-9_]+$/, "Meta names: lowercase letters, digits, underscores")
        .optional(),
    label: z.string().min(1).max(120).optional().nullable(),
    description: z.string().optional().nullable(),
    category: z.enum(["AUTHENTICATION", "UTILITY", "MARKETING"]).optional(),
    language: z.string().min(2).max(20).optional(),
    template_type: z.enum(["STANDARD", "CAROUSEL", "CATALOG"]).optional(),
    components: z.array(z.any()).optional(),
    variables: z.array(z.any()).optional().nullable(),
})

export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
    try {
        const mod = req.scope.resolve(
            COMMUNICATION_MODULE,
        ) as CommunicationModuleService
        const q = req.query as Record<string, string | undefined>
        const rows = await mod.listWhatsappTemplatesView({
            category: q.category,
            polygin_status: q.polygin_status,
        })
        return res.json({ templates: rows, count: rows.length })
    } catch (err: any) {
        console.error(
            "[admin/communication/whatsapp-templates] GET failed:",
            err,
        )
        return res
            .status(500)
            .json({ message: err?.message || "Failed to load templates" })
    }
}

export const POST = async (req: MedusaRequest, res: MedusaResponse) => {
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
        // Zod's `regex` chain narrows the inferred type away from
        // `string` (it loses the `.min(1)` proof) — the `slug` field is
        // required in the schema, but the inferred type makes it
        // optional. Cast back to the service's signature.
        const row = await mod.upsertWhatsappTemplate(
            parsed.data as Parameters<
                CommunicationModuleService["upsertWhatsappTemplate"]
            >[0],
        )
        return res.json(row)
    } catch (err: any) {
        console.error(
            "[admin/communication/whatsapp-templates] POST failed:",
            err,
        )
        return res
            .status(500)
            .json({ message: err?.message || "Failed to save template" })
    }
}
