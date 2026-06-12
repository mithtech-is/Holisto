import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { z } from "zod"
import {
    CASHFREE_WALLET_MODULE,
    CashfreeWalletService,
} from "../../../../modules/cashfree_wallet"

/**
 * POST /admin/contact-submissions/:id
 *
 * Update a contact-submission row — change status, add reviewer notes.
 * The reviewing admin user id is stamped from the auth context.
 */
const BodySchema = z.object({
    status: z.enum(["new", "in_review", "resolved", "spam"]).optional(),
    reviewer_notes: z.string().trim().max(4000).optional().nullable(),
})

export const POST = async (req: MedusaRequest, res: MedusaResponse) => {
    const parsed = BodySchema.safeParse(req.body)
    if (!parsed.success) {
        return res
            .status(400)
            .json({ message: "Invalid input", errors: parsed.error.flatten() })
    }
    const { id } = req.params
    if (!id) return res.status(400).json({ message: "Missing id" })

    const walletModule = req.scope.resolve(
        CASHFREE_WALLET_MODULE
    ) as CashfreeWalletService
    const existing = await walletModule
        .retrieveContactSubmission(id as string)
        .catch(() => null)
    if (!existing) return res.status(404).json({ message: "Not found" })

    const adminUserId =
        ((req as any).auth_context?.actor_id as string | undefined) ??
        ((req as any).auth_context?.app_metadata?.user_id as string | undefined) ??
        null
    const updated = await walletModule.updateContactSubmissions({
        selector: { id: existing.id },
        data: {
            ...(parsed.data.status ? { status: parsed.data.status } : {}),
            ...(parsed.data.reviewer_notes !== undefined
                ? { reviewer_notes: parsed.data.reviewer_notes ?? null }
                : {}),
            reviewer_user_id: adminUserId,
            reviewed_at: new Date(),
        },
    })
    res.json({ submission: Array.isArray(updated) ? updated[0] : updated })
}
