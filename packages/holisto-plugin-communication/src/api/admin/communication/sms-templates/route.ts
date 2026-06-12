// @ts-nocheck
import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { z } from "zod"
import {
    COMMUNICATION_MODULE,
    CommunicationModuleService,
} from "../../../../modules/communication"

/**
 * GET  /admin/communication/sms-templates
 *   query: ?is_otp=true|false &dlt_status=draft|pending|approved|rejected
 *
 * POST /admin/communication/sms-templates
 *   body: { slug, label?, description?, body, variables?,
 *           dlt_template_id?, dlt_status?, is_otp? }
 *
 *   No "push" button — DLT registration goes through MSG91's onboarding
 *   partner / TRAI portal manually. Once approved, the admin pastes the
 *   `dlt_template_id` here and flips `dlt_status` to "approved".
 */
const UpsertSchema = z.object({
    slug: z.string().min(1).max(80),
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
        const q = req.query as Record<string, string | undefined>
        const filters: { is_otp?: boolean; dlt_status?: string } = {}
        if (q.is_otp === "true") filters.is_otp = true
        if (q.is_otp === "false") filters.is_otp = false
        if (q.dlt_status) filters.dlt_status = q.dlt_status
        const rows = await mod.listSmsTemplatesView(filters)
        return res.json({ templates: rows, count: rows.length })
    } catch (err: any) {
        console.error(
            "[admin/communication/sms-templates] GET failed:",
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
        // See whatsapp-templates/route.ts for the Zod-inferred-type cast
        // rationale.
        const row = await mod.upsertSmsTemplate(
            parsed.data as Parameters<
                CommunicationModuleService["upsertSmsTemplate"]
            >[0],
        )
        return res.json(row)
    } catch (err: any) {
        return res.status(500).json({ message: err?.message })
    }
}
