import type { MedusaContainer } from "@medusajs/framework/types"
import { Modules } from "@medusajs/framework/utils"
import {
  CASHFREE_WALLET_MODULE,
  CashfreeWalletService,
} from "../modules/cashfree_wallet"
import { sendEventEmail } from "../lib/send-event-email"
import { grantPointsForEvent } from "../lib/grant-points"
import { logger } from "./logger"

/**
 * Onboarding milestone fan-out helpers.
 *
 * Two collateral events fire as a side-effect of step verifications,
 * and only when their preconditions are fully met:
 *
 *   1. `kyc.fully_approved` — both PAN AND Aadhaar verified.
 *      Email-only (per the May-2026 notification policy: WhatsApp is
 *      reserved for the truly invest-ready milestone, not partial
 *      onboarding). Called from PAN-verify and Aadhaar-verify routes
 *      after the per-step success branches.
 *
 *   2. `investing.ready` — KYC fully approved AND ≥1 verified bank AND
 *      ≥1 verified primary demat. This is THE celebratory milestone:
 *      the customer can now place their first order. WhatsApp + email.
 *      Called from PAN/Aadhaar verify, bank verify, and demat verify —
 *      whichever closes the trio.
 *
 * Both helpers are idempotent (per-customer) and best-effort: any
 * failure is logged + swallowed; the calling route's response is
 * never affected.
 */

/**
 * Fires `kyc.fully_approved` ONCE when both PAN and Aadhaar are
 * verified. Idempotency: skips if `metadata.kyc_fully_approved_at`
 * is already set.
 */
export async function fireFullyApprovedIfReady(
  scope: MedusaContainer,
  customerId: string,
): Promise<void> {
  try {
    const wallet = scope.resolve(
      CASHFREE_WALLET_MODULE,
    ) as CashfreeWalletService
    const status = await wallet.getKycStatus(customerId)
    if (status.overall !== "approved") return

    // Idempotency check via customer.metadata.
    const customerModule = scope.resolve(Modules.CUSTOMER) as any
    const customer = await customerModule
      .retrieveCustomer(customerId, { select: ["id", "metadata"] })
      .catch(() => null)
    if (!customer) return
    const meta = (customer.metadata ?? {}) as Record<string, unknown>
    if (meta.kyc_fully_approved_at) return

    await sendEventEmail(scope, "kyc.fully_approved", {
      customer_id: customerId,
    })

    // Stamp idempotency. Goes through the customer-data integrity
    // triggers (anchor keys are NOT touched here, so no override
    // needed).
    await customerModule
      .updateCustomers(customerId, {
        metadata: { ...meta, kyc_fully_approved_at: new Date().toISOString() },
      })
      .catch((err: Error) => {
        logger.warn(
          "fireFullyApprovedIfReady: failed to stamp idempotency key",
          { customer_id: customerId, error: err.message },
        )
      })
  } catch (err) {
    logger.warn("fireFullyApprovedIfReady failed (non-blocking)", {
      customer_id: customerId,
      error: (err as Error).message,
    })
  }
}

/**
 * Fires `investing.ready` ONCE when KYC + bank + demat are all
 * complete — the milestone where the customer can actually place
 * orders. Per the notification policy, this is the ONLY onboarding
 * event mapped to WhatsApp; per-step events are email-only.
 *
 * Idempotency via `metadata.investing_ready_notified_at`.
 *
 * Call from any route that flips one of the three state bits to true:
 *   - PAN verify success (closes KYC)
 *   - Aadhaar verify success (closes KYC)
 *   - Admin bank verify success
 *   - Admin demat verify success
 */
export async function fireInvestingReadyIfReady(
  scope: MedusaContainer,
  customerId: string,
): Promise<void> {
  try {
    const wallet = scope.resolve(
      CASHFREE_WALLET_MODULE,
    ) as CashfreeWalletService
    const status = await wallet.getKycStatus(customerId)
    if (status.overall !== "approved") return
    if (!status.has_verified_bank) return
    if (!status.has_primary_demat) return

    const customerModule = scope.resolve(Modules.CUSTOMER) as any
    const customer = await customerModule
      .retrieveCustomer(customerId, { select: ["id", "metadata"] })
      .catch(() => null)
    if (!customer) return
    const meta = (customer.metadata ?? {}) as Record<string, unknown>
    if (meta.investing_ready_notified_at) return

    await sendEventEmail(scope, "investing.ready", {
      customer_id: customerId,
    })

    // Side-effect: if THIS customer was referred by someone, credit
    // the referee bonus now. The method is internally gated (kyc
    // overall='approved' check, pending-referral lookup, idempotent
    // via `referee_credited_at`) so it's safe to call unconditionally
    // here — every customer who clears the investing-ready bar runs
    // it once. Referrer-side credit fires separately from the
    // order.placed subscriber once the referee's cumulative buy
    // crosses the threshold. Wrapped in catch so a referral-side
    // failure never blocks the investing-ready notification.
    try {
      const refereeCredited =
        await wallet.creditRefereeReferralOnKycComplete(customerId)
      if (refereeCredited) {
        // Dispatch the referee-side notification + gamification. The
        // referrer is NOT notified here — their bonus is a separate
        // event that fires when the referee's lifetime buy crosses
        // the threshold (see subscribers/referral-reward.ts).
        try {
          const [referral] = await wallet.listReferrals(
            { referred_customer_id: customerId },
            { take: 1 },
          )
          if (referral) {
            const refereeReward = Number(
              (referral as any).referee_reward_inr ??
                (referral as any).reward_amount_inr ??
                250,
            )
            await sendEventEmail(scope, "referral.credited", {
              customer_id: customerId,
              role: "referee",
              amount_inr: refereeReward,
            })
            await grantPointsForEvent({
              scope,
              customer_id: customerId,
              event_kind: "referral.credited",
              amount: 100,
              source: "REFERRAL",
              reference_type: "referral",
              reference_id: (referral as any).id,
              idempotency_key: `REFERRAL:referee:${(referral as any).id}`,
              note: `Referral credited — joined via friend, KYC complete`,
            })
          }
        } catch (sideEffectErr) {
          logger.warn(
            "fireInvestingReadyIfReady: referee credit landed but email/gamification failed",
            {
              customer_id: customerId,
              error: (sideEffectErr as Error).message,
            },
          )
        }
      }
    } catch (creditErr) {
      logger.warn(
        "fireInvestingReadyIfReady: referee referral credit failed (non-blocking)",
        {
          customer_id: customerId,
          error: (creditErr as Error).message,
        },
      )
    }

    // Auto-close any leftover `manual_kyc_request` rows for this
    // customer. By the time this hook runs the customer's KYC is
    // overall='approved' (PAN + Aadhaar + Bank + Demat all green) so
    // any pending queue row is, by definition, stale — the per-kind
    // verify routes already auto-close on their own success path, but
    // belt-and-braces here covers the case where a partial-match flag
    // opened a queue row that the canonical auto-close path missed
    // (silently swallowed catch, customer-initiated "Request manual
    // review" after the partial flag, etc.). Replaces the deprecated
    // "Mark resolved" admin button on /app/manual-kyc — admins no
    // longer need a manual escape hatch for the stale-row case.
    try {
      const stale = await wallet.listManualKycRequests(
        { customer_id: customerId, status: "pending" } as any,
        { take: 5 } as any,
      )
      if (Array.isArray(stale) && stale.length > 0) {
        for (const row of stale as any[]) {
          await wallet
            .updateManualKycRequests({
              selector: { id: row.id },
              data: {
                status: "cancelled",
                reviewer_notes:
                  "Auto-cancelled: customer's KYC reached overall='approved' via the canonical path; no further admin action needed on this row.",
                reviewed_at: new Date(),
              },
            })
            .catch((closeErr: Error) => {
              logger.warn(
                "fireInvestingReadyIfReady: stale manual_kyc_request auto-close failed",
                {
                  customer_id: customerId,
                  request_id: row.id,
                  error: closeErr.message,
                },
              )
            })
        }
      }
    } catch (sweepErr) {
      logger.warn(
        "fireInvestingReadyIfReady: manual_kyc_request sweep failed (non-blocking)",
        {
          customer_id: customerId,
          error: (sweepErr as Error).message,
        },
      )
    }

    await customerModule
      .updateCustomers(customerId, {
        metadata: {
          ...meta,
          investing_ready_notified_at: new Date().toISOString(),
        },
      })
      .catch((err: Error) => {
        logger.warn(
          "fireInvestingReadyIfReady: failed to stamp idempotency key",
          { customer_id: customerId, error: err.message },
        )
      })
  } catch (err) {
    logger.warn("fireInvestingReadyIfReady failed (non-blocking)", {
      customer_id: customerId,
      error: (err as Error).message,
    })
  }
}
