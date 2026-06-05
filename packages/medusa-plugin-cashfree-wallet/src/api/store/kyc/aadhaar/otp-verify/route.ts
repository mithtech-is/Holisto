import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { z } from "zod"
import {
  CASHFREE_WALLET_MODULE,
  CashfreeWalletService,
} from "../../../../../modules/cashfree_wallet"
import { Modules } from "@medusajs/framework/utils"
import {
  redactSecureIdResponse,
  gradeNameMatch,
  gradeNameMatchCrossDoc,
} from "../../../../../modules/cashfree_wallet/cashfree/secure-id"
import { extractAndPersistAadhaarPhoto } from "../../../../../utils/aadhaar-photo"
import {
  hitRateLimit,
  SECURE_ID_LIMITS,
} from "../../../../../modules/cashfree_wallet/rate-limit"
import { logger } from "../../../../../utils/logger"
import { CashfreeApiError } from "../../../../../modules/cashfree_wallet/cashfree/client"
import { sendEventEmail } from "../../../../../lib/send-event-email"
import { grantPointsForEvent } from "../../../../../lib/grant-points"
import {
  fireFullyApprovedIfReady,
  fireInvestingReadyIfReady,
} from "../../../../../utils/onboarding-events"
import { findConflictingAadhaarHashCustomer } from "../../../../../utils/identity-uniqueness"
import { respondErr } from "../../../../../utils/envelope"

/**
 * Score thresholds for the Aadhaar-name vs PAN-name cross-check.
 * Mirror the bank + PAN flows so all KYC name matches use one bar:
 *   ≥ 0.85 → auto-verify.
 *   0.60–0.85 → name_mismatch (manual review). Aadhaar is still
 *               OTP-confirmed by UIDAI; we just don't auto-link it
 *               to this customer's identity.
 *   < 0.60   → failed.
 *
 * Earlier code:
 *   - compared `result.name` against `customer.first_name + last_name`
 *     — user-editable fields, so a customer could rename their account
 *     to match someone else's Aadhaar holder name and pass the check;
 *   - accepted POOR_PARTIAL_MATCH as `namesAlign = true`;
 *   - defaulted `namesAlign` to `true` when either name was empty;
 *   - linked `customer.metadata.aadhaar_hash` regardless of name
 *     alignment — wrongly attributing an Aadhaar that doesn't belong
 *     to this customer.
 *
 * The fix swaps the comparison source to the PAN-verified name (set
 * on /store/kyc/pan/verify, immutable from the customer's side),
 * requires PAN to be verified first (412 if not), score-gates the
 * verdict, and only writes `aadhaar_hash` + `aadhaar_verified=true`
 * on a clean ≥0.85 match — matching the PAN flow's "don't link on
 * mismatch" rule.
 */
// Lowered 2026-05-07 from 0.85 → 0.80 to mirror the PAN flow change
// (same date). For Aadhaar we additionally use gradeNameMatchCrossDoc
// (see secure-id.ts) which uses min-denominator for asymmetric
// matches — Aadhaar names are often abbreviated where PAN names are
// spelled out (e.g. PAN "Manoj Mithajal Bhat" vs Aadhaar "Manoj M").
const AADHAAR_AUTO_PASS_SCORE = 0.8
const AADHAAR_MANUAL_REVIEW_FLOOR = 0.6

const VerifySchema = z.object({
  ref_id: z.string().trim().min(4).max(100),
  otp: z.string().trim().regex(/^\d{4,8}$/, "OTP must be 4-8 digits"),
})

/**
 * POST /store/kyc/aadhaar/otp-verify
 * Body: { ref_id, otp }
 *
 * Rate-limited to 5 attempts per ref_id. Rejects expired OTP windows
 * locally (10 min from the corresponding otp-send row) before hitting
 * Cashfree.
 */
export const POST = async (req: MedusaRequest, res: MedusaResponse) => {
  const customerId = (req as any).auth_context?.app_metadata?.customer_id as
    | string
    | undefined
  if (!customerId) return res.status(401).json({ message: "Not authenticated" })

  const parsed = VerifySchema.safeParse(req.body)
  if (!parsed.success) {
    return res
      .status(400)
      .json({ message: "Invalid input", errors: parsed.error.flatten() })
  }
  const { ref_id, otp } = parsed.data

  const walletModule = req.scope.resolve(
    CASHFREE_WALLET_MODULE
  ) as CashfreeWalletService

  // Admin-controlled per-kind switch. Matches the guard on otp-send so
  // disabling mid-flow (between send + verify) still refuses the verify.
  const gate = await walletModule.isSecureIdKindEnabled("aadhaar")
  if (!gate.enabled) {
    return res.status(403).json({
      ok: false,
      reason: gate.reason,
      message: "Aadhaar verification is currently unavailable.",
    })
  }

  // Idempotency: if already verified, no need to burn another call.
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

  const rl = hitRateLimit(
    `aadhaar_otp_verify:${ref_id}`,
    SECURE_ID_LIMITS.aadhaar_otp_verify_per_ref.limit,
    SECURE_ID_LIMITS.aadhaar_otp_verify_per_ref.windowMs
  )
  if (!rl.allowed) {
    return res
      .status(429)
      .json({ message: "Too many attempts for this OTP. Request a new one." })
  }

  // Look up the original send to validate ownership + expiry
  const sends = await walletModule.listSecureIdVerifications({
    customer_id: customerId,
    kind: "aadhaar_otp_send",
    reference_id: ref_id,
  })
  const send = sends[0]
  if (!send) {
    return res.status(400).json({ message: "Unknown OTP reference" })
  }
  if (send.expires_at && new Date(send.expires_at).getTime() < Date.now()) {
    return res.status(400).json({ message: "OTP expired — request a new one" })
  }

  try {
    const secureId = await walletModule.getSecureId()
    const result = await secureId.verifyAadhaarOtp({ ref_id, otp })

    // OTP failure short-circuits — record the failed audit row and
    // bail before any name-match work. We DON'T create the success
    // row here yet (unlike the previous implementation): the eventual
    // `secure_id_verification.status` must reflect the COMBINED
    // verdict (Cashfree OTP success AND PAN-name match), because
    // `getKycStatus` derives `aadhaar_verified` from that row's
    // status. Recording success on OTP-success-alone meant a customer
    // who passed OTP but failed name match would still show up as
    // KYC-Aadhaar-verified — exactly the hole this rewrite closes.
    if (!result.ok) {
      await walletModule.createSecureIdVerifications({
        customer_id: customerId,
        kind: "aadhaar_otp_verify",
        reference_id: ref_id,
        status: "failed",
        input_masked: result.masked_aadhaar ?? send.input_masked ?? null,
        response_raw: redactSecureIdResponse(result.raw),
        expires_at: null,
        attempt_no: 1,
      })
      return res.status(400).json({ ok: false, message: "OTP rejected" })
    }

    // ── Global aadhaar_record upsert ──────────────────────────────
    //
    // Same retention contract as `pan_record`: keyed by SHA-256 of
    // the 12-digit Aadhaar (computed during otp-send + stashed on
    // that audit row's response_raw._aadhaar_hash), survives
    // customer deletion. Multiple customers verifying the same
    // Aadhaar share one row.
    //
    // We pull demographic fields out of Cashfree's response when
    // present (PAN-Advance-like fill rate) — name is always set on
    // success; dob / gender / address vary.
    const sendRaw = (send.response_raw ?? {}) as Record<string, unknown>
    const aadhaarHash =
      typeof sendRaw._aadhaar_hash === "string" ? sendRaw._aadhaar_hash : null
    const aadhaarMaskedFromSend =
      typeof sendRaw._aadhaar_masked === "string"
        ? sendRaw._aadhaar_masked
        : null
    // Full 12-digit Aadhaar stashed by the otp-send step. Per the
    // 2026-04-28 operator call we persist it plaintext on
    // aadhaar_record; encryption will be layered on later.
    const aadhaarFullFromSend =
      typeof sendRaw._aadhaar_full === "string" ? sendRaw._aadhaar_full : null
    // Hoisted so the JSON response below can surface them without
    // re-querying — populated only when aadhaarHash + name are present.
    let persistedPhotoUrl: string | null = null
    // Wider type: this slot now holds either a strict gradeNameMatch
    // result (with diagnostics) or a cross-doc result (no diagnostics);
    // downstream code only reads `grade` and `score`, both shared.
    let nameMatch:
      | ReturnType<typeof gradeNameMatch>
      | ReturnType<typeof gradeNameMatchCrossDoc>
      | null = null
    // Fail-closed: if the name-match block doesn't run (missing
    // aadhaar_hash from otp-send, or Cashfree didn't echo `name`),
    // we treat the verification as NOT passing — a successful OTP
    // alone is not enough. Earlier this defaulted to `true` which
    // meant a stripped Cashfree response could implicitly auto-pass.
    let namesAlign = false
    // Hoisted out of the inner block so the post-validation audit
    // row + admin-review fan-out can read them.
    //   adminReviewAtPass:    score >= 0.80 but only via loose logic
    //                          (initial expansion / asymmetric subset)
    //   adminReviewAtMismatch: score in 0.60–0.80 manual-review band
    //   adminReviewNoPan:     OTP confirmed but PAN not yet on file —
    //                          can't cross-doc match, admin must
    //                          review when PAN eventually arrives
    //   needsAdminReview:      any of the above
    let adminReviewAtPass = false
    let adminReviewAtMismatch = false
    let adminReviewNoPan = false
    let needsAdminReview = false
    if (aadhaarHash && result.name) {
      // Uniqueness pre-check — refuse if another customer has already
      // verified this Aadhaar. One human, one Aadhaar; the
      // customer_aadhaar_hash_unique DB partial-unique index is the
      // backstop and would surface as a 500 from the metadata write,
      // so we surface it here with a clearer message.
      const aadhaarConflictId = await findConflictingAadhaarHashCustomer(
        req.scope,
        aadhaarHash,
        customerId,
      )
      if (aadhaarConflictId) {
        return respondErr(
          res,
          409,
          "kyc.aadhaar.already_registered",
          "This Aadhaar is already registered to another Polemarch account. If that's also you, sign in with the other account — one Aadhaar can only back one account.",
        )
      }

      // Father's / care-of name from Cashfree. UIDAI XML uses
      // `care_of`; Cashfree converts to `father_name` in their
      // offline-Aadhaar JSON response. Probe both keys defensively.
      const fatherName =
        typeof (result.raw as any).father_name === "string"
          ? ((result.raw as any).father_name as string)
          : typeof (result.raw as any).care_of === "string"
            ? ((result.raw as any).care_of as string)
            : null

      // ── Photo + registry upsert run on EVERY OTP-confirmed verify ─
      //
      // Cashfree calls cost money. The global aadhaar_record cache
      // is keyed by SHA-256 of the Aadhaar number, so a same-customer
      // retry (or a different customer typing the same Aadhaar later)
      // can short-circuit to the local row instead of triggering
      // another paid lookup. Privacy posture relies on storage
      // hardening (encrypted column for `aadhaar_full`, registry
      // never returned to storefront APIs, admin-side reveal-toggle
      // gating) — NOT on selectively skipping the cache write.
      //
      // The customer-side `customer.metadata.aadhaar_hash` link is
      // gated separately on a clean name match (see further down) —
      // a mismatched verify caches the holder's data globally but
      // does NOT attribute it to this customer.

      // Extract + persist the holder photo from Cashfree's response.
      // Best-effort — a missing photo never fails the verify.
      const customerIdShort = customerId.replace(/^cus_/, "")
      persistedPhotoUrl = await extractAndPersistAadhaarPhoto(
        req.scope,
        result.raw,
        customerIdShort,
      )

      try {
        await walletModule.upsertAadhaarRecord({
          aadhaar_hash: aadhaarHash,
          aadhaar_masked:
            result.masked_aadhaar ??
            aadhaarMaskedFromSend ??
            (send.input_masked as string | null) ??
            "XXXX XXXX XXXX",
          aadhaar_full: aadhaarFullFromSend,
          name: result.name,
          date_of_birth: result.dob ?? null,
          gender: result.gender ?? null,
          father_name: fatherName,
          address:
            result.address_raw &&
            typeof result.address_raw === "object" &&
            !Array.isArray(result.address_raw)
              ? (result.address_raw as Record<string, unknown>)
              : null,
          has_photo: Boolean((result.raw as any)?.photo_link)
            ? true
            : Boolean((result.raw as any)?.photo)
              ? true
              : null,
          photo_url: persistedPhotoUrl,
          cashfree_ref_id: ref_id,
          // Full UNREDACTED Cashfree response. aadhaar_record is the
          // global canonical cache (keyed by aadhaar_hash, never
          // customer-bound, retained across customer purges) — same
          // contract as pan_record. The customer-bound, DPDP-grade
          // audit copy lives in secure_id_verification.response_raw
          // (still redacted via redactSecureIdResponse).
          response_raw: result.raw,
        })
      } catch (cacheErr) {
        logger.warn("aadhaar_record upsert failed (non-blocking)", {
          customer_id: customerId,
          error: (cacheErr as Error).message,
        })
      }

      // ── Name-match (server-side, against PAN-verified name) ────────
      //
      // Compares the Aadhaar holder's name against
      // `customer.metadata.pan_registered_name` (NOT the user-editable
      // first/last name). The PAN-verified name is the authoritative
      // identity anchor (Cashfree confirmed it against the ITD record).
      const customerModule = req.scope.resolve(Modules.CUSTOMER) as any
      const custForName = await customerModule
        .retrieveCustomer(customerId)
        .catch(() => null)
      const meta = (custForName?.metadata ?? {}) as Record<string, unknown>
      let panRegisteredName: string | null =
        typeof meta.pan_registered_name === "string" &&
        (meta.pan_registered_name as string).trim().length > 0
          ? (meta.pan_registered_name as string).trim()
          : null
      const panHashMeta =
        typeof meta.pan_hash === "string" && (meta.pan_hash as string).length > 0
          ? (meta.pan_hash as string)
          : null
      // Defence-in-depth fallback: if the customer.metadata pointer
      // drifted but the hash survived, look up the global pan_record
      // table directly. Same fallback chain as the bank-add flow.
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
          // Non-fatal — the require-PAN gate just below will 412.
        }
      }
      // No-PAN path (relaxed 2026-05-07): the customer can attempt
      // Aadhaar verify even before PAN is on file. We can't auto-pass
      // (the cross-doc name match has no anchor without PAN), but we
      // CAN still:
      //   - Confirm OTP with UIDAI (already done above) — proves the
      //     customer holds the Aadhaar phone.
      //   - Persist aadhaar_record for the cache (already done above).
      //   - Open a manual_kyc_request so admin can review when PAN
      //     eventually lands, or reach out for additional documents.
      // The customer-side `aadhaar_hash` is NOT linked here — that
      // requires admin approval since we have no machine-checkable
      // identity anchor. Same posture as the cached-but-no-PAN path
      // in otp-send.
      const aadhaarName = (result.name ?? "").trim()
      // Cross-doc match: UIDAI's Aadhaar holder name vs ITD's
      // PAN-registered name. Both authoritative; commonly asymmetric
      // because Aadhaar permits abbreviated middle names ("Manoj M")
      // where PAN keeps them spelled out ("Manoj Mithajal Bhat").
      // gradeNameMatchCrossDoc uses min-denominator (when both sides
      // have ≥2 tokens) so a clean abbreviated subset scores 1.0
      // instead of being penalised for the asymmetry.
      //
      // When panRegisteredName is null (PAN not yet verified), nameMatch
      // stays null and we drop into the admin-review path below.
      nameMatch =
        aadhaarName && panRegisteredName
          ? gradeNameMatchCrossDoc(aadhaarName, panRegisteredName)
          : null

      // Score-gated verdict. Both Cashfree-grade and our local grade
      // are score-band aware now (see secure-id.ts:gradeNameMatch);
      // we gate on score directly so the threshold matches across
      // PAN, Aadhaar, and bank flows.
      const aadhaarScore = nameMatch?.score ?? null
      const namesClearAutoPass =
        aadhaarScore != null && aadhaarScore >= AADHAAR_AUTO_PASS_SCORE
      const namesClearReviewFloor =
        aadhaarScore != null && aadhaarScore >= AADHAAR_MANUAL_REVIEW_FLOOR
      // Loose-match detection — if the cross-doc score cleared the
      // auto-pass bar via initial-to-full expansion or via the
      // min-denominator (asymmetric Aadhaar-shorter-than-PAN) path,
      // route through admin review instead of auto-pass. The match
      // may be legitimate (Aadhaar abbreviates middle names where
      // PAN spells them out) but we want a human in the loop before
      // linking the Aadhaar hash to this customer.
      //
      // gradeNameMatchCrossDoc returns both flags; gradeNameMatch
      // (the strict variant, also assignable to nameMatch) only
      // exposes initial_match_used. Read both via optional chaining.
      const looseDiag =
        nameMatch && "diagnostics" in nameMatch ? nameMatch.diagnostics : null
      const aadhaarLooseMatch = Boolean(
        looseDiag &&
          ((looseDiag as { initial_match_used?: boolean }).initial_match_used ||
            (looseDiag as { loose_denom_used?: boolean }).loose_denom_used),
      )
      // Three admin-review triggers for Aadhaar OTP verify:
      //   A. Score cleared 0.80 via loose logic (initial expansion
      //      OR cross-doc min-denom for asymmetric names)
      //   B. Score in the manual-review band (≥0.60) — meaningful
      //      overlap, but not enough to auto-pass even with loose
      //      matching. Force admin review instead of returning a
      //      "name mismatch, retry" the customer can't actually
      //      fix (UIDAI's Aadhaar holder name is fixed).
      //   C. PAN isn't on file yet — OTP confirmed Aadhaar but we
      //      have no identity anchor to cross-doc against. Admin
      //      reviews when the customer eventually verifies PAN, or
      //      reaches out for additional documents. The aadhaar_record
      //      cache write happens regardless (above), so the data
      //      benefits future customers either way.
      adminReviewAtPass = namesClearAutoPass && aadhaarLooseMatch
      adminReviewAtMismatch = !namesClearAutoPass && namesClearReviewFloor
      adminReviewNoPan = !panRegisteredName
      needsAdminReview =
        adminReviewAtPass || adminReviewAtMismatch || adminReviewNoPan
      namesAlign = namesClearAutoPass && !adminReviewAtPass && !adminReviewNoPan

      // Customer-side metadata write. Only link `aadhaar_hash` +
      // `aadhaar_full_number` on a clean auto-pass (≥0.85). On
      // 0.60–0.85 (manual-review band) we persist diagnostic fields
      // (grade / score / matched name) so ops can review without
      // attributing the Aadhaar to this customer. <0.60: no
      // metadata write at all.
      if (namesClearAutoPass || namesClearReviewFloor) {
        try {
          const baseMeta: Record<string, unknown> = {
            ...meta,
            aadhaar_photo_url:
              persistedPhotoUrl ?? meta.aadhaar_photo_url ?? null,
            aadhaar_name: result.name ?? null,
            aadhaar_dob: result.dob ?? null,
            aadhaar_gender: result.gender ?? null,
            aadhaar_father_name: fatherName,
            aadhaar_name_match_grade: nameMatch?.grade ?? null,
            aadhaar_name_match_score: nameMatch?.score ?? null,
            aadhaar_verified: namesClearAutoPass,
            aadhaar_verified_at: new Date().toISOString(),
          }
          if (namesClearAutoPass) {
            // Per operator decision (2026-04-28): persist the full
            // 12-digit Aadhaar plaintext alongside the hash. Only
            // exposed to admin via Reveal toggle in the registry —
            // never returned in storefront API responses.
            baseMeta.aadhaar_hash = aadhaarHash
            baseMeta.aadhaar_full_number = aadhaarFullFromSend ?? null
          }
          await customerModule.updateCustomers(customerId, { metadata: baseMeta })
        } catch {
          /* non-fatal */
        }
      }
    }

    // ── Persist the combined verdict on secure_id_verification ─────
    //
    // `getKycStatus` derives `aadhaar_verified` from this row's status.
    // Setting `success` requires BOTH Cashfree OTP confirmation AND
    // a clean PAN-name match (≥0.85). The 0.60–0.85 manual-review
    // band stores `failed` in this audit row but persists the photo /
    // grade / score on customer.metadata so ops can review and
    // promote manually if appropriate.
    const combinedSuccess = !!result.ok && namesAlign
    // Three states for the audit row:
    //   - success  → clean Cashfree OTP + clean PAN-name match
    //   - pending  → clean Cashfree OTP + name match needed loose
    //                logic (initial expansion / cross-doc min-denom)
    //                → admin review required
    //   - failed   → Cashfree OTP failed OR name match below threshold
    const auditStatus = combinedSuccess
      ? "success"
      : !!result.ok && needsAdminReview
        ? "pending"
        : "failed"
    await walletModule.createSecureIdVerifications({
      customer_id: customerId,
      kind: "aadhaar_otp_verify",
      reference_id: ref_id,
      status: auditStatus,
      input_masked: result.masked_aadhaar ?? send.input_masked ?? null,
      response_raw: redactSecureIdResponse(result.raw),
      expires_at: null,
      attempt_no: 1,
    })

    // Auto-flag for admin review when the cross-doc match cleared
    // the bar via loose logic (initial expansion or min-denominator
    // for asymmetric Aadhaar names). Idempotent w.r.t. existing
    // pending requests for this customer.
    if (needsAdminReview) {
      // Build a note that distinguishes the three triggers so admin
      // can act with the right context.
      const triggerNote = adminReviewNoPan
        ? "[Auto-flagged] Aadhaar OTP confirmed by UIDAI, but the customer's PAN isn't on file yet — no anchor for the cross-doc name match. Wait for PAN verification or reach out for additional documents before approving."
        : adminReviewAtPass
          ? "[Auto-flagged] Aadhaar↔PAN name match used loose scoring (initial expansion / cross-doc abbreviated subset). Confirm the Aadhaar holder name matches the customer's PAN-registered identity before approving."
          : "[Auto-flagged] Aadhaar↔PAN cross-doc name mismatch (manual-review band). Score=" +
            (nameMatch?.score?.toFixed(2) ?? "n/a") +
            ", grade=" +
            (nameMatch?.grade ?? "n/a") +
            ". Confirm against the customer's uploaded Aadhaar/PAN documents before approving."
      try {
        const [existingReq] = await walletModule.listManualKycRequests(
          { customer_id: customerId, status: "pending" },
          { take: 1 },
        )
        if (!existingReq) {
          await walletModule.createManualKycRequests({
            customer_id: customerId,
            customer_note: triggerNote,
            status: "pending",
          })
        }
        await sendEventEmail(req.scope, "admin.new_manual_kyc_request", {
          customer_id: customerId,
          customer_note: triggerNote,
          admin_review_url: `${process.env.MEDUSA_ADMIN_URL || ""}/app/manual-kyc`,
        })
      } catch (e) {
        logger.warn("auto-flag manual KYC request failed (non-blocking)", {
          customer_id: customerId,
          error: (e as Error).message,
        })
      }
    }

    // Side effects only run on a clean auto-pass. The 0.60–0.85
    // manual-review band stops here — the customer sees a "name
    // mismatch, ops will reach out" response, and ops can promote
    // via the admin override path if appropriate. <0.60 also drops
    // through to the same response shape without fan-out.
    let gamification:
      | Awaited<ReturnType<typeof grantPointsForEvent>>
      | null = null

    if (combinedSuccess) {
      // Fire the per-step kyc.aadhaar_approved email. Best-effort.
      try {
        await sendEventEmail(req.scope, "kyc.aadhaar_approved", {
          customer_id: customerId,
          masked_aadhaar: result.masked_aadhaar ?? null,
          name: result.name ?? null,
        })
      } catch (emailErr) {
        logger.warn("aadhaar verify email failed (non-blocking)", {
          customer_id: customerId,
          error: (emailErr as Error).message,
        })
      }

      // Onboarding milestone fan-outs.
      await fireFullyApprovedIfReady(req.scope, customerId)
      await fireInvestingReadyIfReady(req.scope, customerId)

      // Auto-close stale pending manual_kyc_request from earlier
      // failed attempts — Aadhaar just verified cleanly so the
      // queued review is moot. Same pattern as PAN verify.
      try {
        const [stale] = await walletModule.listManualKycRequests(
          { customer_id: customerId, status: "pending" },
          { take: 1 },
        )
        if (stale) {
          await walletModule.updateManualKycRequests({
            selector: { id: stale.id },
            data: {
              status: "cancelled",
              reviewer_notes:
                "Auto-cancelled: customer's subsequent Aadhaar OTP verify auto-passed cleanly.",
              reviewed_at: new Date(),
            },
          })
        }
      } catch (e) {
        logger.warn("auto-close stale manual KYC request failed (non-blocking)", {
          customer_id: customerId,
          error: (e as Error).message,
        })
      }

      gamification = await grantPointsForEvent({
        scope: req.scope,
        customer_id: customerId,
        event_kind: "kyc.aadhaar_approved",
        amount: 100,
        source: "KYC_STEP",
        reference_type: "kyc.aadhaar",
        reference_id: customerId,
        idempotency_key: `KYC_STEP:aadhaar:${customerId}`,
        note: "Aadhaar verified",
      })
    }

    // DPDP data-minimisation: do NOT return `dob`, `gender`, or
    // `address_raw` to the client. The photo URL IS returned (for the
    // storefront avatar fallback). The verdict block surfaces the
    // grade so the UI can render a sensible message on the
    // mismatch / review-pending paths.
    const verdict = combinedSuccess
      ? null
      : {
          status: namesAlign
            ? ("name_mismatch" as const)
            : nameMatch && nameMatch.score >= AADHAAR_MANUAL_REVIEW_FLOOR
              ? ("name_mismatch" as const)
              : ("failed" as const),
          name_match_score: nameMatch?.score ?? null,
          name_match_grade: nameMatch?.grade ?? null,
          message:
            nameMatch && nameMatch.score >= AADHAAR_MANUAL_REVIEW_FLOOR
              ? "Partial match — our team will review and approve. You'll get an email once it's done."
              : "We couldn't auto-verify your Aadhaar. Please upload your Aadhaar card and our team will verify it offline. You'll get an email once it's approved.",
        }

    // NO MATCH band: OTP confirmed by UIDAI, but holder name overlap
    // with PAN-registered name is below the manual-review floor.
    // Storefront should route to the document-upload flow.
    const noMatchBand =
      !combinedSuccess &&
      !needsAdminReview &&
      (!nameMatch || nameMatch.score < AADHAAR_MANUAL_REVIEW_FLOOR)
    return res.json({
      ok: combinedSuccess,
      name: combinedSuccess ? result.name : null,
      masked_aadhaar: result.masked_aadhaar,
      photo_url: combinedSuccess ? persistedPhotoUrl : null,
      name_match_grade: nameMatch?.grade ?? null,
      name_match_score: nameMatch?.score ?? null,
      names_align: namesAlign,
      verdict,
      gamification,
      // Surface the admin-review state to the storefront. The wizard
      // renders a "submitted for admin approval" panel instead of
      // success/failure copy when this is set.
      ...(needsAdminReview
        ? {
            pending_review: true,
            pending_reason: adminReviewNoPan
              ? "aadhaar_no_pan_anchor"
              : adminReviewAtPass
                ? "aadhaar_pan_loose_match"
                : "aadhaar_pan_name_mismatch",
            pending_message:
              "Partial match — our team will review and approve. You'll get an email once it's done.",
          }
        : {}),
      ...(noMatchBand
        ? {
            upload_required: true,
            upload_message:
              "We couldn't auto-verify your Aadhaar. Please upload your Aadhaar card and our team will verify it offline. You'll get an email once it's approved.",
          }
        : {}),
    })
  } catch (err) {
    const isApi = err instanceof CashfreeApiError
    // Pull a human-readable reason out of Cashfree's response body so
    // the customer sees something actionable (eg "Invalid OTP", "OTP
    // expired") instead of a generic "rejected (400)". Cashfree's
    // verification API uses different shapes across endpoints —
    // `message`, `error.message`, `sub_code` — so we probe each.
    const body = isApi ? (err.body as Record<string, unknown> | string | null) : null
    const upstreamMsg =
      body && typeof body === "object"
        ? ((body as any).message as string | undefined) ??
          (((body as any).error as any)?.message as string | undefined) ??
          ((body as any).sub_code as string | undefined) ??
          ((body as any).code as string | undefined)
        : typeof body === "string"
          ? body
          : undefined
    logger.warn("aadhaar otp verify failed", {
      customer_id: customerId,
      status: isApi ? err.status : undefined,
      upstream_message: upstreamMsg,
      upstream_body: body,
    })
    const code = isApi && err.status < 500 ? 400 : 502
    const friendly =
      typeof upstreamMsg === "string" && upstreamMsg.trim().length > 0
        ? upstreamMsg
        : isApi
          ? `OTP verify rejected (${err.status})`
          : "OTP verify service unavailable"
    return res.status(code).json({
      ok: false,
      message: friendly,
    })
  }
}
