// @ts-nocheck
import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import {
    COMMUNICATION_MODULE,
    CommunicationModuleService,
} from "../../../../../modules/communication"

/**
 * POST /admin/communication/sms-templates/refresh-system
 *
 * SMS counterpart to the WhatsApp template refresh. See sibling route
 * for full rationale. Same is_system-respecting semantics:
 *   - INSERT new system templates that don't exist yet
 *   - UPDATE existing rows where is_system = true
 *   - SKIP rows where is_system = false (admin-customized)
 *
 * No equivalent of WhatsApp's polygin_status reset — MSG91 / DLT
 * lifecycle is per-template-id, and refreshing the body locally
 * doesn't affect the DLT-approved template entity.
 */
export const POST = async (req: MedusaRequest, res: MedusaResponse) => {
    try {
        const mod = req.scope.resolve(
            COMMUNICATION_MODULE,
        ) as CommunicationModuleService
        const result = await mod.refreshSystemSmsTemplates()
        return res.json(result)
    } catch (err: any) {
        console.error(
            "[admin/communication/sms-templates/refresh-system] failed:",
            err,
        )
        return res.status(500).json({ ok: false, message: err?.message })
    }
}
