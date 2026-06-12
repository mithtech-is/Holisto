import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { z } from "zod"
import { logger } from "../../../utils/logger"
import {
    CASHFREE_WALLET_MODULE,
    CashfreeWalletService,
} from "../../../modules/cashfree_wallet"
import { sendEventEmail } from "../../../lib/send-event-email"

/**
 * POST /store/contact
 *
 * Persists public contact-form submissions into `contact_submission`
 * (custom module table) so ops can review them later via the admin.
 * Logs a summary line on every submission for quick grep-based ops
 * triage, and passes the caller IP for abuse tracing.
 *
 * Public route — no auth. The only guard is the Zod schema + the
 * storefront-wide rate limiter mounted in `middlewares.ts`.
 */
const BodySchema = z.object({
    name: z.string().trim().min(1).max(120),
    email: z.string().trim().email().max(254),
    phone: z.string().trim().max(25).optional().or(z.literal("")),
    subject: z.string().trim().min(1).max(200),
    message: z.string().trim().min(10).max(4000),
})

function firstIp(value: unknown): string | null {
    if (typeof value !== "string") return null
    // X-Forwarded-For may be a comma-list; grab the leftmost, trim, truncate.
    return value.split(",")[0]?.trim().slice(0, 64) || null
}

export const POST = async (req: MedusaRequest, res: MedusaResponse) => {
    const parsed = BodySchema.safeParse(req.body)
    if (!parsed.success) {
        return res
            .status(400)
            .json({ message: "Invalid input", errors: parsed.error.flatten() })
    }
    const d = parsed.data
    const customerId =
        ((req as any).auth_context?.app_metadata?.customer_id as string | undefined) ??
        null
    const sourceIp = firstIp(req.headers["x-forwarded-for"]) ?? firstIp(req.ip)

    const walletModule = req.scope.resolve(
        CASHFREE_WALLET_MODULE
    ) as CashfreeWalletService

    try {
        const row = await walletModule.createContactSubmissions({
            name: d.name,
            email: d.email,
            phone: d.phone || null,
            subject: d.subject,
            message: d.message,
            source_ip: sourceIp,
            customer_id: customerId,
            status: "new",
        })
        logger.info("contact form submission", {
            id: Array.isArray(row) ? row[0]?.id : (row as any)?.id,
            email: d.email,
            subject: d.subject,
            message_length: d.message.length,
            customer_id: customerId,
            source_ip: sourceIp,
        })
        await sendEventEmail(req.scope, "admin.new_contact_submission", {
            name: d.name,
            email: d.email,
            phone: d.phone || "—",
            subject: d.subject,
            message: d.message,
        })
        res.status(201).json({ ok: true })
    } catch (err) {
        logger.error("failed to persist contact submission", {
            email: d.email,
            error: (err as Error).message,
        })
        res.status(500).json({ ok: false, message: "Could not save your message — please try again in a moment." })
    }
}
