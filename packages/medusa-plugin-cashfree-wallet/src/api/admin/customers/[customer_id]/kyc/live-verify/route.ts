import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { z } from "zod"
import { Modules } from "@medusajs/framework/utils"
import { createHash } from "node:crypto"
import {
  CASHFREE_WALLET_MODULE,
  CashfreeWalletService,
} from "../../../../../../modules/cashfree_wallet"
import {
  redactSecureIdResponse,
} from "../../../../../../modules/cashfree_wallet/cashfree/secure-id"
import {
  decryptString,
  maskAadhaar,
  maskPan,
} from "../../../../../../modules/cashfree_wallet/cashfree/crypto"
import {
  ADMIN_SECURE_ID_LIMITS,
  hitRateLimit,
} from "../../../../../../modules/cashfree_wallet/rate-limit"
import { sendEventEmail } from "../../../../../../lib/send-event-email"
import { logger } from "../../../../../../utils/logger"
import { CashfreeApiError } from "../../../../../../modules/cashfree_wallet/cashfree/client"

/**
 * POST /admin/customers/:customer_id/kyc/live-verify
 *
 * Admin-initiated mirror of the customer-facing `/store/kyc/*` routes.
 * Lets ops run a real Cashfree Secure ID call on behalf of a customer
 * — useful when a customer can't complete the self-serve flow (device
 * issue, bad network, typo loop) or when we want to re-check a record
 * that previously failed.
 *
 * Every call:
 *   - Persists a `secure_id_verification` row (status + masked input +
 *     redacted response) — indistinguishable from a storefront call
 *     from the audit-log point of view.
 *   - Writes an `admin_audit_log` entry attributing the action to the
 *     admin user with a mandatory `reason`.
 *   - Fires the same `kyc.*` email event as the storefront path so the
 *     customer gets the same notification regardless of who clicked
 *     the button.
 *
 * Rate limit: separate admin bucket (`ADMIN_SECURE_ID_LIMITS`) keyed by
 * admin_user_id — one noisy ops user can't brown-out other admins or
 * eat the customer's daily quota on the storefront side.
 */

// Discriminated body — each kind carries its own required shape. All
// branches also carry a `reason` (audit trail) with the same min-4-char
// rule the existing admin KYC edit route uses.
const BaseSchema = z.object({
  reason: z.string().trim().min(4).max(500),
})

/**
 * Strict PAN regex — same shape as `/store/kyc/pan/verify`. The 4th
 * letter must be a valid entity-type code (P/F/C/H/A/T/B/L/J/G); a
 * malformed PAN never reaches Cashfree.
 */
const PAN_REGEX = /^[A-Z]{3}[ABCFGHJLPT][A-Z][0-9]{4}[A-Z]$/
const PAN_FORMAT_ERROR =
  "Invalid PAN format. A PAN is 10 characters: 5 letters + 4 digits + 1 letter (e.g. ABCDE1234F). The 4th letter must encode the entity type (P=Person, F=Firm, C=Company, H=HUF, A=AOP, T=Trust, B=BOI, L=Local Authority, J=Artificial Juridical Person, G=Government)."

function panFingerprint(pan: string): string {
  return createHash("sha256")
    .update(pan.toUpperCase().trim())
    .digest("hex")
}

/**
 * Same token-set grader the storefront flow uses for cache-hit name
 * matching. Mirrors Cashfree's grade vocabulary so cached and fresh
 * paths emit identical `name_match` strings.
 */
function gradeNameMatchInline(
  submitted: string,
  registered: string,
): { grade: string; score: number } {
  const norm = (s: string) =>
    s
      .toUpperCase()
      .replace(/[^A-Z\s]/g, " ")
      .split(/\s+/)
      .filter((t) => t.length > 1)
  const a = new Set(norm(submitted))
  const b = new Set(norm(registered))
  if (a.size === 0 || b.size === 0) return { grade: "NO_MATCH", score: 0 }
  let shared = 0
  for (const t of a) if (b.has(t)) shared++
  const denom = Math.max(a.size, b.size)
  const score = denom === 0 ? 0 : shared / denom
  if (shared === a.size && shared === b.size)
    return { grade: "EXACT_MATCH", score: 1 }
  if (shared === a.size || shared === b.size)
    return { grade: "GOOD_PARTIAL_MATCH", score }
  if (shared > 0) return { grade: "POOR_PARTIAL_MATCH", score }
  return { grade: "NO_MATCH", score: 0 }
}

const PanBody = BaseSchema.extend({
  kind: z.literal("pan"),
  pan: z
    .string()
    .trim()
    .transform((s) => s.toUpperCase())
    .refine((s) => PAN_REGEX.test(s), PAN_FORMAT_ERROR),
  name: z.string().trim().min(1).max(200),
})
const AadhaarSendBody = BaseSchema.extend({
  kind: z.literal("aadhaar_otp_send"),
  aadhaar: z
    .string()
    .trim()
    .transform((s) => s.replace(/\s+/g, ""))
    .refine((s) => /^\d{12}$/.test(s), "Aadhaar must be 12 digits"),
})
const AadhaarVerifyBody = BaseSchema.extend({
  kind: z.literal("aadhaar_otp_verify"),
  ref_id: z.string().trim().min(1),
  otp: z
    .string()
    .trim()
    .transform((s) => s.replace(/\s+/g, ""))
    .refine((s) => /^\d{4,8}$/.test(s), "OTP must be 4–8 digits"),
})
const BankPennyBody = BaseSchema.extend({
  kind: z.literal("bank_penny"),
  bank_account_id: z.string().trim().min(1),
})
// CMR / demat live-verify branch removed — Cashfree CMR is no longer
// in contract. Use POST /admin/demat-accounts/:id/verify (manual
// approve / reject by an admin) instead.

const BodySchema = z.discriminatedUnion("kind", [
  PanBody,
  AadhaarSendBody,
  AadhaarVerifyBody,
  BankPennyBody,
])

const OTP_TTL_MS = 10 * 60 * 1000

export const POST = async (req: MedusaRequest, res: MedusaResponse) => {
  const parsed = BodySchema.safeParse(req.body)
  if (!parsed.success) {
    // Surface the field-level message so admins see e.g. the PAN format
    // hint, not the generic envelope. A malformed PAN never reaches
    // Cashfree — no API call, no quota burn.
    const flat = parsed.error.flatten()
    const firstField = Object.entries(flat.fieldErrors).find(
      ([, msgs]) => Array.isArray(msgs) && msgs.length,
    )
    const detail = firstField?.[1]?.[0]
    const isPan = firstField?.[0] === "pan"
    return res.status(400).json({
      message: detail ?? "Invalid input",
      reason: isPan ? "pan_format_invalid" : "input_invalid",
      errors: flat,
    })
  }
  const body = parsed.data
  const customerId = req.params.customer_id as string
  if (!customerId) {
    return res.status(400).json({ message: "Missing customer_id" })
  }

  const adminUserId =
    (req as any).auth_context?.actor_id ??
    (req as any).auth_context?.app_metadata?.user_id ??
    "unknown_admin"

  const walletModule = req.scope.resolve(
    CASHFREE_WALLET_MODULE
  ) as CashfreeWalletService
  const customerModule = req.scope.resolve(Modules.CUSTOMER) as any

  // Ensure the customer actually exists before we burn a rate slot.
  const customer = await customerModule
    .retrieveCustomer(customerId)
    .catch(() => null)
  if (!customer) {
    return res.status(404).json({ message: "Customer not found" })
  }

  // Rate-limit per admin, separated by kind — 'aadhaar_otp_send' and
  // 'aadhaar_otp_verify' get independent buckets because they're
  // cheap-then-expensive.
  const rlKey = rateKeyForKind(body.kind, adminUserId)
  const rlBucket = ADMIN_SECURE_ID_LIMITS[rateBucketForKind(body.kind)]
  const rl = hitRateLimit(rlKey, rlBucket.limit, rlBucket.windowMs)
  if (!rl.allowed) {
    return res.status(429).json({
      message: `Admin rate limit reached for ${body.kind}.`,
      reset_at: rl.reset_at,
    })
  }

  try {
    const secureId = await walletModule.getSecureId()

    if (body.kind === "pan") {
      const submittedHash = panFingerprint(body.pan)
      const meta = (customer?.metadata ?? {}) as Record<string, unknown>

      // ── Cache-first ───────────────────────────────────────────
      // If pan_record already has a row for this PAN (any source —
      // storefront verify, prior admin verify, dedup with another
      // customer), grade the name match locally and skip the
      // Cashfree call entirely. Saves quota + makes admin retries
      // free.
      const cached = await walletModule.lookupPanRecordByHash(submittedHash)
      if (cached) {
        const graded = gradeNameMatchInline(body.name, cached.registered_name)
        const verified = graded.grade === "EXACT_MATCH"
        const row = await walletModule.createSecureIdVerifications({
          customer_id: customerId,
          kind: "pan",
          reference_id: null,
          status: verified ? "success" : "failed",
          input_masked: maskPan(body.pan),
          response_raw: {
            cached_match: true,
            pan_record_id: cached.id,
            registered_name: cached.registered_name,
            name_match_score: graded.score,
            name_match_result: graded.grade,
          },
          expires_at: null,
          attempt_no: 1,
        })
        await walletModule.logAdminAction({
          admin_user_id: adminUserId,
          customer_id: customerId,
          action: "kyc_live_verify:pan",
          before: null,
          after: {
            pan_masked: maskPan(body.pan),
            status: verified ? "success" : "failed",
            cached: true,
          },
          note: body.reason,
        })
        // Link customer to pan_record (even on name-mismatch, so
        // admin Customer-360 can see the cached record).
        try {
          await customerModule.updateCustomers(customerId, {
            metadata: {
              ...meta,
              pan_hash: submittedHash,
              pan_registered_name: cached.registered_name,
            },
          })
        } catch {
          /* non-fatal */
        }
        if (verified) {
          fireAndForgetEmail(req.scope, "kyc.pan_approved", {
            customer_id: customerId,
            pan_masked: maskPan(body.pan),
            name_on_pan: cached.registered_name,
          })
        } else {
          fireAndForgetEmail(req.scope, "kyc.pan_rejected", {
            customer_id: customerId,
            pan_masked: maskPan(body.pan),
            reason: `Name on PAN (${cached.registered_name}) did not match the name we tried (${body.name}).`,
          })
        }
        return res.json({
          ok: verified,
          kind: "pan",
          verification_id: row.id,
          cached: true,
          result: {
            status: cached.pan_status ?? "VALID",
            name_on_pan: cached.registered_name,
            name_match: graded.grade,
          },
        })
      }

      // ── Cache miss — fresh Cashfree call ──────────────────────
      const result = await secureId.verifyPan({
        pan: body.pan,
        name: body.name,
      })
      const verified = result.ok && result.name_match === "EXACT_MATCH"
      const row = await walletModule.createSecureIdVerifications({
        customer_id: customerId,
        kind: "pan",
        reference_id: (result.raw as any).reference_id?.toString() ?? null,
        status: verified ? "success" : "failed",
        input_masked: maskPan(body.pan),
        response_raw: redactSecureIdResponse(result.raw),
        expires_at: null,
        attempt_no: 1,
      })
      await walletModule.logAdminAction({
        admin_user_id: adminUserId,
        customer_id: customerId,
        action: "kyc_live_verify:pan",
        before: null,
        after: { pan_masked: maskPan(body.pan), status: verified ? "success" : "failed" },
        note: body.reason,
      })

      // Persist into the global pan_record cache + link customer.
      // Same semantics as the storefront flow: write on PAN-valid
      // responses (with or without name match), full raw payload.
      if (result.ok && result.name_on_pan) {
        try {
          await walletModule.upsertPanRecord({
            pan_hash: submittedHash,
            pan_masked: maskPan(body.pan),
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
            // FULL Cashfree response — see model doc on pan_record.
            response_raw: result.raw,
          })
          await customerModule.updateCustomers(customerId, {
            metadata: {
              ...meta,
              pan_hash: submittedHash,
              pan_registered_name: result.name_on_pan,
            },
          })
        } catch (cacheErr) {
          logger.warn("admin live-verify pan_record upsert failed", {
            customer_id: customerId,
            error: (cacheErr as Error).message,
          })
        }
      }

      if (verified) {
        fireAndForgetEmail(req.scope, "kyc.pan_approved", {
          customer_id: customerId,
          pan_masked: maskPan(body.pan),
          name_on_pan: result.name_on_pan,
        })
      } else {
        fireAndForgetEmail(req.scope, "kyc.pan_rejected", {
          customer_id: customerId,
          pan_masked: maskPan(body.pan),
          reason: !result.ok
            ? "PAN not valid with the Income Tax Department."
            : `Name on PAN (${result.name_on_pan ?? "—"}) did not match the name we tried (${body.name}).`,
        })
      }
      return res.json({
        ok: verified,
        kind: "pan",
        verification_id: row.id,
        cached: false,
        result: {
          status: result.status,
          name_on_pan: result.name_on_pan ?? null,
          name_match: result.name_match ?? null,
        },
      })
    }

    if (body.kind === "aadhaar_otp_send") {
      const result = await secureId.sendAadhaarOtp({ aadhaar: body.aadhaar })
      const row = await walletModule.createSecureIdVerifications({
        customer_id: customerId,
        kind: "aadhaar_otp_send",
        reference_id: result.ref_id,
        status: result.ok ? "pending" : "failed",
        input_masked: maskAadhaar(body.aadhaar),
        response_raw: redactSecureIdResponse(result.raw),
        expires_at: result.ok ? new Date(Date.now() + OTP_TTL_MS) : null,
        attempt_no: 1,
      })
      await walletModule.logAdminAction({
        admin_user_id: adminUserId,
        customer_id: customerId,
        action: "kyc_live_verify:aadhaar_otp_send",
        before: null,
        after: {
          aadhaar_masked: maskAadhaar(body.aadhaar),
          status: result.ok ? "pending" : "failed",
          ref_id: result.ref_id,
        },
        note: body.reason,
      })
      if (!result.ok || !result.ref_id) {
        return res.status(400).json({
          ok: false,
          kind: "aadhaar_otp_send",
          verification_id: row.id,
          message: result.message || "Failed to send OTP",
        })
      }
      return res.json({
        ok: true,
        kind: "aadhaar_otp_send",
        verification_id: row.id,
        ref_id: result.ref_id,
        expires_at: new Date(Date.now() + OTP_TTL_MS).toISOString(),
      })
    }

    if (body.kind === "aadhaar_otp_verify") {
      const result = await secureId.verifyAadhaarOtp({
        ref_id: body.ref_id,
        otp: body.otp,
      })
      const verified = result.ok
      const row = await walletModule.createSecureIdVerifications({
        customer_id: customerId,
        kind: "aadhaar_otp_verify",
        reference_id: body.ref_id,
        status: verified ? "success" : "failed",
        input_masked: `ref:${body.ref_id.slice(0, 8)}…`,
        response_raw: redactSecureIdResponse(result.raw),
        expires_at: null,
        attempt_no: 1,
      })
      await walletModule.logAdminAction({
        admin_user_id: adminUserId,
        customer_id: customerId,
        action: "kyc_live_verify:aadhaar_otp_verify",
        before: null,
        after: {
          ref_id: body.ref_id,
          status: verified ? "success" : "failed",
        },
        note: body.reason,
      })
      if (verified) {
        fireAndForgetEmail(req.scope, "kyc.aadhaar_approved", {
          customer_id: customerId,
          aadhaar_masked: result.masked_aadhaar ?? null,
          name_on_aadhaar: result.name ?? null,
        })
      }
      return res.json({
        ok: verified,
        kind: "aadhaar_otp_verify",
        verification_id: row.id,
        result: {
          name: result.name ?? null,
          dob: result.dob ?? null,
          gender: result.gender ?? null,
          masked_aadhaar: result.masked_aadhaar ?? null,
        },
      })
    }

    if (body.kind === "bank_penny") {
      const bank = await walletModule
        .retrieveBankAccount(body.bank_account_id)
        .catch(() => null)
      if (!bank) return res.status(404).json({ message: "Bank account not found" })
      if (bank.customer_id !== customerId) {
        return res
          .status(400)
          .json({ message: "Bank account does not belong to this customer" })
      }
      // Decrypt the stored account number — we only kept the ciphertext
      // plus last-4 in the DB, and penny-drop needs the full number.
      // If the encryption key has rotated since the row was written,
      // decryption throws — surface that to ops rather than silently
      // penny-dropping the wrong account.
      let accountNumber: string
      try {
        accountNumber = decryptString(bank.account_number_encrypted)
      } catch {
        return res.status(400).json({
          message:
            "Could not decrypt the stored bank account number — the encryption key may have rotated. Ask the customer to re-add the bank account.",
        })
      }
      const result = await secureId.pennyDropBank({
        account_number: accountNumber,
        ifsc: bank.ifsc,
        name: bank.account_holder_name,
      })
      const verified = result.ok && (result.name_match_score ?? 0) >= 0.6
      const row = await walletModule.createSecureIdVerifications({
        customer_id: customerId,
        kind: "bank_penny",
        reference_id: result.reference_id ?? null,
        status: verified ? "success" : "failed",
        input_masked: `${bank.ifsc}:${accountNumber.slice(-4)}`,
        response_raw: redactSecureIdResponse(result.raw),
        expires_at: null,
        attempt_no: 1,
      })
      // Flip the bank's own verification_status so the Accounts tab +
      // downstream gates update immediately.
      await walletModule.updateBankAccounts(
        { id: bank.id },
        {
          verification_status: verified ? "verified" : "failed",
          verified_at: verified ? new Date() : null,
          name_at_bank: result.name_at_bank ?? null,
          name_match_score: result.name_match_score ?? null,
          verification_raw: redactSecureIdResponse(result.raw),
        },
      )
      await walletModule.logAdminAction({
        admin_user_id: adminUserId,
        customer_id: customerId,
        action: "kyc_live_verify:bank_penny",
        before: { status: bank.verification_status },
        after: {
          status: verified ? "verified" : "failed",
          name_match_score: result.name_match_score ?? null,
          reference_id: result.reference_id ?? null,
        },
        note: body.reason,
      })
      if (verified) {
        fireAndForgetEmail(req.scope, "kyc.bank_verified", {
          customer_id: customerId,
          bank_name: bank.bank_name,
          ifsc: bank.ifsc,
        })
      } else {
        fireAndForgetEmail(req.scope, "kyc.bank_rejected", {
          customer_id: customerId,
          bank_name: bank.bank_name,
          ifsc: bank.ifsc,
          reason:
            !result.ok
              ? result.raw
                ? "Penny-drop failed — the bank didn't confirm the account is valid."
                : "Penny-drop service unavailable."
              : `Name at bank didn't match (${(result.name_match_score ?? 0).toFixed(2)}).`,
        })
      }
      return res.json({
        ok: verified,
        kind: "bank_penny",
        verification_id: row.id,
        result: {
          name_at_bank: result.name_at_bank ?? null,
          name_match_score: result.name_match_score ?? null,
          reference_id: result.reference_id ?? null,
          status: result.status ?? null,
        },
      })
    }

    // CMR / demat live-verify path removed — manual approval via
    // POST /admin/demat-accounts/:id/verify is the supported flow.

    // Exhaustiveness: TS discriminated union should make this
    // unreachable, but guard belt-and-braces.
    return res.status(400).json({ message: "Unsupported kind" })
  } catch (err) {
    const isApi = err instanceof CashfreeApiError
    logger.warn("admin live-verify failed", {
      customer_id: customerId,
      admin_user_id: adminUserId,
      kind: body.kind,
      error: (err as Error).message,
      api_status: isApi ? (err as CashfreeApiError).status : undefined,
    })
    const code = isApi && (err as CashfreeApiError).status < 500 ? 400 : 502
    return res.status(code).json({
      ok: false,
      kind: body.kind,
      message: isApi
        ? `Cashfree rejected the request (${(err as CashfreeApiError).status})`
        : "Verification service unavailable",
    })
  }
}

function rateKeyForKind(kind: string, adminUserId: string): string {
  return `admin_${kind}:${adminUserId}`
}

function rateBucketForKind(kind: string): keyof typeof ADMIN_SECURE_ID_LIMITS {
  switch (kind) {
    case "pan":
      return "pan"
    case "aadhaar_otp_send":
      return "aadhaar_otp_send"
    case "aadhaar_otp_verify":
      return "aadhaar_otp_verify"
    case "bank_penny":
      return "bank_penny"
    default:
      return "pan"
  }
}

/** Wrap sendEventEmail in try/catch so email failures never break the
 *  verify response. Mirrors the pattern in the storefront routes. */
function fireAndForgetEmail(
  scope: any,
  slug: string,
  payload: Record<string, unknown>,
): void {
  void sendEventEmail(scope, slug, payload).catch((err) =>
    logger.warn(`live-verify email dispatch failed (${slug})`, {
      error: (err as Error).message,
    }),
  )
}
