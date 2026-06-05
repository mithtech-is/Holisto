import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import {
    CASHFREE_WALLET_MODULE,
    CashfreeWalletService,
} from "../../../modules/cashfree_wallet"

/**
 * GET /admin/newsletter-subscriptions?scope=active|unsubscribed|all
 *
 * Defaults to "active" (rows without an unsubscribed_at). Accepts
 * `q` for email-substring filter and `limit` for page size.
 */
export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
    const scope = (req.query.scope as string | undefined) ?? "active"
    const q = (req.query.q as string | undefined) ?? ""
    const limit = Math.min(
        Math.max(Number.parseInt(String(req.query.limit ?? "200"), 10) || 200, 1),
        1000
    )
    const walletModule = req.scope.resolve(
        CASHFREE_WALLET_MODULE
    ) as CashfreeWalletService

    const filter: Record<string, unknown> = {}
    if (scope === "active") filter.unsubscribed_at = null
    if (scope === "unsubscribed") filter.unsubscribed_at = { $ne: null } as any
    if (q.trim()) filter.email = { $like: `%${q.trim().toLowerCase()}%` } as any

    const [rows, count] =
        await walletModule.listAndCountNewsletterSubscriptions(filter as any, {
            take: limit,
            order: { created_at: "DESC" } as any,
        })
    res.json({ count, subscriptions: rows })
}
