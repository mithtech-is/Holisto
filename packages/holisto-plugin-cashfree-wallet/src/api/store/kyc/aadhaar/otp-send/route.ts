import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { z } from "zod"
import { createHash } from "node:crypto"
import { Modules } from "@medusajs/framework/utils"
import {
  CASHFREE_WALLET_MODULE,
  CashfreeWalletService,
} from "../../../../../modules/cashfree_wallet"
import {
  CUSTOMER_IDENTITY_MODULE,
  CustomerIdentityService,
} from "../../../../../modules/customer_identity"
import {
  redactSecureIdResponse,
  gradeNameMatchCrossDoc,
} from "../../../../../modules/cashfree_wallet/cashfree/secure-id"
import { maskAadhaar } from "../../../../../modules/cashfree_wallet/cashfree/crypto"
import { sendEventEmail } from "../../../../../lib/send-event-email"
import { findConflictingAadhaarHashCustomer } from "../../../../../utils/identity-uniqueness"

/**
 * SHA-256 hex of the 12-digit Aadhaar (whitespace stripped). Stored
 * on the otp-send audit row's `response_raw._aadhaar_hash` so the
 * follow-up otp-verify call can resolve which `aadhaar_record` to
 * upsert on success — without us ever persisting the raw Aadhaar.
 */
function aadhaarFingerprint(aadhaar: string): string {
  return createHash("sha256")
    .update(aadhaar.replace(/\s+/g, ""))
    .digest("hex")
}
import {
  hitRateLimit,
  SECURE_ID_LIMITS,
} from "../../../../../modules/cashfree_wallet/rate-limit"
import { logger } from "../../../../../utils/logger"
import { CashfreeApiError } from "../../../../../modules/cashfree_wallet/cashfree/client"

const AadhaarSchema = z.object({
  aadhaar: z
    .string()
    .trim()
    .transform((s) => s.replace(/\s+/g, ""))
    .refine((s) => /^\d{12}$/.test(s), "Aadhaar must be 12 digits"),
})

const OTP_TTL_MS = 10 * 60 * 1000 // 10 min

/**
 * POST /store/kyc/aadhaar/otp-send
 * Body: { aadhaar }
 *
 * Rate-limited 3/hour + 5/day per customer. Persists a pending
 * SecureIdVerification row with `ref_id` from Cashfree + 10min expiry.
 */
export const POST = async (req: MedusaRequest, res: MedusaResponse) => {
  const customerId = (req as any).auth_context?.app_metadata?.customer_id as
    | string
    | undefined
  if (!customerId) return res.status(401).json({ message: "Not authenticated" })

  const parsed = AadhaarSchema.safeParse(req.body)
  if (!parsed.success) {
    return res
      .status(400)
      .json({ message: "Invalid input", errors: parsed.error.flatten() })
  }
  const { aadhaar } = parsed.data

  const walletModule = req.scope.resolve(
    CASHFREE_WALLET_MODULE
  ) as CashfreeWalletService

  // Admin-controlled per-kind switch. Refuse before hitting rate-limit
  // or Cashfree so OPS can quickly turn Aadhaar off if UIDAI is down.
  const gate = await walletModule.isSecureIdKindEnabled("aadhaar")
  if (!gate.enabled) {
    return res.status(403).json({
      ok: false,
      reason: gate.reason,
      message:
        "Aadhaar verification is currently unavailable. Please request a manual review.",
    })
  }

  // Idempotency: once a customer has a successful Aadhaar OTP verify on
  // record, refuse to start a new one. The separate `aadhaar_otp_verify`
  // row (not `aadhaar_otp_send`) is the one that reflects completion.
  const priorVerify = await walletModule.listSecureIdVerifications({
    customer_id: customerId,
    kind: "aadhaar_otp_verify",
  })
  if (priorVerify.some((v) => v.status === "success")) {
    return res.status(409).json({
      ok: false,
      reason: "already_verified",
      message: "Aadhaar is already verified for this account.",
    })
  }

  // ── Global Aadhaar cache short-circuit ─────────────────────────
  //
  // If the typed Aadhaar's hash already lives in our `aadhaar_record`
  // table (i.e. UIDAI-confirmed via Cashfree on a prior session, by
  // ANY customer), we skip the OTP entirely and route this attempt
  // through admin manual review. Two reasons:
  //   1. UIDAI has already confirmed the holder data — we trust the
  //      cache row's name, dob, photo, address.
  //   2. The customer has not (yet) proven they OWN the Aadhaar this
  //      session, so we don't auto-link the hash. Admin reviews the
  //      uploaded Aadhaar card photo against the cached holder data
  //      and approves manually.
  //
  // Cashfree OTP burn is reserved for fresh Aadhaars (cache miss) —
  // those still need the OTP because we have no prior identity
  // anchor to cross-check against. Below 0.3 cross-doc score we ALSO
  // fall through to Cashfree (the typed Aadhaar might be wrong; let
  // UIDAI catch that).
  const aadhaarHash = aadhaarFingerprint(aadhaar)
  const cachedAadhaar = await walletModule
    .lookupAadhaarRecordByHash(aadhaarHash)
    .catch(() => null)
  if (cachedAadhaar) {
    // Uniqueness — refuse if another customer already linked this
    // Aadhaar's hash. Same DB partial-unique index check that
    // otp-verify runs after Cashfree confirms.
    try {
      const conflictId = await findConflictingAadhaarHashCustomer(
        req.scope,
        aadhaarHash,
        customerId,
      )
      if (conflictId) {
        return res.status(409).json({
          ok: false,
          reason: "already_registered",
          message:
            "This Aadhaar is already linked to another Polemarch account. If that's also you, sign in with the other email.",
        })
      }
    } catch {
      /* non-fatal — fall through to admin review */
    }

    // PAN-registered name is the identity anchor for the cross-doc
    // match. Same fallback chain otp-verify uses (metadata pointer →
    // pan_record by hash). Hard-fail when PAN isn't on file: the
    // Aadhaar verification must anchor against an already-verified
    // PAN, otherwise the cached holder name has nothing to match
    // against.
    const customerModule = req.scope.resolve(Modules.CUSTOMER) as any
    const cust = await customerModule
      .retrieveCustomer(customerId)
      .catch(() => null)
    const meta = (cust?.metadata ?? {}) as Record<string, unknown>
    let panRegisteredName: string | null =
      typeof meta.pan_registered_name === "string" &&
      (meta.pan_registered_name as string).trim().length > 0
        ? (meta.pan_registered_name as string).trim()
        : null
    const panHashMeta =
      typeof meta.pan_hash === "string" && (meta.pan_hash as string).length > 0
        ? (meta.pan_hash as string)
        : null
    if (!panRegisteredName && panHashMeta) {
      try {
        const [panRecord] = await walletModule.listPanRecords(
          { pan_hash: panHashMeta } as any,
          { take: 1 },
        )
        const fromRecord = (panRecord as any)?.registered_name
        if (typeof fromRecord === "string" && fromRecord.trim().length > 0) {
          panRegisteredName = fromRecord.trim()
        }
      } catch {
        /* non-fatal */
      }
    }
    // Decide whether the cache-hit path can short-circuit, or whether
    // we should still fall through to Cashfree to give UIDAI a chance
    // to close the loop (e.g. wrong-Aadhaar typed against an existing
    // PAN).
    //
    // Three sub-cases under cache hit:
    //   (a) No PAN on file        → cached data is sufficient context
    //                                for admin review. Skip Cashfree.
    //   (b) PAN + cross-doc ≥0.3  → name aligns enough for admin to
    //                                approve from cached data. Skip
    //                                Cashfree.
    //   (c) PAN + cross-doc <0.3  → cached holder name has no overlap
    //                                with this customer's PAN-registered
    //                                name. Probably wrong Aadhaar.
    //                                Fall through to Cashfree so UIDAI's
    //                                OTP routes to the real holder's
    //                                phone — closes the loop without
    //                                leaking that the Aadhaar exists
    //                                in our cache.
    let shortCircuit = false
    let pendingReason = "cached_aadhaar_admin_review"
    let adminNote = ""
    let pendingMessage = ""
    // Auto-link state — set when we can confidently attribute the
    // cached aadhaar_record to this customer without admin review.
    let autoLink = false
    let autoLinkScore = 0
    let autoLinkGrade = ""
    if (!panRegisteredName) {
      shortCircuit = true
      pendingReason = "cached_aadhaar_no_pan_anchor"
      adminNote =
        "[Auto-flagged] Aadhaar already in our registry (UIDAI-confirmed previously). Skipped OTP. Customer's PAN isn't on file yet — wait for PAN verification or reach out for additional documents before approving."
      pendingMessage =
        "Partial match — our team will review and approve. You'll get an email once it's done."
    } else {
      const graded = gradeNameMatchCrossDoc(cachedAadhaar.name, panRegisteredName)
      if (graded.score >= 0.3) {
        // Re-registration auto-link gate.
        //
        // When the customer is re-registering with a PAN we've seen
        // before (customer_identity_registry.reattach_count > 0 OR
        // release_count > 0 — both indicate the registry row predates
        // this customer) AND the cached aadhaar_record's holder name
        // matches their PAN-registered name strongly (≥0.85, same
        // threshold as the live OTP-verify auto-pass), it's the same
        // human as the prior account. Auto-link without admin review.
        //
        // Without this branch, every re-registration with a previously-
        // verified Aadhaar got stuck in a "Partial match — pending
        // review" loop even at score 1.00 (EXACT_MATCH). Soubarna hit
        // exactly this on 2026-05-10.
        const AADHAAR_AUTO_LINK_SCORE = 0.85
        if (graded.score >= AADHAAR_AUTO_LINK_SCORE && panHashMeta) {
          try {
            const identity = req.scope.resolve(
              CUSTOMER_IDENTITY_MODULE,
            ) as CustomerIdentityService
            const registry = await identity
              .lookupRegistryByPanHash(panHashMeta)
              .catch(() => null)
            const isReattach =
              !!registry &&
              ((registry as any).reattach_count > 0 ||
                (registry as any).release_count > 0)
            if (isReattach) {
              autoLink = true
              autoLinkScore = graded.score
              autoLinkGrade = graded.grade
            }
          } catch {
            /* fall through to admin-review */
          }
        }

        if (!autoLink) {
          shortCircuit = true
          pendingReason = "cached_aadhaar_admin_review"
          adminNote =
            "[Auto-flagged] Aadhaar already in our registry (UIDAI-confirmed previously). Skipped OTP; cross-doc name match against PAN scored " +
            graded.score.toFixed(2) +
            " (" +
            graded.grade +
            "). Admin must review uploaded Aadhaar card photo and approve / reject."
          pendingMessage =
            "Partial match — our team will review and approve. You'll get an email once it's done."
        }
      }
      // score < 0.3 → leave shortCircuit=false; falls through to
      // Cashfree below.
    }

    if (autoLink) {
      // Same human re-registering. Link the cached aadhaar_record to
      // this customer's metadata + audit a clean success row, mirroring
      // what the live otp-verify success path does when name-match
      // clears the auto-pass threshold.
      try {
        const customerModule2 = req.scope.resolve(Modules.CUSTOMER) as any
        const cust2 = await customerModule2
          .retrieveCustomer(customerId)
          .catch(() => null)
        const baseMeta: Record<string, unknown> = {
          ...((cust2?.metadata ?? {}) as Record<string, unknown>),
          aadhaar_hash: cachedAadhaar.aadhaar_hash,
          aadhaar_full_number:
            (cachedAadhaar as any).aadhaar_full ?? aadhaar,
          aadhaar_name: cachedAadhaar.name,
          aadhaar_dob: (cachedAadhaar as any).date_of_birth ?? null,
          aadhaar_gender: (cachedAadhaar as any).gender ?? null,
          aadhaar_father_name: (cachedAadhaar as any).father_name ?? null,
          aadhaar_photo_url: (cachedAadhaar as any).photo_url ?? null,
          aadhaar_name_match_grade: autoLinkGrade,
          aadhaar_name_match_score: autoLinkScore,
          aadhaar_verified: true,
          aadhaar_verified_at: new Date().toISOString(),
          aadhaar_link_source: "cached_match_reattach_auto_link",
        }
        await customerModule2.updateCustomers(customerId, { metadata: baseMeta })
      } catch (err) {
        logger.warn("aadhaar auto-link metadata write failed", {
          customer_id: customerId,
          error: (err as Error).message,
        })
      }

      await walletModule
        .createSecureIdVerifications({
          customer_id: customerId,
          kind: "aadhaar_otp_verify",
          reference_id: `cached_match_reattach:${cachedAadhaar.id}`,
          status: "success",
          input_masked: maskAadhaar(aadhaar),
          response_raw: {
            cached_match: true,
            aadhaar_record_id: cachedAadhaar.id,
            registered_name: cachedAadhaar.name,
            auto_linked_via_reattach: true,
            cross_doc_score: autoLinkScore,
            cross_doc_grade: autoLinkGrade,
            reason: "cached_aadhaar_reattach_auto_link",
          },
          expires_at: null,
          attempt_no: 1,
        })
        .catch(() => {})

      logger.info(
        "[aadhaar-cache] auto-linked cached aadhaar to re-registered customer",
        {
          customer_id: customerId,
          aadhaar_record_id: cachedAadhaar.id,
          score: autoLinkScore,
        },
      )

      return res.json({
        ok: true,
        cached: true,
        auto_linked: true,
        masked_aadhaar: cachedAadhaar.aadhaar_masked,
        message:
          "Aadhaar verified. We recognised this Aadhaar from your earlier account.",
      })
    }

    if (shortCircuit) {
      try {
        const [existingReq] = await walletModule.listManualKycRequests(
          { customer_id: customerId, status: "pending" },
          { take: 1 },
        )
        if (!existingReq) {
          await walletModule.createManualKycRequests({
            customer_id: customerId,
            customer_note: adminNote,
            status: "pending",
          })
        }
        await sendEventEmail(req.scope, "admin.new_manual_kyc_request", {
          customer_id: customerId,
          customer_note: adminNote,
          admin_review_url: `${process.env.MEDUSA_ADMIN_URL || ""}/app/manual-kyc`,
        })
      } catch (e) {
        logger.warn("auto-flag manual KYC request (aadhaar cache) failed", {
          customer_id: customerId,
          error: (e as Error).message,
        })
      }

      // Audit row: kind=aadhaar_otp_verify (the kind getKycStatus
      // reads), status=pending, response_raw flags it as a cached
      // lookup so admin tooling can show the right context. We
      // skip the otp_send audit kind entirely (no OTP was sent).
      await walletModule
        .createSecureIdVerifications({
          customer_id: customerId,
          kind: "aadhaar_otp_verify",
          reference_id: null,
          status: "pending",
          input_masked: maskAadhaar(aadhaar),
          response_raw: {
            cached_match: true,
            aadhaar_record_id: cachedAadhaar.id,
            registered_name: cachedAadhaar.name,
            needs_admin_review: true,
            reason: pendingReason,
          },
          expires_at: null,
          attempt_no: 1,
        })
        .catch(() => {})

      return res.json({
        ok: true,
        cached: true,
        pending_review: true,
        pending_reason: pendingReason,
        masked_aadhaar: cachedAadhaar.aadhaar_masked,
        pending_message: pendingMessage,
      })
    }
  }

  const rlHour = hitRateLimit(
    `aadhaar_otp_hr:${customerId}`,
    SECURE_ID_LIMITS.aadhaar_otp_send_hour.limit,
    SECURE_ID_LIMITS.aadhaar_otp_send_hour.windowMs
  )
  if (!rlHour.allowed) {
    return res.status(429).json({
      message: "Too many OTP requests in the last hour.",
      reset_at: rlHour.reset_at,
    })
  }
  const rlDay = hitRateLimit(
    `aadhaar_otp_day:${customerId}`,
    SECURE_ID_LIMITS.aadhaar_otp_send_day.limit,
    SECURE_ID_LIMITS.aadhaar_otp_send_day.windowMs
  )
  if (!rlDay.allowed) {
    return res.status(429).json({
      message: "Daily OTP limit reached.",
      reset_at: rlDay.reset_at,
    })
  }

  try {
    const secureId = await walletModule.getSecureId()
    const result = await secureId.sendAadhaarOtp({ aadhaar })
    // Stash the aadhaar_hash on the audit row so the follow-up
    // otp-verify call can resolve the same global aadhaar_record
    // without re-receiving the raw number. The hash is one-way and
    // safe to leave alongside the redacted Cashfree response.
    await walletModule.createSecureIdVerifications({
      customer_id: customerId,
      kind: "aadhaar_otp_send",
      reference_id: result.ref_id,
      status: result.ok ? "pending" : "failed",
      input_masked: maskAadhaar(aadhaar),
      response_raw: {
        ...redactSecureIdResponse(result.raw),
        _aadhaar_hash: aadhaarFingerprint(aadhaar),
        _aadhaar_masked: maskAadhaar(aadhaar),
        // Stash the full 12-digit Aadhaar so the follow-up otp-verify
        // can persist it on aadhaar_record (per 2026-04-28 operator
        // call: store full plaintext, encryption later). UIDAI Act
        // §28: this row is the customer-bound audit blob; the full
        // Aadhaar is held only for the ~10min OTP window then
        // copied to the global aadhaar_record on success.
        _aadhaar_full: aadhaar,
      },
      expires_at: result.ok ? new Date(Date.now() + OTP_TTL_MS) : null,
      attempt_no: 1,
    })
    if (!result.ok || !result.ref_id) {
      return res.status(400).json({
        ok: false,
        message: result.message || "Failed to send OTP",
      })
    }
    return res.json({
      ok: true,
      ref_id: result.ref_id,
      expires_at: new Date(Date.now() + OTP_TTL_MS).toISOString(),
    })
  } catch (err) {
    const isApi = err instanceof CashfreeApiError
    logger.warn("aadhaar otp send failed", {
      customer_id: customerId,
      status: isApi ? err.status : undefined,
    })
    const code = isApi && err.status < 500 ? 400 : 502
    return res.status(code).json({
      ok: false,
      message: isApi
        ? `OTP request rejected (${err.status})`
        : "OTP service unavailable",
    })
  }
}
