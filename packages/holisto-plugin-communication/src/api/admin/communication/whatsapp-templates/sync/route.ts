// @ts-nocheck
import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import {
    COMMUNICATION_MODULE,
    CommunicationModuleService,
} from "../../../../../modules/communication"

/**
 * POST /admin/communication/whatsapp-templates/sync
 *
 * Pulls the user's template list from polyg.in (using the dashboard JWT
 * stored in PolyginConfig) and reconciles each local row's
 * `polygin_status` to match what Meta reports. Local body content is
 * never modified — this is purely a status refresh.
 *
 * 502 if the dashboard JWT isn't set or polyg.in returns an error;
 * the response body explains how to capture the JWT.
 */
export const POST = async (req: MedusaRequest, res: MedusaResponse) => {
    try {
        const mod = req.scope.resolve(
            COMMUNICATION_MODULE,
        ) as CommunicationModuleService
        const result = await mod.syncWhatsappTemplatesFromPolygin()
        if (!result.ok) {
            return res
                .status(502)
                .json({ ok: false, message: result.reason })
        }
        return res.json({ ok: true, updated: result.updated })
    } catch (err: any) {
        console.error(
            "[admin/communication/whatsapp-templates/sync] failed:",
            err,
        )
        return res.status(500).json({ ok: false, message: err?.message })
    }
}
