import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { z } from "zod"
import { logger } from "../../../utils/logger"
import {
    CASHFREE_WALLET_MODULE,
    CashfreeWalletService,
} from "../../../modules/cashfree_wallet"

/**
 * POST /store/newsletter
 *
 * Upserts a `newsletter_subscription` row. The DB has a partial-unique
 * index on `email` (where deleted_at is null), so repeat signups from
 * the same address don't create duplicates — we find the existing row
 * and bump `last_seen_at` + the `source` tag.
 *
 * Public route. No auth. Schema is email + optional source tag.
 */
const BodySchema = z.object({
    email: z
        .string()
        .trim()
        .toLowerCase()
        .email()
        .max(254),
    source: z.string().trim().max(60).optional(),
})

function firstIp(value: unknown): string | null {
    if (typeof value !== "string") return null
    return value.split(",")[0]?.trim().slice(0, 64) || null
}

export const POST = async (req: MedusaRequest, res: MedusaResponse) => {
    const parsed = BodySchema.safeParse(req.body)
    if (!parsed.success) {
        return res.status(400).json({
            message: "Invalid email",
            errors: parsed.error.flatten(),
        })
    }
    const { email, source } = parsed.data
    const sourceIp = firstIp(req.headers["x-forwarded-for"]) ?? firstIp(req.ip)

    const walletModule = req.scope.resolve(
        CASHFREE_WALLET_MODULE
    ) as CashfreeWalletService

    try {
        const now = new Date()
        const existing = (
            await walletModule.listNewsletterSubscriptions({ email })
        )[0]

        if (existing) {
            // Already subscribed — touch last-seen + source so ops can see the
            // most recent entry point the user is coming from. Re-subscribing
            // also clears any prior unsubscribe flag so they start receiving
            // emails again.
            await walletModule.updateNewsletterSubscriptions({
                selector: { id: existing.id },
                data: {
                    last_seen_at: now,
                    source: source ?? existing.source,
                    source_ip: sourceIp,
                    unsubscribed_at: null,
                },
            })
            logger.info("newsletter re-signup", { email, source })
            return res.status(200).json({ ok: true, deduped: true })
        }

        await walletModule.createNewsletterSubscriptions({
            email,
            source: source ?? null,
            source_ip: sourceIp,
            first_seen_at: now,
            last_seen_at: now,
        })
        logger.info("newsletter signup", { email, source })
        res.status(201).json({ ok: true })
    } catch (err) {
        logger.error("failed to persist newsletter signup", {
            email,
            error: (err as Error).message,
        })
        res.status(500).json({
            ok: false,
            message: "Could not subscribe — please try again in a moment.",
        })
    }
}
