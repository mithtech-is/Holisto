import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import {
    CASHFREE_WALLET_MODULE,
    CashfreeWalletService,
} from "../../../modules/cashfree_wallet"

/**
 * GET /admin/contact-submissions?status=new|in_review|resolved|spam|all
 *
 * Paginated list of contact-form submissions. Defaults to status "new".
 * The admin UI at /app/inbox/contact reads this.
 */
export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
    const rawStatus = (req.query.status as string | undefined) ?? "new"
    const limit = Math.min(
        Math.max(Number.parseInt(String(req.query.limit ?? "100"), 10) || 100, 1),
        500
    )
    const walletModule = req.scope.resolve(
        CASHFREE_WALLET_MODULE
    ) as CashfreeWalletService

    const filter =
        rawStatus === "all"
            ? {}
            : { status: rawStatus as "new" | "in_review" | "resolved" | "spam" }
    const [rows, count] = await walletModule.listAndCountContactSubmissions(
        filter,
        { take: limit, order: { created_at: "DESC" } as any }
    )
    res.json({ count, submissions: rows })
}
