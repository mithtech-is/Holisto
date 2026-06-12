// @ts-nocheck
import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { z } from "zod"
import {
    COMMUNICATION_MODULE,
    CommunicationModuleService,
} from "../../../../../modules/communication"

/**
 * GET    /admin/communication/whatsapp-templates/:slug
 * PUT    /admin/communication/whatsapp-templates/:slug   — body fields below
 * DELETE /admin/communication/whatsapp-templates/:slug   — system rows refused
 */
const PutSchema = z.object({
    name: z
        .string()
        .min(1)
        .max(512)
        .regex(/^[a-z0-9_]+$/)
        .optional(),
    label: z.string().min(1).max(120).optional().nullable(),
    description: z.string().optional().nullable(),
    category: z.enum(["AUTHENTICATION", "UTILITY", "MARKETING"]).optional(),
    language: z.string().min(2).max(20).optional(),
    template_type: z.enum(["STANDARD", "CAROUSEL", "CATALOG"]).optional(),
    components: z.array(z.any()).optional(),
    variables: z.array(z.any()).optional().nullable(),
    /** Manual lifecycle override — admin marks the template approved /
     *  rejected after creating the matching template on polyg.in's web
     *  UI. Templates flagged "approved" become eligible for the
     *  send_templet code path. */
    polygin_status: z
        .enum(["draft", "pushed", "approved", "rejected", "paused"])
        .optional(),
})

export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
    try {
        const mod = req.scope.resolve(
            COMMUNICATION_MODULE,
        ) as CommunicationModuleService
        const slug = req.params.slug as string
        const row = await mod.getWhatsappTemplateBySlug(slug)
        if (!row) return res.status(404).json({ message: "not found" })
        return res.json(row)
    } catch (err: any) {
        return res.status(500).json({ message: err?.message })
    }
}

export const PUT = async (req: MedusaRequest, res: MedusaResponse) => {
    try {
        const parsed = PutSchema.safeParse(req.body)
        if (!parsed.success) {
            return res
                .status(400)
                .json({ message: "Invalid", errors: parsed.error.flatten() })
        }
        const mod = req.scope.resolve(
            COMMUNICATION_MODULE,
        ) as CommunicationModuleService
        const slug = req.params.slug as string
        const row = await mod.upsertWhatsappTemplate({ slug, ...parsed.data })
        return res.json(row)
    } catch (err: any) {
        return res.status(500).json({ message: err?.message })
    }
}

export const DELETE = async (req: MedusaRequest, res: MedusaResponse) => {
    try {
        const mod = req.scope.resolve(
            COMMUNICATION_MODULE,
        ) as CommunicationModuleService
        const slug = req.params.slug as string
        const existing = await mod.getWhatsappTemplateBySlug(slug)
        if (!existing) return res.status(404).json({ message: "not found" })
        if (existing.is_system) {
            return res.status(409).json({
                message:
                    "Can't delete a system template — edit the body instead.",
            })
        }
        await (mod as any).deleteWhatsappTemplates(existing.id)
        return res.json({ ok: true })
    } catch (err: any) {
        return res.status(500).json({ message: err?.message })
    }
}
