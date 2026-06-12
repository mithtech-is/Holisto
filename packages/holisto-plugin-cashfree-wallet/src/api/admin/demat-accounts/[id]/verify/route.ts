import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { z } from "zod"
import {
  CASHFREE_WALLET_MODULE,
  CashfreeWalletService,
} from "../../../../../modules/cashfree_wallet"
import { logger } from "../../../../../utils/logger"
import { sendEventEmail } from "../../../../../lib/send-event-email"
import { grantPointsForEvent } from "../../../../../lib/grant-points"
import { fireInvestingReadyIfReady } from "../../../../../utils/onboarding-events"

/**
 * POST /admin/demat-accounts/:id/verify
 *
 * Manually mark a demat as verified/rejected — used when Cashfree CMR
 * verification isn't available or the CMR needed a human look.
 *
 * Body:
 *   {
 *     decision: "approved" | "rejected",
 *     reason: string,
 *     make_primary?: boolean   // auto-promote this demat to primary on approval
 *   }
 */
const BodySchema = z.object({
  decision: z.enum(["approved", "rejected"]),
  reason: z.string().trim().min(4).max(500),
  make_primary: z.boolean().optional(),
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
  const demat = await walletModule
    .retrieveDematAccount(id as string)
    .catch(() => null)
  if (!demat) return res.status(404).json({ message: "Demat account not found" })

  const adminUserId =
    (req as any).auth_context?.actor_id ??
    (req as any).auth_context?.app_metadata?.user_id ??
    "unknown"

  const verified = parsed.data.decision === "approved"
  const nowIso = new Date()

  // Auto-promote logic — when this verify is succeeding AND the
  // customer has no other verified+primary demat yet, mark THIS row
  // as primary. Mirrors the storefront /store/demat-accounts behavior
  // and stops Partial KYC from showing the customer as "demat: pending"
  // after a successful manual approve. The previous code only
  // promoted when the caller passed `make_primary: true` — but the
  // /app/manual-kyc Demat reviews tab doesn't, so the very first
  // approved demat stayed `is_primary: false` and getKycStatus's
  // has_primary_demat check kept returning false.
  let shouldPromote = false
  if (verified) {
    const existing = (await walletModule.listDematAccounts(
      { customer_id: demat.customer_id } as any,
      { take: 50 } as any,
    )) as any[]
    const anyVerifiedPrimary = existing.some(
      (d) =>
        d.id !== demat.id &&
        d.verification_status === "verified" &&
        d.is_primary === true,
    )
    shouldPromote = !anyVerifiedPrimary
  }

  const updated = await walletModule.updateDematAccounts({
    selector: { id: demat.id },
    data: {
      verification_status: verified ? "verified" : "failed",
      verified_at: verified ? nowIso : null,
      verification_raw: {
        manual_override: true,
        admin_user_id: adminUserId,
        reason: parsed.data.reason,
        decision: parsed.data.decision,
        prior_status: demat.verification_status,
        at: nowIso.toISOString(),
      },
      // On verify, become primary if (a) this is the first verified
      // demat (auto-promote) or (b) the row was already primary. On
      // reject, demote from primary.
      is_primary: verified ? demat.is_primary || shouldPromote : false,
    },
  })

  await walletModule.createSecureIdVerifications({
    customer_id: demat.customer_id,
    kind: "cmr",
    reference_id: `manual:${adminUserId}:${Date.now()}`,
    status: verified ? "success" : "failed",
    input_masked:
      demat.boid ?? `${demat.dp_id ?? ""}-${demat.client_id ?? ""}`,
    response_raw: {
      manual_override: true,
      admin_user_id: adminUserId,
      reason: parsed.data.reason,
      decision: parsed.data.decision,
    },
    expires_at: null,
    attempt_no: 1,
  })

  // Sync the global cmr_record so the registry's verification_status
  // tracks the admin's decision. Same pattern as bank_record on
  // /admin/bank-accounts/:id/verify. Soft-failed: a registry sync miss
  // never blocks the admin's decision on the customer-bound row.
  const cmrHash =
    demat.cmr_hash ??
    walletModule.computeCmrHash({
      depository: demat.depository,
      boid: demat.boid,
      dp_id: demat.dp_id,
      client_id: demat.client_id,
    })
  if (cmrHash) {
    await walletModule
      .upsertCmrRecord({
        cmr_hash: cmrHash,
        depository: demat.depository,
        cmr_masked: walletModule.buildCmrMasked({
          depository: demat.depository,
          boid: demat.boid,
          dp_id: demat.dp_id,
          client_id: demat.client_id,
        }),
        dp_id: demat.dp_id ?? null,
        client_id: demat.client_id ?? null,
        boid: demat.boid ?? null,
        dp_name: demat.dp_name,
        account_holder_name: demat.account_holder_name,
        cmr_file_url: demat.cmr_file_url,
        verification_status: verified ? "verified" : "failed",
        verification_raw: {
          manual_override: true,
          admin_user_id: adminUserId,
          reason: parsed.data.reason,
          decision: parsed.data.decision,
          source: "admin.demat-accounts.verify",
        },
      })
      .catch((err: unknown) => {
        logger.warn("[cmr-registry] manual-verify upsert failed", {
          demat_id: demat.id,
          error: (err as Error).message,
        })
      })
    // Stamp cmr_hash on the demat row if it was missing (legacy row).
    if (!demat.cmr_hash) {
      await walletModule
        .updateDematAccounts({
          selector: { id: demat.id },
          data: { cmr_hash: cmrHash },
        })
        .catch(() => null)
    }
  }

  if (verified && parsed.data.make_primary) {
    try {
      await walletModule.setPrimaryDemat(demat.customer_id, demat.id)
    } catch (err) {
      logger.warn("setPrimary failed after manual verify", { error: err })
    }
  }

  if (verified) {
    await walletModule
      .captureHeldPaymentAttempts(demat.customer_id)
      .catch(() => {})
  }

  // Gamification — points credit on manual approval (was previously
  // fired from /store/demat-accounts after the Cashfree CMR call;
  // moved here now that demat verification is admin-driven). Soft-
  // failed; never blocks the response. Idempotency-keyed on the
  // demat id so re-approving (e.g. after a temporary "rejected" flip)
  // doesn't double-credit.
  let gamification:
    | Awaited<ReturnType<typeof grantPointsForEvent>>
    | null = null
  if (verified) {
    gamification = await grantPointsForEvent({
      scope: req.scope,
      customer_id: demat.customer_id,
      event_kind: "kyc.cmr_verified",
      amount: 150,
      source: "KYC_STEP",
      reference_type: "demat_account",
      reference_id: demat.id,
      idempotency_key: `KYC_STEP:cmr:${demat.id}`,
      note: "Demat / CMR verified (manual approval)",
    }).catch(() => null)
  }

  const row = Array.isArray(updated) ? updated[0] : updated

  await sendEventEmail(
    req.scope,
    verified ? "demat.verified" : "demat.rejected",
    {
      customer_id: demat.customer_id,
      dp_name: demat.dp_name ?? "",
      client_id: demat.client_id ?? "",
      depository: demat.depository ?? "",
      reason: parsed.data.reason,
      demat_url: `${process.env.STOREFRONT_URL || "https://polemarch.in"}/dashboard/demat-accounts`,
    },
  )

  // If this verification closes the trio (KYC + bank + demat), fire
  // the invest-ready milestone (the only WhatsApp celebration). Helper
  // is idempotent + best-effort.
  if (verified) {
    await fireInvestingReadyIfReady(req.scope, demat.customer_id)
  }

  // Auto-close any pending manual_kyc_request for this customer —
  // mirrors the auto-close in /admin/customers/:id/kyc/manual. Without
  // this, the request row that was opened on demat submission stays
  // in /app/manual-kyc as "pending" even though the demat is now
  // verified. Idempotent: no-op when no pending request exists.
  try {
    const pendingReqs = await walletModule.listManualKycRequests(
      { customer_id: demat.customer_id, status: "pending" } as any,
      { take: 5 },
    )
    for (const pendingReq of pendingReqs as any[]) {
      await walletModule.updateManualKycRequests({
        selector: { id: pendingReq.id },
        data: {
          status: verified ? "approved" : "rejected",
          reviewer_user_id: adminUserId === "unknown" ? null : adminUserId,
          reviewer_notes: `[Auto-closed by demat ${parsed.data.decision}] ${parsed.data.reason}`,
          reviewed_at: new Date(),
        },
      })
    }
  } catch (err) {
    logger.warn("demat verify: auto-close manual_kyc_request failed", {
      demat_id: demat.id,
      customer_id: demat.customer_id,
      error: (err as Error).message,
    })
  }

  res.json({
    ok: true,
    demat_account: {
      id: row.id,
      verification_status: row.verification_status,
      is_primary: row.is_primary,
      verified_at: row.verified_at,
    },
    gamification,
  })
}
