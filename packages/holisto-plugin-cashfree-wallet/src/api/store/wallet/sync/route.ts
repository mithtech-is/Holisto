import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import {
  CASHFREE_WALLET_MODULE,
  CashfreeWalletService,
} from "../../../../modules/cashfree_wallet"
import {
  hitRateLimit,
  WALLET_LIMITS,
} from "../../../../modules/cashfree_wallet/rate-limit"
import { logger } from "../../../../utils/logger"
import { CashfreeApiError } from "../../../../modules/cashfree_wallet/cashfree/client"
import { sendEventEmail } from "../../../../lib/send-event-email"

/**
 * POST /store/wallet/sync
 *
 * Customer-driven "Check for new deposits" — pulls the last 24h of
 * SUCCESS-status payments to the customer's VBA from Cashfree and
 * credits any we haven't already booked. Built as a defensive
 * fallback to the Cashfree webhook (`/webhooks/cashfree/payment-gateway`),
 * which is the primary credit path. Same idempotency model: every
 * payment is keyed on a stable `cashfree_event_id` and the wallet-
 * transaction unique constraint catches a webhook + sync race
 * without double-crediting.
 *
 * Rate limit: 1 hit per 30 seconds (Cashfree settlement is in
 * seconds, not milliseconds — tighter polling burns API quota for
 * no UX gain) + 20 per day (catches a stuck retry loop on the
 * client side).
 *
 * Response shape:
 *   {
 *     new_credits:     [{ transaction_id, amount_inr, utr, remitter_name }],
 *     duplicates:      number,    // already in our DB
 *     tpv_failures:    number,    // remitter not on customer's verified-bank list
 *     orphaned:        number,    // unknown VBA (shouldn't happen for own VBA)
 *     new_balance_inr: number,    // post-sync wallet balance, paise
 *     last_synced_at:  ISO string
 *   }
 *
 * Errors:
 *   401  not authenticated
 *   404  customer has no active VBA — provision one by linking a bank first
 *   429  rate limit exceeded
 *   502  Cashfree unreachable / errored
 */
export const POST = async (req: MedusaRequest, res: MedusaResponse) => {
  const customerId = (req as any).auth_context?.app_metadata?.customer_id as
    | string
    | undefined
  if (!customerId) {
    return res.status(401).json({ message: "Not authenticated" })
  }

  // Burst guard.
  const burst = hitRateLimit(
    `wallet_sync_short:${customerId}`,
    WALLET_LIMITS.manual_sync_short.limit,
    WALLET_LIMITS.manual_sync_short.windowMs,
  )
  if (!burst.allowed) {
    return res.status(429).json({
      ok: false,
      code: "wallet.sync.too_frequent",
      message:
        "You're refreshing too fast. Cashfree settlement takes a few seconds — try again shortly.",
      retry_after_ms: Math.max(0, burst.reset_at - Date.now()),
    })
  }
  // Daily ceiling — stops a stuck client-side retry loop from
  // hammering Cashfree on the customer's behalf.
  const daily = hitRateLimit(
    `wallet_sync_day:${customerId}`,
    WALLET_LIMITS.manual_sync_daily.limit,
    WALLET_LIMITS.manual_sync_daily.windowMs,
  )
  if (!daily.allowed) {
    return res.status(429).json({
      ok: false,
      code: "wallet.sync.daily_limit",
      message:
        "You've checked for new deposits a lot today. We auto-credit deposits via webhook within seconds — manual checks shouldn't be needed often. Try again tomorrow, or contact support if a deposit still isn't reflected.",
      retry_after_ms: Math.max(0, daily.reset_at - Date.now()),
    })
  }

  const walletModule = req.scope.resolve(
    CASHFREE_WALLET_MODULE,
  ) as CashfreeWalletService

  let result: Awaited<ReturnType<typeof walletModule.syncCustomerVbaPayments>>
  try {
    result = await walletModule.syncCustomerVbaPayments(customerId)
  } catch (err) {
    if ((err as Error)?.message === "no_active_vba") {
      return res.status(404).json({
        ok: false,
        code: "wallet.sync.no_vba",
        message:
          "We can't sync until you have a virtual account. Link a bank to provision one — usually automatic on first verified bank.",
      })
    }
    if (err instanceof CashfreeApiError) {
      logger.warn("wallet sync: Cashfree error", {
        customer_id: customerId,
        status: err.status,
      })
      return res.status(502).json({
        ok: false,
        code: "wallet.sync.upstream_error",
        message: `Couldn't reach our payments partner (${err.status}). Try again in a moment.`,
      })
    }
    logger.error("wallet sync failed", {
      customer_id: customerId,
      error: err,
    })
    return res.status(500).json({
      ok: false,
      code: "wallet.sync.failed",
      message: "Couldn't sync wallet right now. Try again shortly.",
    })
  }

  // Fire one wallet-credit email per fresh credit. Best-effort — an
  // email hiccup mustn't change the success of the sync. Same email
  // template as the webhook handler.
  if (result.new_credits.length > 0) {
    const wallet = await walletModule
      .ensureWallet(customerId)
      .catch(() => null)
    for (const c of result.new_credits) {
      try {
        await sendEventEmail(req.scope, "wallet.deposit_credited", {
          customer_id: customerId,
          amount_inr: Math.round(c.amount_inr / 100).toLocaleString("en-IN"),
          utr: c.utr ?? "—",
          remitter: c.remitter_name ?? "—",
          virtual_account_number: c.virtual_account_id ?? "—",
          wallet_balance_inr: wallet
            ? Math.round(wallet.balance_inr / 100).toLocaleString("en-IN")
            : "—",
          wallet_url: `${
            process.env.STOREFRONT_URL || "https://polemarch.in"
          }/dashboard/wallet`,
        })
      } catch (mailErr) {
        logger.warn("wallet sync: deposit-credited email failed", {
          customer_id: customerId,
          transaction_id: c.transaction_id,
          error: (mailErr as Error).message,
        })
      }
    }
  }

  return res.json({
    ok: true,
    new_credits: result.new_credits.map((c) => ({
      transaction_id: c.transaction_id,
      amount_inr: c.amount_inr,
      utr: c.utr,
      remitter_name: c.remitter_name,
    })),
    duplicates: result.duplicates,
    tpv_failures: result.tpv_failures,
    orphaned: result.orphaned,
    new_balance_inr: result.new_balance_inr,
    last_synced_at: new Date().toISOString(),
  })
}
