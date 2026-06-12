// @ts-nocheck
import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import {
    COMMUNICATION_MODULE,
    CommunicationModuleService,
} from "../../../../../../modules/communication"

/**
 * GET /admin/communication/whatsapp-templates/:slug/preview
 *
 * Returns the template's components with `{{brand}}` /
 * `{{storefront_url}}` / `{{support_email}}` resolved against the
 * current BrandConfig. Positional `{{1}}`, `{{2}}` slots are left in
 * place — Meta sees those during template review, so admin pastes them
 * verbatim into polyg.in's template editor.
 */
export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
    try {
        const mod = req.scope.resolve(
            COMMUNICATION_MODULE,
        ) as CommunicationModuleService
        const slug = req.params.slug as string
        const result = await mod.getWhatsappTemplatePreview(slug)
        if (result.ok === false) {
            return res.status(404).json({ message: result.reason })
        }
        return res.json(result)
    } catch (err: any) {
        console.error(
            "[admin/communication/whatsapp-templates/:slug/preview] failed:",
            err,
        )
        return res.status(500).json({ message: err?.message })
    }
}
