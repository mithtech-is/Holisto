// @ts-nocheck
import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import {
    COMMUNICATION_MODULE,
    CommunicationModuleService,
} from "../../../../../modules/communication"

/**
 * POST /admin/communication/whatsapp-templates/refresh-system
 *
 * Re-applies the in-source seed catalog to existing system rows
 * (`is_system = true`) and inserts any new system templates.
 *
 * Why this exists: the boot-time seed loader is INSERT ... ON CONFLICT
 * DO NOTHING so admins can edit a system template without their changes
 * being clobbered on restart. But when the brand surface widens (new
 * placeholders, new tagline) we want a one-click way to push the
 * canonical wording back into existing rows. This endpoint does that.
 *
 * Skips rows where `is_system = false` (admin-created templates) — the
 * response includes their slugs so the admin can review.
 *
 * Side-effect: every overwritten row's `polygin_status` is reset to
 * "draft" because the wording changed, which means Meta-side approval
 * is stale. The Brand tab's bulk-reset action follows the same logic.
 *
 * Also re-runs the WhatsApp event-map seed so newly added events
 * (bank.*, demat.*, etc.) get wired without a full restart.
 */
export const POST = async (req: MedusaRequest, res: MedusaResponse) => {
    try {
        const mod = req.scope.resolve(
            COMMUNICATION_MODULE,
        ) as CommunicationModuleService
        const result = await mod.refreshSystemWhatsappTemplates()
        return res.json(result)
    } catch (err: any) {
        console.error(
            "[admin/communication/whatsapp-templates/refresh-system] failed:",
            err,
        )
        return res.status(500).json({ ok: false, message: err?.message })
    }
}
