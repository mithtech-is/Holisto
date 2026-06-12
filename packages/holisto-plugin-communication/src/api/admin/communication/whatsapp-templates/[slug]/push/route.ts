// @ts-nocheck
import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import {
    COMMUNICATION_MODULE,
    CommunicationModuleService,
} from "../../../../../../modules/communication"

/**
 * POST /admin/communication/whatsapp-templates/:slug/push
 *
 * Push the local template (with brand placeholders resolved against the
 * current BrandConfig) to polyg.in's `/api/user/add_meta_templet`.
 * Polygin forwards it to Meta for review and the local row flips to
 * "pushed". Status updates to approved/rejected come in via the sync
 * endpoint.
 *
 * Requires the dashboard JWT to be set in PolyginConfig — Polygin's
 * public REST API token doesn't authenticate against /api/user/*.
 * Returns 502 with a remediation hint when the JWT is missing.
 */
export const POST = async (req: MedusaRequest, res: MedusaResponse) => {
    try {
        const mod = req.scope.resolve(
            COMMUNICATION_MODULE,
        ) as CommunicationModuleService
        const slug = req.params.slug as string
        const result = await mod.pushWhatsappTemplateToPolygin({ slug })
        if (!result.ok) {
            const reason = "reason" in result ? result.reason : "unknown"
            return res.status(502).json({ ok: false, message: reason })
        }
        return res.json({
            ok: true,
            template: result.row,
            provider_response: result.provider_response,
        })
    } catch (err: any) {
        console.error(
            "[admin/communication/whatsapp-templates/:slug/push] failed:",
            err,
        )
        return res.status(500).json({ ok: false, message: err?.message })
    }
}
