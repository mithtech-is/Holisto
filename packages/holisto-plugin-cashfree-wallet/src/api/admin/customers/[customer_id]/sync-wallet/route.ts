import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import {
  CASHFREE_WALLET_MODULE,
  CashfreeWalletService,
} from "../../../../../modules/cashfree_wallet"
import { logger } from "../../../../../utils/logger"
import { CashfreeApiError } from "../../../../../modules/cashfree_wallet/cashfree/client"
import { sendEventEmail } from "../../../../../lib/send-event-email"

/**
 * POST /admin/customers/:customer_id/sync-wallet
 *
 * Operator-driven wallet recheck. Pulls the last 24h of SUCCESS-status
 * payments to the customer's VBA from Cashfree and credits any we
 * haven't already booked. Used by ops triage when a customer reports
 * "I sent ₹X but the wallet still shows ₹0" — we click this from
 * Customer-360 → Bank & Demat tab and the missed deposit shows up.
 *
 * Same logic as the storefront `POST /store/wallet/sync` route — both
 * delegate to `walletModule.syncCustomerVbaPayments`. The differences
 * are:
 *
 *   - No per-customer rate limit (admin is the operator; ops re-running
 *     this on a flaky day shouldn't hit a customer-side bucket).
 *   - Logs the admin user id alongside the action for audit.
 *   - Same idempotency guarantees: every payment is keyed on a stable
 *     `cashfree_event_id`, so this race-safely interleaves with the
 *     webhook handler and the storefront route.
 *
 * Errors map 1:1 with the storefront route so the admin UI can show
 * the same diagnostics:
 *   404 wallet.sync.no_vba          — customer has no active VBA
 *   502 wallet.sync.upstream_error  — Cashfree unreachable
 */
export const POST = async (req: MedusaRequest, res: MedusaResponse) => {
  const { customer_id } = req.params as { customer_id: string }
  if (!customer_id) {
    return res.status(400).json({ message: "Missing customer_id" })
  }

  const adminUserId =
    (req as any).auth_context?.actor_id ??
    (req as any).auth_context?.app_metadata?.user_id ??
    "unknown_admin"

  const walletModule = req.scope.resolve(
    CASHFREE_WALLET_MODULE,
  ) as CashfreeWalletService

  let result: Awaited<ReturnType<typeof walletModule.syncCustomerVbaPayments>>
  try {
    result = await walletModule.syncCustomerVbaPayments(customer_id)
  } catch (err) {
    if ((err as Error)?.message === "no_active_vba") {
      return res.status(404).json({
        ok: false,
        code: "wallet.sync.no_vba",
        message:
          "This customer has no active VBA. Provision one (button above) before syncing deposits.",
      })
    }
    if (err instanceof CashfreeApiError) {
      logger.warn("admin wallet sync: Cashfree error", {
        customer_id,
        admin_user_id: adminUserId,
        status: err.status,
      })
      return res.status(502).json({
        ok: false,
        code: "wallet.sync.upstream_error",
        message: `Cashfree returned ${err.status}. Try again in a moment.`,
      })
    }
    logger.error("admin wallet sync failed", {
      customer_id,
      admin_user_id: adminUserId,
      error: err,
    })
    return res.status(500).json({
      ok: false,
      code: "wallet.sync.failed",
      message: ((err as Error)?.message ?? "Sync failed").slice(0, 500),
    })
  }

  // Audit row + per-credit customer email — same email template the
  // webhook + storefront sync use, so the customer's mailbox stays
  // consistent regardless of which path actually landed the credit.
  if (result.new_credits.length > 0) {
    try {
      await walletModule.logAdminAction({
        admin_user_id: adminUserId,
        customer_id,
        action: "wallet_sync",
        target_id: customer_id,
        before: null,
        after: {
          new_credits: result.new_credits.length,
          total_credited_paise: result.new_credits.reduce(
            (sum, c) => sum + c.amount_inr,
            0,
          ),
          tpv_failures: result.tpv_failures,
        },
        note: `Manual deposit recheck — ${result.new_credits.length} new credit(s)`,
      })
    } catch (auditErr) {
      logger.warn("admin wallet sync: audit log failed (non-blocking)", {
        customer_id,
        error: (auditErr as Error).message,
      })
    }

    const wallet = await walletModule
      .ensureWallet(customer_id)
      .catch(() => null)
    for (const c of result.new_credits) {
      try {
        await sendEventEmail(req.scope, "wallet.deposit_credited", {
          customer_id,
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
        logger.warn("admin wallet sync: email failed", {
          customer_id,
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
