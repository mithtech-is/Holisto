import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { z } from "zod"
import {
  CASHFREE_WALLET_MODULE,
  CashfreeWalletService,
} from "../../../../../modules/cashfree_wallet"
import { logger } from "../../../../../utils/logger"
import { sendEventEmail } from "../../../../../lib/send-event-email"
import { fireInvestingReadyIfReady } from "../../../../../utils/onboarding-events"

/**
 * POST /admin/bank-accounts/:id/verify
 *
 * Manually mark a customer bank account as verified (e.g. after an offline
 * penny-drop or document review). Optionally attempts to provision a
 * Cashfree Auto Collect VBA locked to this bank — if Cashfree is
 * configured, the VBA is created and returned; if not, the bank is still
 * verified and the caller can provision later.
 *
 * Body:
 *   {
 *     decision: "approved" | "rejected",
 *     reason: string,
 *     provision_vba?: boolean  // default true when approved
 *   }
 */
const BodySchema = z.object({
  decision: z.enum(["approved", "rejected"]),
  reason: z.string().trim().min(4).max(500),
  provision_vba: z.boolean().optional(),
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
  const bank = await walletModule.retrieveBankAccount(id as string).catch(() => null)
  if (!bank) return res.status(404).json({ message: "Bank account not found" })

  const adminUserId =
    (req as any).auth_context?.actor_id ??
    (req as any).auth_context?.app_metadata?.user_id ??
    "unknown"

  const nowIso = new Date()
  const verified = parsed.data.decision === "approved"

  // Auto-promote logic — match the storefront /store/bank-accounts
  // behavior: when this verify is succeeding AND the customer has no
  // other verified+primary bank, mark THIS row as primary. The admin
  // route used to never touch is_primary, so manually-approved banks
  // sat verified+is_primary=false and getKycStatus.has_verified_bank
  // (which doesn't actually require primary, but downstream gates
  // like VBA provisioning + Partial KYC display logic do) was off.
  let shouldPromote = false
  if (verified) {
    const existing = (await walletModule.listBankAccounts({
      customer_id: bank.customer_id,
    } as any)) as any[]
    const anyVerifiedPrimary = existing.some(
      (b) =>
        b.id !== bank.id &&
        b.verification_status === "verified" &&
        b.is_primary === true,
    )
    shouldPromote = !anyVerifiedPrimary
  }

  const updated = await walletModule.updateBankAccounts({
    selector: { id: bank.id },
    data: {
      verification_status: verified ? "verified" : "failed",
      verified_at: verified ? nowIso : null,
      verification_raw: {
        manual_override: true,
        admin_user_id: adminUserId,
        reason: parsed.data.reason,
        decision: parsed.data.decision,
        prior_status: bank.verification_status,
        at: nowIso.toISOString(),
      },
      // On successful verify: stay primary if already primary, or
      // become primary if this is the customer's first verified bank.
      // On reject: demote.
      is_primary: verified ? bank.is_primary || shouldPromote : false,
    },
  })

  // Audit row in SecureIdVerification
  await walletModule.createSecureIdVerifications({
    customer_id: bank.customer_id,
    kind: "bank_penny",
    reference_id: `manual:${adminUserId}:${Date.now()}`,
    status: verified ? "success" : "failed",
    input_masked: `XXXXXX${bank.account_number_last4}@${bank.ifsc}`,
    response_raw: {
      manual_override: true,
      admin_user_id: adminUserId,
      reason: parsed.data.reason,
      decision: parsed.data.decision,
    },
    expires_at: null,
    attempt_no: 1,
  })

  // Backfill the global bank_record. The storefront /store/bank-accounts
  // POST upserts here on `verified` / `name_mismatch`, but a customer
  // who landed on `failed` (network blip, Cashfree 5xx, or score under
  // floor) gets no registry row — and then admin-only manual approval
  // never fixed it either. As of 2026-05-08 the admin path also writes
  // the registry row so the cache-first lookup on the NEXT customer
  // adding the same account benefits from this manual decision.
  // Best-effort: a failure here doesn't block the bank verify.
  if (verified && bank.bank_hash) {
    try {
      const verificationRaw = (bank as any).verification_raw ?? {}
      await walletModule.upsertBankRecord({
        bank_hash: bank.bank_hash,
        account_number_masked: `XXXXXX${bank.account_number_last4}`,
        ifsc: bank.ifsc,
        bank_name: bank.bank_name ?? null,
        // The bank_account row carries whatever the original Cashfree
        // attempt returned (or null if penny-drop never landed). We
        // forward those fields to the registry — the manual override
        // is the SOURCE of the verified status, not a re-computed
        // score. response_raw flags the manual path so the registry
        // audit doesn't pretend Cashfree confirmed it.
        account_status: "VALID",
        account_status_code: "MANUAL_OVERRIDE",
        name_at_bank:
          (verificationRaw.name_at_bank as string | undefined) ??
          bank.account_holder_name ??
          null,
        name_match_result:
          (verificationRaw.name_match_result as string | undefined) ?? null,
        name_match_score:
          typeof verificationRaw.name_match_score === "number"
            ? verificationRaw.name_match_score
            : null,
        ifsc_details:
          (verificationRaw.ifsc_details as Record<string, unknown> | undefined) ??
          null,
        cashfree_ref_id:
          (verificationRaw.reference_id as string | undefined) ?? null,
        response_raw: {
          manual_override: true,
          admin_user_id: adminUserId,
          reason: parsed.data.reason,
          prior_verification_raw: verificationRaw,
        },
      })
    } catch (registryErr) {
      logger.warn("admin bank verify: bank_record upsert failed (non-blocking)", {
        bank_account_id: bank.id,
        error: (registryErr as Error).message,
      })
    }
  }

  let vbaResult: any = null
  let vbaError: string | null = null
  const wantsVba = verified && (parsed.data.provision_vba ?? true)
  if (wantsVba) {
    try {
      // Look up customer display info
      const customerModule = req.scope.resolve("customer") as any
      const customer = await customerModule
        .retrieveCustomer(bank.customer_id)
        .catch(() => null)
      const fullName =
        [customer?.first_name, customer?.last_name]
          .filter(Boolean)
          .join(" ")
          .trim() ||
        bank.account_holder_name ||
        "Polemarch Investor"
      const ci = req.scope.resolve("customer_identity") as any
      let clientIdRow = await ci.getByCustomerId(bank.customer_id)
      if (!clientIdRow?.client_id) {
        clientIdRow = await ci.assignClientId(
          bank.customer_id,
          customer?.created_at ?? new Date(),
        )
      }
      const vba = await walletModule.provisionVirtualAccountForCustomer({
        customer_id: bank.customer_id,
        client_id: clientIdRow.client_id,
        customer_name: fullName,
        customer_email:
          customer?.email || `${bank.customer_id}@noreply.polemarch.in`,
        customer_phone: customer?.phone || "0000000000",
        customer_metadata: (customer?.metadata ?? null) as
          | Record<string, unknown>
          | null,
      })
      vbaResult = {
        virtual_account_number: vba.virtual_account_number,
        ifsc: vba.ifsc,
        bank_code: vba.bank_code,
      }
      // Push the latest verified-bank list onto Cashfree's
      // allowed_remitters via PUT /pg/vba/{id}. On the first manual
      // verify this is a redundant replay of what create just sent;
      // on the 2nd+ verify (where provision returned an existing VBA)
      // this is what actually adds the new bank to the lock list.
      // Best-effort — webhook TPV still gates funds at deposit.
      try {
        await walletModule.syncVbaAllowedRemitters({
          customer_id: bank.customer_id,
          customer_metadata: (customer?.metadata ?? null) as
            | Record<string, unknown>
            | null,
        })
      } catch (syncErr) {
        logger.warn(
          "manual-verify VBA allowed-remitters sync failed (non-blocking)",
          {
            bank_account_id: bank.id,
            error: (syncErr as Error).message,
          },
        )
      }
    } catch (err) {
      vbaError = (err as Error).message
      logger.warn("manual-verify VBA provisioning failed", {
        bank_account_id: bank.id,
        error: vbaError,
      })
    }
  }

  // Drain held attempts in case KYC was waiting on bank verification
  if (verified) {
    await walletModule
      .captureHeldPaymentAttempts(bank.customer_id)
      .catch(() => {})
  }

  const row = Array.isArray(updated) ? updated[0] : updated

  await sendEventEmail(
    req.scope,
    verified ? "bank.verified" : "bank.rejected",
    {
      customer_id: bank.customer_id,
      account_last4: bank.account_number_last4,
      ifsc: bank.ifsc,
      virtual_account_number: vbaResult?.virtual_account_number ?? "—",
      reason: parsed.data.reason,
      bank_url: `${process.env.STOREFRONT_URL || "https://polemarch.in"}/dashboard/bank-accounts`,
      wallet_url: `${process.env.STOREFRONT_URL || "https://polemarch.in"}/dashboard/wallet`,
    },
  )

  // If this verification closes the trio (KYC + bank + demat), fire
  // the invest-ready milestone (the only WhatsApp celebration). Helper
  // is idempotent + best-effort.
  if (verified) {
    await fireInvestingReadyIfReady(req.scope, bank.customer_id)
  }

  // Auto-close any pending manual_kyc_request for this customer —
  // mirrors the auto-close in /admin/customers/:id/kyc/manual. Without
  // this, the request row that was opened on bank submission stays in
  // /app/manual-kyc as "pending" even after the bank is verified.
  // Idempotent: no-op when no pending request exists.
  try {
    const pendingReqs = await walletModule.listManualKycRequests(
      { customer_id: bank.customer_id, status: "pending" } as any,
      { take: 5 },
    )
    for (const pendingReq of pendingReqs as any[]) {
      await walletModule.updateManualKycRequests({
        selector: { id: pendingReq.id },
        data: {
          status: verified ? "approved" : "rejected",
          reviewer_user_id: adminUserId === "unknown" ? null : adminUserId,
          reviewer_notes: `[Auto-closed by bank ${parsed.data.decision}] ${parsed.data.reason}`,
          reviewed_at: new Date(),
        },
      })
    }
  } catch (err) {
    logger.warn("bank verify: auto-close manual_kyc_request failed", {
      bank_id: bank.id,
      customer_id: bank.customer_id,
      error: (err as Error).message,
    })
  }

  res.json({
    ok: true,
    bank_account: {
      id: row.id,
      verification_status: row.verification_status,
      is_primary: row.is_primary,
      verified_at: row.verified_at,
    },
    virtual_account: vbaResult,
    virtual_account_error: vbaError,
  })
}
