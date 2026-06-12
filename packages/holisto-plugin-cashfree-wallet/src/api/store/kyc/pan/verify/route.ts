import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { z } from "zod"
import { Modules } from "@medusajs/framework/utils"
import { createHash } from "node:crypto"
import {
  CASHFREE_WALLET_MODULE,
  CashfreeWalletService,
} from "../../../../../modules/cashfree_wallet"
import {
  CUSTOMER_IDENTITY_MODULE,
  CustomerIdentityService,
} from "../../../../../modules/customer_identity"
import {
  gradeNameMatch,
  redactSecureIdResponse,
} from "../../../../../modules/cashfree_wallet/cashfree/secure-id"
import { maskPan } from "../../../../../modules/cashfree_wallet/cashfree/crypto"
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
import { findConflictingPanHashCustomer } from "../../../../../utils/identity-uniqueness"
import { respondOk, respondErr } from "../../../../../utils/envelope"

/**
 * Split a PAN-registered full name into Medusa-style {first_name,
 * last_name}. First whitespace token → first_name, rest → last_name.
 * Mirrors the helper in the legacy /dashboard/kyc page so behaviour
 * stays identical now that the canonical surface is the get-started
 * wizard (which doesn't run this client-side).
 *
 * The customer's display name (navbar avatar, dashboard greeting,
 * VBA beneficiary derivation, demat KYC prefill) reads from
 * `customer.first_name` + `customer.last_name`. Without this server-
 * side sync the wizard-completed customer keeps whatever name they
 * registered with — which is rarely the canonical PAN-printed form
 * the regulator wants on demat / bank docs.
 */
function splitFullName(full: string): { first_name: string; last_name: string } {
  const parts = full.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return { first_name: "", last_name: "" }
  if (parts.length === 1) return { first_name: parts[0], last_name: "" }
  return { first_name: parts[0], last_name: parts.slice(1).join(" ") }
}

/**
 * SHA-256 hex of the uppercase PAN. Stored on customer.metadata so we
 * can detect "same PAN, different name" retries WITHOUT keeping the
 * full PAN in plaintext (PAN is PII; the hash is sufficient for an
 * equality check). One-way hash, so leaking the metadata blob doesn't
 * expose customers' PAN numbers.
 */
function panFingerprint(pan: string): string {
  return createHash("sha256")
    .update(pan.toUpperCase().trim())
    .digest("hex")
}

/**
 * After a successful PAN verify, sync the PAN-anchored identity
 * registry. This is the integration point for the lifecycle described
 * in `models/customer-identity-registry.ts`:
 *
 *   - First-ever verify of this PAN → creates the registry row,
 *     issues a fresh client_id, attaches it to this customer.
 *   - Re-registration with the same PAN → finds the existing row,
 *     re-attaches the original client_id + (cached) VBA to the new
 *     customer. NO new Cashfree mint, NO new client_id sequence.
 *   - Idempotent re-verify by the same customer → no-op.
 *
 * Side effects:
 *   - Writes/updates `customer_identity_registry`.
 *   - Ensures `customer_client_id` row exists for this customer with
 *     the registry's `client_id`. On the reattach path, the new
 *     customer gets the OLD client_id (the human's permanent handle).
 *
 * Errors are logged but never throw — the PAN verify must succeed
 * even if the registry hop fails (caller's flow continues; the
 * backfill script + subsequent verifies heal the gap).
 */
async function syncIdentityRegistryPostPanVerify(
  scope: any,
  customerId: string,
  panFull: string,
  panMasked: string,
  panHash: string,
): Promise<void> {
  try {
    const identity = scope.resolve(
      CUSTOMER_IDENTITY_MODULE,
    ) as CustomerIdentityService
    const wallet = scope.resolve(
      CASHFREE_WALLET_MODULE,
    ) as CashfreeWalletService

    // Look up first — drives whether we mint a fresh client_id or
    // reuse the registry's existing one.
    const existing = await identity.lookupRegistryByPanHash(panHash)

    if (existing) {
      // Re-attach to whoever's verifying now (idempotent if same
      // customer). Mirror the registry's client_id into this
      // customer's customer_client_id row so all downstream code
      // (VBA provision, admin views) see the consistent identifier.
      await identity.claimForCustomer({
        pan_hash: panHash,
        pan_masked: panMasked,
        pan_full: panFull,
        customer_id: customerId,
        client_id_for_create: existing.client_id, // ignored on reattach but kept for safety
      })

      // Stitch / re-stitch the customer_client_id row.
      //
      // Three cases the route has to handle:
      //   (a) No row yet  → INSERT with the registry's client_id.
      //   (b) Row already aligned  → no-op (re-verify of same PAN).
      //   (c) Row exists with a DIFFERENT client_id  → that means a
      //       lazy-assign (e.g. /store/me/client-id was hit on first
      //       login, before PAN verify ran) minted a fresh client_id
      //       and persisted it. We have to UPDATE the row to the
      //       registry's stored value or the customer's displayed
      //       client_id and the registry/VBA chain will be desynced
      //       forever. Soubarna hit exactly this on 2026-05-10.
      const existingClientIdRow = await identity
        .getByCustomerId(customerId)
        .catch(() => null)
      const desiredSeq = parseInt(existing.client_id.slice(0, 4), 10) || 0
      const desiredIsoYear =
        2000 + (parseInt(existing.client_id.slice(4, 6), 10) || 0)
      const desiredIsoWeek = parseInt(existing.client_id.slice(6, 8), 10) || 1
      if (!existingClientIdRow) {
        try {
          await identity.createCustomerClientIds([
            {
              customer_id: customerId,
              client_id: existing.client_id,
              seq: desiredSeq,
              iso_year: desiredIsoYear,
              iso_week: desiredIsoWeek,
            },
          ])
        } catch (err) {
          logger.warn(
            "[identity-registry] could not stitch client_id row on reattach",
            { customer_id: customerId, error: (err as Error).message },
          )
        }
      } else if (existingClientIdRow.client_id !== existing.client_id) {
        try {
          await identity.updateCustomerClientIds({
            selector: { id: existingClientIdRow.id },
            data: {
              client_id: existing.client_id,
              seq: desiredSeq,
              iso_year: desiredIsoYear,
              iso_week: desiredIsoWeek,
            },
          })
          logger.info(
            "[identity-registry] re-aligned customer_client_id to registry's stored client_id on PAN reattach",
            {
              customer_id: customerId,
              prior_client_id: (existingClientIdRow as any).client_id,
              registry_client_id: existing.client_id,
            },
          )
        } catch (err) {
          logger.warn(
            "[identity-registry] could not re-align client_id row on reattach",
            { customer_id: customerId, error: (err as Error).message },
          )
        }
      }

      // Recreate the cashfree_virtual_account row from the registry's
      // preserved fields. The registry retains the original VBA
      // pointers (cashfree_virtual_account_id, virtual_account_number,
      // ifsc, beneficiary_name, upi_id) across customer erasure, but
      // the customer-bound `cashfree_virtual_account` row was deleted
      // as part of the prior hard-delete. Without this insert,
      // re-registration leaves the customer with no VBA — even though
      // Cashfree's side still credits inbound NEFT to the original
      // VBA. Skips when the registry has no VBA fields yet (i.e. the
      // prior account never minted a VBA, so there's nothing to
      // restore — the bank-verify path will mint normally).
      if (
        existing.cashfree_virtual_account_id &&
        existing.virtual_account_number &&
        existing.ifsc
      ) {
        try {
          const existingVba = (await wallet.listCashfreeVirtualAccounts(
            { customer_id: customerId } as any,
            { take: 1 } as any,
          )) as any[]
          if (!Array.isArray(existingVba) || existingVba.length === 0) {
            await wallet.createCashfreeVirtualAccounts({
              customer_id: customerId,
              virtual_account_id: existing.cashfree_virtual_account_id,
              virtual_account_number: existing.virtual_account_number,
              ifsc: existing.ifsc,
              beneficiary_name: existing.beneficiary_name ?? null,
              upi_id: existing.upi_id ?? null,
              status: "active",
            } as any)
            logger.info(
              "[identity-registry] reattached preserved VBA on PAN re-verify",
              {
                customer_id: customerId,
                virtual_account_id: existing.cashfree_virtual_account_id,
              },
            )
          }
        } catch (err) {
          logger.warn(
            "[identity-registry] could not reattach VBA on PAN reattach",
            { customer_id: customerId, error: (err as Error).message },
          )
        }
      }
      return
    }

    // First-ever verify of this PAN → mint a client_id (this is the
    // post-PAN-verify issuance the registry design calls for) and
    // create the registry row.
    const clientIdRow = await identity.assignClientId(customerId, new Date())
    await identity.claimForCustomer({
      pan_hash: panHash,
      pan_masked: panMasked,
      pan_full: panFull,
      customer_id: customerId,
      client_id_for_create: clientIdRow.client_id,
      // VBA fields stay NULL — bank-verify will fill them in via
      // `attachVbaToRegistry` after Cashfree mints the VBA.
    })
  } catch (err) {
    logger.warn(
      "[identity-registry] sync after PAN verify failed (non-fatal)",
      { customer_id: customerId, error: (err as Error).message },
    )
  }
}

// fireFullyApprovedIfReady + fireInvestingReadyIfReady moved to
// ../../../../../utils/onboarding-events.ts so they can be shared by
// the bank-verify and demat-verify admin routes too.

/**
 * Three-tier name-match policy (PAN). Mirrors the Aadhaar flow and the
 * bank-account flow so every KYC surface uses one bar:
 *
 *   HIGH  ≥ 0.80 (PAN_AUTO_PASS_SCORE)        → automatic verification.
 *   GOOD  0.60–0.80 (PAN_MANUAL_REVIEW_FLOOR) → backend approval.
 *                                               Audit row is `pending`,
 *                                               manual_kyc_request is
 *                                               opened, customer sees
 *                                               "Partial match — team
 *                                               will review".
 *   NO MATCH < 0.60                           → upload documents +
 *                                               offline manual
 *                                               verification. Response
 *                                               carries `upload_required:
 *                                               true` so the storefront
 *                                               can route to the
 *                                               document-upload panel.
 *
 * Earlier code gated on grade alone (`EXACT_MATCH || GOOD_PARTIAL_MATCH`)
 * and the local `gradeNameMatch` returned GOOD_PARTIAL_MATCH on any
 * subset relationship — including 1-of-3 token overlaps. That let
 * weak matches like "AYUSH" vs "AYUSH KUMAR PATEL" (score 0.33)
 * auto-pass. Now we gate on score so a single shared token can no
 * longer slip through.
 *
 * Cashfree's premium PAN endpoint may return a `name_match_result`
 * directly. We honour that grade when present (richer algorithm), but
 * also re-grade locally and require BOTH to clear the threshold — same
 * belt-and-braces approach as bank verification.
 *
 * Lowered 2026-05-07 from 0.85 → 0.80. The initial-to-full match fix
 * in gradeNameMatch (same date) closed the most common false-negative
 * pattern ("M" vs "MITHAJAL"); 0.80 catches the remaining edge cases
 * (4-of-5 token overlap, missing Jr./Sr. suffix, missing middle name).
 * Still well above the 0.60 manual-review floor, so weak 1-or-2-token
 * overlaps still drop into NO MATCH and route to upload.
 */
const PAN_AUTO_PASS_SCORE = 0.8
const PAN_MANUAL_REVIEW_FLOOR = 0.6

/**
 * Strict PAN regex.
 *
 * 10 characters total:
 *   1–3  any 3 letters (issuer prefix)
 *   4    entity type — must be one of P, F, C, H, A, T, B, L, J, G
 *          P = Person (Individual)
 *          F = Firm
 *          C = Company
 *          H = HUF (Hindu Undivided Family)
 *          A = AOP (Association of Persons)
 *          T = Trust
 *          B = BOI (Body of Individuals)
 *          L = Local Authority
 *          J = Artificial Juridical Person
 *          G = Government
 *   5    first letter of holder's surname / entity name (any A–Z)
 *   6–9  4 digits
 *   10   alphabetic check character
 *
 * Stricter than `^[A-Z]{5}\d{4}[A-Z]$` — rejects e.g. "ABCDE1234F" where
 * the 4th char is "D" (not a valid entity type) before we burn a Cashfree
 * call. Reference: ITD PAN format rules.
 */
const PAN_REGEX = /^[A-Z]{3}[ABCFGHJLPT][A-Z][0-9]{4}[A-Z]$/
const PAN_FORMAT_ERROR =
  "Invalid PAN format. A PAN is 10 characters: 5 letters + 4 digits + 1 letter (e.g. ABCDE1234F). The 4th letter must encode the entity type (P=Person, F=Firm, C=Company, H=HUF, A=AOP, T=Trust, B=BOI, L=Local Authority, J=Artificial Juridical Person, G=Government)."

const PanSchema = z.object({
  pan: z
    .string()
    .trim()
    .toUpperCase()
    .regex(PAN_REGEX, PAN_FORMAT_ERROR),
  name: z.string().trim().min(2).max(100),
})

/**
 * POST /store/kyc/pan/verify
 * Body: { pan, name }
 *
 * Rate-limited to 5/day per customer. Persists a SecureIdVerification row
 * (status = success/failed) with the masked PAN + redacted Cashfree
 * response.
 */
export const POST = async (req: MedusaRequest, res: MedusaResponse) => {
  const customerId = (req as any).auth_context?.app_metadata?.customer_id as
    | string
    | undefined
  if (!customerId) return respondErr(res, 401, "auth.unauthenticated", "Not authenticated")

  const parsed = PanSchema.safeParse(req.body)
  if (!parsed.success) {
    // Surface the field-specific message to the storefront so the user
    // sees "Invalid PAN format…" not just "Invalid input". A bad PAN
    // never reaches Cashfree — no API call, no quota burn.
    const flat = parsed.error.flatten()
    const panMsg = flat.fieldErrors?.pan?.[0]
    const nameMsg = flat.fieldErrors?.name?.[0]
    return respondErr(
      res,
      400,
      panMsg ? "kyc.pan.format_invalid" : "kyc.pan.input_invalid",
      panMsg ?? nameMsg ?? "Invalid input",
      { errors: flat },
    )
  }
  const { pan, name } = parsed.data

  const walletModule = req.scope.resolve(
    CASHFREE_WALLET_MODULE
  ) as CashfreeWalletService

  // Admin-controlled per-kind switch. If PAN verification is off (either
  // master switch or the per-kind flag), refuse before we touch Cashfree.
  const gate = await walletModule.isSecureIdKindEnabled("pan")
  if (!gate.enabled) {
    return respondErr(
      res,
      403,
      "kyc.pan.disabled",
      "PAN verification is currently unavailable. Please request a manual review.",
      gate.reason ? { reason: gate.reason } : undefined,
    )
  }

  // Idempotency: if this customer already has a successful PAN verify
  // on record, refuse to burn another Cashfree call. Prevents accidental
  // re-verification and keeps the daily rate-limit budget intact.
  const existing = await walletModule.listSecureIdVerifications({
    customer_id: customerId,
    kind: "pan",
  })
  if (existing.some((v) => v.status === "success")) {
    return respondErr(
      res,
      409,
      "kyc.pan.already_verified",
      "PAN is already verified for this account.",
    )
  }

  // ── Global PAN cache lookup (`pan_record` table) ────────────────
  //
  // Source of truth is now the global pan_record table — keyed by
  // SHA-256(pan), one row per unique PAN regardless of which
  // customer triggered the original verify. Survives customer
  // deletion, shared across signups (a returning customer who
  // re-verifies the same PAN re-uses the data they paid for the
  // first time).
  //
  // The route hashes the submitted PAN, looks up the table, and:
  //   - cache HIT → local name match against the cached registered
  //     name; no Cashfree call.
  //   - cache MISS → fresh Cashfree call, then upsert the record.
  //
  // We also write `customer.metadata.pan_hash` so we can render the
  // customer's PAN data in admin without an extra join — read by
  // GET /admin/customers/[id]/pan-record.
  const submittedHash = panFingerprint(pan)

  // Uniqueness pre-check — refuse if another customer has already
  // verified this PAN. One human, one PAN; two accounts claiming the
  // same number is either a fraud signal or a duplicate-account
  // mistake. The DB partial-unique index `customer_pan_hash_unique`
  // is the backstop; we surface the friendly error here.
  const panConflictId = await findConflictingPanHashCustomer(
    req.scope,
    submittedHash,
    customerId,
  )
  if (panConflictId) {
    return respondErr(
      res,
      409,
      "kyc.pan.already_registered",
      "This PAN is already registered to another Polemarch account. If that's also you, sign in with the other email — one PAN can only back one account.",
    )
  }

  const customerModule = req.scope.resolve(Modules.CUSTOMER) as any
  const customerRow = await customerModule
    .retrieveCustomer(customerId)
    .catch(() => null)
  const meta = (customerRow?.metadata ?? {}) as Record<string, unknown>

  const cached = await walletModule.lookupPanRecordByHash(submittedHash)
  if (cached) {
    // Same PAN — local name match only, no Cashfree call. Score-gated:
    // ≥0.80 clears the bar; 0.60–0.80 falls through to manual review;
    // <0.60 rejects. When the score clears the bar via INITIAL
    // expansion (e.g. user typed "M" and the registered name has
    // "MITHAJAL"), we route the customer through admin review
    // instead of auto-pass — the match may be legitimate but it's
    // weaker than an exact-token match, and we want a human in the
    // loop before linking the PAN to this customer's identity.
    //
    // Score against BOTH `registered_name` (the ITD-canonical form)
    // AND `name_pan_card` (the form printed on the physical card)
    // and take whichever is higher. The two often differ — the card
    // commonly omits a middle name that the ITD keeps. A customer
    // typing the name they see on their own card ("MANOJ BHAT") is
    // legitimate identity evidence even when the registered name
    // ("MANOJ MITHAJAL BHAT") only scores 2/3 = 0.67. Without this
    // fast-path those legitimate matches drop into manual review
    // and clog the queue. Security floor is unchanged — the
    // attacker still needs the PAN AND a high-confidence name
    // against one of the two recorded forms.
    const gradedRegistered = gradeNameMatch(name, cached.registered_name)
    const gradedCard = cached.name_pan_card
      ? gradeNameMatch(name, cached.name_pan_card)
      : null
    const graded =
      gradedCard && gradedCard.score > gradedRegistered.score
        ? gradedCard
        : gradedRegistered
    const nameMatchOk = graded.score >= PAN_AUTO_PASS_SCORE
    // Three admin-review trigger flavours for cached-match:
    //   A. Pass cleared via initial expansion (loose auto-pass)
    //   B. Mismatch but score has meaningful overlap (≥0.3) —
    //      indicates this IS the customer's PAN, just an alias /
    //      abbreviation we can't auto-resolve. Force admin review
    //      rather than make the customer retry forever.
    // (No-overlap mismatches still flow to the regular
    //  pan_valid:true / name_match_ok:false response so the customer
    //  can retry with a corrected name.)
    const adminReviewAtPass =
      nameMatchOk && graded.diagnostics.initial_match_used
    const adminReviewAtMismatch = !nameMatchOk && graded.score >= 0.3
    const needsAdminReview = adminReviewAtPass || adminReviewAtMismatch

    // Audit row: success only on a clean (non-loose) match;
    // pending on either admin-review trigger; failed otherwise.
    const auditReason = adminReviewAtPass
      ? "initial_expansion_match"
      : adminReviewAtMismatch
        ? "name_mismatch_admin_review"
        : null
    await walletModule.createSecureIdVerifications({
      customer_id: customerId,
      kind: "pan",
      reference_id: null,
      status: needsAdminReview ? "pending" : nameMatchOk ? "success" : "failed",
      input_masked: maskPan(pan),
      response_raw: {
        cached_match: true,
        // Both pan_record_id AND pan_hash are recorded so the admin
        // detail endpoint has two independent fallbacks for resolving
        // the registry hit (id-lookup OR hash-lookup). pan_hash is
        // also what the fresh path stores, so consumers can read one
        // canonical field across both branches.
        pan_record_id: cached.id,
        pan_hash: submittedHash,
        registered_name: cached.registered_name,
        name_match_score: graded.score,
        name_match_result: graded.grade,
        submitted_name: name,
        ...(needsAdminReview ? { needs_admin_review: true, reason: auditReason } : {}),
      },
      expires_at: null,
      attempt_no: 1,
    })

    if (needsAdminReview) {
      // Auto-flag for admin review — open a manual_kyc_request row
      // tagged with the system-generated reason so the admin queue
      // distinguishes these from customer-initiated requests.
      // Idempotent: if a pending request already exists for this
      // customer (e.g. same flow repeated), we re-use it.
      try {
        const [existingReq] = await walletModule.listManualKycRequests(
          { customer_id: customerId, status: "pending" },
          { take: 1 },
        )
        if (!existingReq) {
          await walletModule.createManualKycRequests({
            customer_id: customerId,
            customer_note:
              "[Auto-flagged] PAN match used initial-to-full expansion (e.g. typed initial M matched a full middle name). Verify the customer's typed name against the PAN registry before approving.",
            status: "pending",
          })
        }
        await sendEventEmail(req.scope, "admin.new_manual_kyc_request", {
          customer_id: customerId,
          customer_note:
            "[Auto-flagged] PAN match used initial-to-full expansion. Score=" +
            graded.score.toFixed(2) +
            ", grade=" +
            graded.grade,
          admin_review_url: `${process.env.MEDUSA_ADMIN_URL || ""}/app/manual-kyc`,
        })
      } catch (e) {
        logger.warn("auto-flag manual KYC request failed (non-blocking)", {
          customer_id: customerId,
          error: (e as Error).message,
        })
      }
      return respondOk(res, {
        verified: false,
        pan_valid: true,
        name_match_ok: true,
        status: "VALID",
        cached: true,
        pending_review: true,
        pending_reason: "initial_expansion_match",
        // Customer-facing copy — single canonical message for every
        // partial-match path (cache hit, live verify, name mismatch).
        // Privacy: we don't echo the registered name back.
        message:
          "Partial match — our team will review and approve. You'll get an email once it's done.",
      })
    }

    if (nameMatchOk) {
      // Backfill `pan_full` on the cached pan_record if it was
      // created before plaintext-PAN storage was added. Forward-only
      // — once any customer re-verifies (or this is the first verify
      // for this PAN under the new schema), the column gets
      // populated. Cashfree PG-VBA `kyc_details.pan` reads from
      // here, so backfilling lets pre-existing-cached customers
      // start carrying PAN on Cashfree's VBA dashboard from now on.
      if (!cached.pan_full) {
        try {
          await walletModule.updatePanRecords({
            selector: { id: cached.id },
            data: { pan_full: pan },
          })
        } catch {
          /* non-fatal — the verify itself succeeded */
        }
      }

      // Only link customer.metadata.pan_hash on a SUCCESSFUL match.
      // On a name-mismatch we deliberately do NOT link — the PAN may
      // belong to a different person, and storing a hash that isn't
      // theirs would make Customer-360 wrongly attribute that PAN to
      // this customer. Admins can still trace via secure_id_verification
      // (which records every attempt with the customer_id who tried it).
      try {
        const { first_name, last_name } = splitFullName(cached.registered_name)
        await customerModule.updateCustomers(customerId, {
          // Sync the account display name to the PAN-registered form.
          // first/last_name + metadata.full_name are read by the
          // navbar, dashboard greeting, VBA beneficiary derivation,
          // and demat KYC prefill — all of which want the regulator-
          // canonical name, not whatever the customer typed at signup.
          first_name,
          last_name,
          metadata: {
            ...(meta as Record<string, unknown>),
            full_name: cached.registered_name,
            pan_hash: submittedHash,
            pan_registered_name: cached.registered_name,
          },
        })
      } catch {
        /* non-fatal */
      }
      // Cached-match path: PAN was already verified in the global
      // pan_record cache. Sync the identity registry so a re-
      // registration of the same PAN reuses the original client_id +
      // VBA instead of minting fresh ones.
      await syncIdentityRegistryPostPanVerify(
        req.scope,
        customerId,
        pan,
        maskPan(pan),
        submittedHash,
      )
      try {
        await sendEventEmail(req.scope, "kyc.pan_approved", {
          customer_id: customerId,
          pan_masked: maskPan(pan),
          name_on_pan: cached.registered_name,
        })
      } catch (emailErr) {
        logger.warn("pan verify (cached) email failed", {
          customer_id: customerId,
          error: (emailErr as Error).message,
        })
      }
      // Fan-out the celebratory "fully approved" event ONLY when both
      // PAN + Aadhaar are now verified (see fireFullyApprovedIfReady).
      await fireFullyApprovedIfReady(req.scope, customerId)
      await fireInvestingReadyIfReady(req.scope, customerId)

      // Auto-close any stale pending manual_kyc_request — the
      // customer just verified themselves cleanly, so the human
      // review is no longer needed. Marked `cancelled` (not
      // `approved`) so we don't trigger the manual-approval email
      // chain; reviewer_notes capture the system reason.
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
                "Auto-cancelled: customer's subsequent PAN verify auto-passed cleanly.",
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

      const gamification = await grantPointsForEvent({
        scope: req.scope,
        customer_id: customerId,
        event_kind: "kyc.pan_approved",
        amount: 100,
        source: "KYC_STEP",
        reference_type: "kyc.pan",
        reference_id: customerId,
        idempotency_key: `KYC_STEP:pan:${customerId}`,
        note: "PAN verified (cached match)",
      })
      return respondOk(res, {
        verified: true,
        pan_valid: true,
        name_match_ok: true,
        status: "VALID",
        name_on_pan: cached.registered_name,
        name_match: graded.grade,
        submitted_name: name,
        cached: true,
        gamification,
      })
    }

    // Name doesn't match — same PAN, different name typed. We
    // deliberately do NOT return `name_on_pan` to the customer: the
    // PAN may belong to someone else, and echoing the real holder's
    // name would be a privacy leak. Storefront just shows a generic
    // "doesn't match — check your name and PAN, try again" message.
    //
    // We DO surface a `mismatch_hint` derived purely from the
    // submitted name + an opaque shape-comparison with the
    // registered name (token count, presence of initials). This
    // doesn't leak the registered name itself but tells the user
    // when their input is plausibly an abbreviated form ("M" vs
    // "MITHAJAL") so they can retry with the full middle/last name.
    //
    // This is HTTP-200: the call succeeded; the verification result
    // (`verified: false`) is the business-level outcome inside `data`.
    // Hint generation — ranked rules. Only meaningful when there's
    // at least SOME token overlap (score ≥ 0.3); a NO_MATCH means
    // the customer typed a name unrelated to the PAN (probably wrong
    // PAN), so suggesting "add a middle name" would be misleading.
    const someOverlap = graded.score >= 0.3
    const mismatchHint =
      someOverlap && graded.diagnostics.initial_match_used
        ? "initials_in_submitted"
        : someOverlap && graded.diagnostics.submitted_shorter
          ? "submitted_too_short"
          : "no_obvious_pattern"

    // Force admin review when there's MEANINGFUL overlap (≥0.3) but
    // the score didn't clear the auto-pass bar. The PAN itself is in
    // our registry (cache hit), so this is almost always a legitimate
    // alias / abbreviation that the algorithm couldn't auto-resolve
    // — exactly the case where a human should look at the customer's
    // uploaded PAN card photo and decide. Below 0.3 we still let the
    // customer retry without escalating (likely wrong PAN entirely
    // — admin would just reject). Idempotent on existing pending
    // requests for this customer (audit row already written above
    // with status=pending; this block just fans out the
    // manual_kyc_request + admin email).
    if (adminReviewAtMismatch) {
      try {
        const [existingReq] = await walletModule.listManualKycRequests(
          { customer_id: customerId, status: "pending" },
          { take: 1 },
        )
        if (!existingReq) {
          await walletModule.createManualKycRequests({
            customer_id: customerId,
            customer_note:
              "[Auto-flagged] PAN found in registry but typed name didn't match (score=" +
              graded.score.toFixed(2) +
              ", grade=" +
              graded.grade +
              '). Customer typed: "' +
              name +
              '". Verify against the customer\'s uploaded PAN card photo and approve OR reject with a reason.',
            status: "pending",
          })
        }
        await sendEventEmail(req.scope, "admin.new_manual_kyc_request", {
          customer_id: customerId,
          customer_note:
            "[Auto-flagged] PAN name mismatch (cache hit). Score=" +
            graded.score.toFixed(2) +
            ", grade=" +
            graded.grade,
          admin_review_url: `${process.env.MEDUSA_ADMIN_URL || ""}/app/manual-kyc`,
        })
      } catch (e) {
        logger.warn("auto-flag manual KYC request (mismatch) failed (non-blocking)", {
          customer_id: customerId,
          error: (e as Error).message,
        })
      }
      return respondOk(res, {
        verified: false,
        pan_valid: true,
        name_match_ok: false,
        status: "VALID",
        submitted_name: name,
        cached: true,
        mismatch_hint: mismatchHint,
        pending_review: true,
        pending_reason: "name_mismatch_admin_review",
        message:
          "Partial match — our team will review and approve. You'll get an email once it's done.",
      })
    }

    // NO MATCH band — name overlap below admin-review floor. Tell the
    // storefront to route the customer through the document-upload
    // path: their PAN exists, but the typed name has so little overlap
    // we can't responsibly queue an admin review off it. The upload
    // flow takes a PAN-card photo + creates a manual_kyc_request that
    // ops verifies offline against the registry.
    return respondOk(res, {
      verified: false,
      pan_valid: true,
      name_match_ok: false,
      status: "VALID",
      submitted_name: name,
      cached: true,
      mismatch_hint: mismatchHint,
      upload_required: true,
      message:
        "We couldn't auto-verify your PAN. Please upload your PAN card and our team will verify it offline. You'll get an email once it's approved.",
    })
  }

  // Cache miss (different PAN or no prior verify) → real Cashfree call.
  // Rate-limit applies to fresh calls only — retries that hit the
  // local cache cost us nothing on the Cashfree side, so they don't
  // count against the daily quota.
  const rl = hitRateLimit(
    `pan:${customerId}`,
    SECURE_ID_LIMITS.pan.limit,
    SECURE_ID_LIMITS.pan.windowMs
  )
  if (!rl.allowed) {
    return respondErr(
      res,
      429,
      "kyc.pan.rate_limit",
      "Too many PAN verification attempts today. Try again later.",
      { reset_at: rl.reset_at },
    )
  }

  try {
    const secureId = await walletModule.getSecureId()
    const result = await secureId.verifyPan({ pan, name })

    // Cashfree's `ok` only checks PAN format/validity. We additionally
    // require the holder name on PAN to match the typed name above
    // PAN_AUTO_PASS_SCORE (0.85) — otherwise the customer could pass
    // KYC with someone else's PAN by typing a single shared token.
    //
    // Two signals, both must clear:
    //   A. Cashfree's `name_match_score` (when the premium endpoint
    //      returns one) — already 0–1 from `verifyPan`.
    //   B. Our `gradeNameMatch(name, registered_name)` score —
    //      defence-in-depth in case Cashfree drifts.
    const cashfreeScore =
      typeof result.name_match_score === "number"
        ? result.name_match_score > 1
          ? result.name_match_score / 100
          : result.name_match_score
        : null
    // Local cross-check: grade against BOTH `registered_name` (returned
    // as `name_on_pan` from the wrapper) AND `name_pan_card` (the
    // printed form, also returned by Cashfree on premium endpoints).
    // Take whichever scores higher. Rationale: the card commonly omits
    // middle names the ITD keeps, so a legitimate "card-name-only"
    // typing scores 0.67 against registered but 1.0 against the card.
    // Mirrors the cached-match branch above.
    const localGradedRegistered = result.name_on_pan
      ? gradeNameMatch(name, result.name_on_pan)
      : null
    const localGradedCard = result.name_pan_card
      ? gradeNameMatch(name, result.name_pan_card)
      : null
    const localGraded =
      localGradedRegistered && localGradedCard
        ? localGradedCard.score > localGradedRegistered.score
          ? localGradedCard
          : localGradedRegistered
        : (localGradedRegistered ?? localGradedCard)
    const localScore = localGraded?.score ?? null

    // Auto-pass requires both signals (when present) to clear the
    // threshold. A missing signal doesn't block — we trust whichever
    // IS available rather than rejecting on absence.
    const cashfreePass =
      cashfreeScore == null || cashfreeScore >= PAN_AUTO_PASS_SCORE
    const localPass =
      localScore == null || localScore >= PAN_AUTO_PASS_SCORE
    const nameMatchOk = cashfreePass && localPass

    // Same admin-review pivot as the cached-match branch:
    //   A. Pass cleared via initial expansion → loose auto-pass → review
    //   B. Mismatch but localScore >= 0.3 (some token overlap) → review
    const localUsedInitial =
      localGraded?.diagnostics.initial_match_used === true
    const adminReviewAtPassFresh =
      result.ok && nameMatchOk && localUsedInitial
    const adminReviewAtMismatchFresh =
      result.ok && !nameMatchOk && (localScore ?? 0) >= 0.3
    const needsAdminReviewFresh =
      adminReviewAtPassFresh || adminReviewAtMismatchFresh
    const verified = result.ok && nameMatchOk && !adminReviewAtPassFresh

    // Compute the diagnostic enrichments BEFORE the audit row write so
    // the response_raw payload includes the locally-derived fields the
    // admin manual-kyc review panel reads (submitted_name,
    // cached_match, name_match_score, name_match_result, mismatch_hint,
    // needs_admin_review). Mirrors the cached-match branch's
    // response_raw shape — historic fresh-path rows only persisted
    // Cashfree's redacted raw response, so the admin panel's
    // "Submitted name" cell rendered "—" for every cache-miss attempt.
    const someOverlapForHint = (localGraded?.score ?? 0) >= 0.3
    const mismatchHintForAudit:
      | "initials_in_submitted"
      | "submitted_too_short"
      | "no_obvious_pattern"
      | null =
      !verified && result.ok && localGraded
        ? someOverlapForHint &&
          localGraded.diagnostics.initial_match_used
          ? "initials_in_submitted"
          : someOverlapForHint &&
              localGraded.diagnostics.submitted_shorter
            ? "submitted_too_short"
            : "no_obvious_pattern"
        : null

    await walletModule.createSecureIdVerifications({
      customer_id: customerId,
      kind: "pan",
      reference_id: (result.raw as any).reference_id?.toString() ?? null,
      status: needsAdminReviewFresh
        ? "pending"
        : verified
          ? "success"
          : "failed",
      input_masked: maskPan(pan),
      response_raw: {
        ...redactSecureIdResponse(result.raw),
        submitted_name: name,
        cached_match: false,
        // SHA-256(pan) — same fingerprint used to key the global
        // `pan_record` table. Persisted in the audit row so the admin
        // detail endpoint can resolve the registry hit even when the
        // customer-side `metadata.pan_hash` link is unset (partial-
        // match band, score 0.60–0.80, no pointer written) AND when
        // the cached-match path's `pan_record_id` shortcut wasn't
        // taken (this IS the fresh path, by definition). Without
        // this, the registry section on /app/manual-kyc rendered
        // "Not in registry" for every fresh-path partial-match
        // attempt even though pan_record was upserted just below.
        pan_hash: submittedHash,
        // Locally-computed signals win over whatever Cashfree returned —
        // matches the cached-match branch's behaviour so the admin
        // panel sees consistent fields regardless of cache hit/miss.
        name_match_score:
          localGraded?.score ?? cashfreeScore ?? null,
        name_match_result:
          (localGraded?.grade as string | undefined) ??
          (result.name_match as string | undefined) ??
          null,
        ...(mismatchHintForAudit
          ? { mismatch_hint: mismatchHintForAudit }
          : {}),
        ...(needsAdminReviewFresh
          ? {
              needs_admin_review: true,
              reason: adminReviewAtPassFresh
                ? "initial_expansion_match"
                : "name_mismatch_admin_review",
            }
          : {}),
      },
      expires_at: null,
      attempt_no: 1,
    })

    // Auto-flag a manual_kyc_request on EITHER admin-review trigger
    // (loose auto-pass OR meaningful-overlap mismatch). Idempotent
    // w.r.t. existing pending requests for this customer.
    if (needsAdminReviewFresh) {
      const triggerNote = adminReviewAtPassFresh
        ? "[Auto-flagged] PAN match used initial-to-full expansion. Verify the customer's typed name against the PAN registry before approving."
        : "[Auto-flagged] PAN found via Cashfree but typed name didn't auto-match (score=" +
          (localGraded?.score?.toFixed(2) ?? "n/a") +
          ", grade=" +
          (localGraded?.grade ?? "n/a") +
          '). Customer typed: "' +
          name +
          '". Verify against the customer\'s uploaded PAN card photo and approve OR reject with a reason.'
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

    // Persist the Cashfree response into the GLOBAL pan_record
    // table (keyed by pan_hash). Survives customer deletion. Two
    // customers verifying the same PAN share one row.
    //
    // We upsert on any PAN-valid response (with or without name
    // match). Cashfree calls cost money — caching the result lets
    // a same-customer retry (or a different customer typing the
    // same PAN later) short-circuit to the local row instead of
    // burning another paid call. The data is the same whether or
    // not THIS customer's typed name matched. We rely on storage
    // hardening (encrypted column for `aadhaar_full`, registry
    // never returned to storefront APIs, admin-side reveal-toggle
    // gating) for the privacy posture, not on selective caching.
    //
    // We DO skip the write on PAN-invalid responses (Cashfree
    // didn't give us a registered name to cache).
    //
    // Customer-side metadata pointer (`pan_hash` +
    // `pan_registered_name`) is gated SEPARATELY on `verified` —
    // setting the pointer on a name-mismatch would wrongly
    // attribute someone else's PAN to this customer. The registry
    // is global / customer-agnostic; the metadata link is the
    // per-customer attribution.
    if (result.ok && result.name_on_pan) {
      try {
        await walletModule.upsertPanRecord({
          pan_hash: submittedHash,
          pan_masked: maskPan(pan),
          // Full plaintext PAN — added 2026-05-06 to feed Cashfree
          // PG-VBA's `kyc_details.pan` payload on subsequent VBA
          // mints / edits without re-prompting the customer. Same
          // retention contract as `aadhaar_record.aadhaar_full`:
          // never returned to storefront, admin-reveal-toggle gated.
          pan_full: pan,
          registered_name: result.name_on_pan,
          name_pan_card: result.name_pan_card ?? null,
          first_name: result.first_name ?? null,
          last_name: result.last_name ?? null,
          pan_type: result.type ?? null,
          father_name: result.father_name ?? null,
          pan_status: result.pan_status ?? null,
          last_updated_at_itd: result.last_updated_at ?? null,
          aadhaar_linked:
            typeof result.aadhaar_linked === "boolean"
              ? result.aadhaar_linked
              : null,
          aadhaar_seeding_status: result.aadhaar_seeding_status ?? null,
          aadhaar_seeding_status_desc:
            result.aadhaar_seeding_status_desc ?? null,
          masked_aadhaar: result.masked_aadhaar ?? null,
          gender: result.gender ?? null,
          date_of_birth: result.dob ?? null,
          email_masked: result.email ?? null,
          phone_masked: result.phone ?? null,
          address: result.address ?? null,
          name_match_score_initial: result.name_match_score ?? null,
          name_match_result_initial: result.name_match ?? null,
          cashfree_reference_id: result.reference_id ?? null,
          cashfree_verification_id: result.verification_id ?? null,
          // Full UNREDACTED Cashfree response. pan_record is the global
          // canonical cache — keyed by pan_hash, never customer-bound,
          // retained across customer purges. We want every field
          // Cashfree returned (including any new ones not yet wired into
          // typed columns), not the DPDP-redacted subset that goes into
          // the customer-bound secure_id_verification audit log.
          response_raw: result.raw,
        })
      } catch (cacheErr) {
        logger.warn("pan_record upsert failed (non-blocking)", {
          customer_id: customerId,
          error: (cacheErr as Error).message,
        })
      }

      // Customer-side pointer — kept thin so the global table is the
      // source of truth. CRITICAL: only link customer.metadata.pan_hash
      // on a SUCCESSFUL match. Setting it on a name-mismatch would
      // wrongly attribute someone else's PAN to this customer
      // (e.g., Alice typing Bob's PAN would tag Alice's account with
      // Bob's PAN hash). Admins can still trace failed attempts via
      // secure_id_verification rows, and the global pan_record cache
      // (written above without this gate) carries the holder's data
      // for any future legitimate sign-up by the real holder.
      if (verified) {
        try {
          const { first_name, last_name } = splitFullName(
            result.name_on_pan ?? "",
          )
          await customerModule.updateCustomers(customerId, {
            first_name,
            last_name,
            metadata: {
              ...(meta as Record<string, unknown>),
              full_name: result.name_on_pan,
              pan_hash: submittedHash,
              pan_registered_name: result.name_on_pan,
            },
          })
        } catch {
          /* non-fatal */
        }
        // Live-match path: PAN was just verified via Cashfree. Same
        // registry sync as the cached path — issues a fresh client_id
        // for first-ever PANs, reuses the existing one for re-
        // registrations after a hard-delete.
        await syncIdentityRegistryPostPanVerify(
          req.scope,
          customerId,
          pan,
          maskPan(pan),
          submittedHash,
        )
      }
    }

    // Fire the customer-facing email — kyc.pan_approved on success,
    // kyc.pan_rejected on either PAN invalid OR name-mismatch failure.
    // Template + event-map are seeded in polemarch_communication. Failure is
    // best-effort — we never want the email hop to break the verify
    // response, so the send is wrapped + swallowed.
    try {
      if (verified) {
        await sendEventEmail(req.scope, "kyc.pan_approved", {
          customer_id: customerId,
          pan_masked: maskPan(pan),
          name_on_pan: result.name_on_pan,
        })
        await fireFullyApprovedIfReady(req.scope, customerId)
        await fireInvestingReadyIfReady(req.scope, customerId)

        // Auto-close any stale pending manual_kyc_request from a
        // prior failed attempt — the customer just auto-verified
        // cleanly so the queued review is no longer needed. Same
        // pattern as the cached-match success branch above.
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
                  "Auto-cancelled: customer's subsequent PAN verify auto-passed cleanly via Cashfree.",
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
      } else {
        await sendEventEmail(req.scope, "kyc.pan_rejected", {
          customer_id: customerId,
          pan_masked: maskPan(pan),
          reason: !result.ok
            ? "PAN not valid with the Income Tax Department."
            : `Name on PAN (${result.name_on_pan ?? "—"}) did not match the name you entered (${name}).`,
          next_step:
            "Check your PAN number and name spelling, then try again. Five attempts allowed per day.",
        })
      }
    } catch (emailErr) {
      logger.warn("pan verify email failed (non-blocking)", {
        customer_id: customerId,
        error: (emailErr as Error).message,
      })
    }

    // Gamification award (best-effort — never blocks the response).
    // grantPointsForEvent silently no-ops when the gamification module
    // isn't loaded or master is off, and never throws into the request
    // path. The unlocks payload, when non-empty, lets the storefront
    // play the toast / level-up modal on the same response cycle.
    let gamification:
      | Awaited<ReturnType<typeof grantPointsForEvent>>
      | null = null
    if (verified) {
      gamification = await grantPointsForEvent({
        scope: req.scope,
        customer_id: customerId,
        event_kind: "kyc.pan_approved",
        amount: 100,
        source: "KYC_STEP",
        reference_type: "kyc.pan",
        reference_id: customerId,
        idempotency_key: `KYC_STEP:pan:${customerId}`,
        note: "PAN verified",
      })
    }

    // Privacy: only echo back `name_on_pan` on a successful match
    // (where the customer literally typed it themselves). On a
    // mismatch, the PAN may belong to someone else — surfacing the
    // real holder's name to the storefront would leak identity.
    //
    // We DO surface a `mismatch_hint` (initials_in_submitted /
    // submitted_too_short / no_obvious_pattern) on a name-mismatch
    // so the storefront can show actionable copy without leaking
    // the registered name itself. Mirrors the cached-match branch.
    //
    // HTTP-200 envelope on both verified-true and verified-false:
    // the Cashfree call succeeded either way; `verified` carries
    // the business verdict.
    let mismatchHintFresh: "initials_in_submitted" | "submitted_too_short" | "no_obvious_pattern" | undefined
    if (!verified && result.ok && localGraded) {
      // Same ranked rules as the cached-match branch above. Only
      // suggest "add middle name" / "expand initials" when there's
      // genuine overlap (≥0.3); a no-overlap miss is probably the
      // wrong PAN, not an abbreviation issue.
      const someOverlap = localGraded.score >= 0.3
      mismatchHintFresh =
        someOverlap && localGraded.diagnostics.initial_match_used
          ? "initials_in_submitted"
          : someOverlap && localGraded.diagnostics.submitted_shorter
            ? "submitted_too_short"
            : "no_obvious_pattern"
    }
    // NO MATCH band: PAN valid but name overlap below admin-review
    // floor. Surface upload_required so the storefront routes to the
    // document-upload flow.
    const noMatchBand =
      result.ok && !verified && !needsAdminReviewFresh
    return respondOk(res, {
      verified,
      pan_valid: result.ok,
      name_match_ok: nameMatchOk,
      status: result.status,
      ...(verified
        ? { name_on_pan: result.name_on_pan, name_match: result.name_match }
        : {}),
      ...(needsAdminReviewFresh
        ? {
            pending_review: true,
            pending_reason: adminReviewAtPassFresh
              ? "initial_expansion_match"
              : "name_mismatch_admin_review",
            message:
              "Partial match — our team will review and approve. You'll get an email once it's done.",
          }
        : {}),
      ...(noMatchBand
        ? {
            upload_required: true,
            message:
              "We couldn't auto-verify your PAN. Please upload your PAN card and our team will verify it offline. You'll get an email once it's approved.",
          }
        : {}),
      ...(mismatchHintFresh ? { mismatch_hint: mismatchHintFresh } : {}),
      submitted_name: name,
      gamification,
    })
  } catch (err) {
    const isApi = err instanceof CashfreeApiError
    logger.warn("pan verify failed", {
      customer_id: customerId,
      status: isApi ? err.status : undefined,
      body: isApi ? err.body : undefined,
    })
    await walletModule
      .createSecureIdVerifications({
        customer_id: customerId,
        kind: "pan",
        reference_id: null,
        status: "failed",
        input_masked: maskPan(pan),
        response_raw: {
          error: (err as Error).message ?? "unknown",
          api_status: isApi ? err.status : undefined,
          // Preserve what the customer typed even when Cashfree errors,
          // so the admin panel can still show "Submitted name" on the
          // failure row.
          submitted_name: name,
          cached_match: false,
        },
        expires_at: null,
        attempt_no: 1,
      })
      .catch(() => {})
    const httpStatus = isApi && err.status < 500 ? 400 : 502
    return respondErr(
      res,
      httpStatus,
      "kyc.pan.upstream_error",
      isApi
        ? `Cashfree rejected PAN verification (${err.status})`
        : "PAN verification service unavailable",
    )
  }
}
