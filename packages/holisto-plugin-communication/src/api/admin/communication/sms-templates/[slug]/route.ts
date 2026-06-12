// @ts-nocheck
import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { z } from "zod"
import {
    COMMUNICATION_MODULE,
    CommunicationModuleService,
} from "../../../../../modules/communication"

const PutSchema = z.object({
    label: z.string().min(1).max(120).optional().nullable(),
    description: z.string().optional().nullable(),
    body: z.string().min(1).optional(),
    variables: z.array(z.any()).optional().nullable(),
    dlt_template_id: z.string().optional().nullable(),
    dlt_status: z
        .enum(["draft", "pending", "approved", "rejected"])
        .optional(),
    is_otp: z.boolean().optional(),
})

export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
    try {
        const mod = req.scope.resolve(
            COMMUNICATION_MODULE,
        ) as CommunicationModuleService
        const slug = req.params.slug as string
        const row = await mod.getSmsTemplateBySlug(slug)
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
        const row = await mod.upsertSmsTemplate({ slug, ...parsed.data })
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
        const existing = await mod.getSmsTemplateBySlug(slug)
        if (!existing) return res.status(404).json({ message: "not found" })
        if (existing.is_system) {
            return res.status(409).json({
                message:
                    "Can't delete a system template — edit the body or DLT id instead.",
            })
        }
        await (mod as any).deleteSmsTemplates(existing.id)
        return res.json({ ok: true })
    } catch (err: any) {
        return res.status(500).json({ message: err?.message })
    }
}
