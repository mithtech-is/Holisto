import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { z } from "zod"
import {
    CASHFREE_WALLET_MODULE,
    CashfreeWalletService,
} from "../../../../modules/cashfree_wallet"

/**
 * POST /admin/newsletter-subscriptions/:id
 *
 * Body: { action: "unsubscribe" | "resubscribe" | "delete" }
 *
 * Unsubscribe just sets the timestamp (keeps audit history).
 * Resubscribe clears it. Delete soft-deletes the row (Medusa convention).
 */
const BodySchema = z.object({
    action: z.enum(["unsubscribe", "resubscribe", "delete"]),
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
        .retrieveNewsletterSubscription(id as string)
        .catch(() => null)
    if (!existing) return res.status(404).json({ message: "Not found" })

    if (parsed.data.action === "delete") {
        await walletModule.deleteNewsletterSubscriptions(existing.id)
        return res.json({ deleted: true })
    }

    const updated = await walletModule.updateNewsletterSubscriptions({
        selector: { id: existing.id },
        data: {
            unsubscribed_at:
                parsed.data.action === "unsubscribe" ? new Date() : null,
        },
    })
    res.json({ subscription: Array.isArray(updated) ? updated[0] : updated })
}
