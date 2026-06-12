import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { z } from "zod"
import { createHash } from "node:crypto"
import { Modules } from "@medusajs/framework/utils"
import {
  CASHFREE_WALLET_MODULE,
  CashfreeWalletService,
} from "../../../../../../modules/cashfree_wallet"
import {
  maskPan,
  maskAadhaar,
} from "../../../../../../modules/cashfree_wallet/cashfree/crypto"
import { logger } from "../../../../../../utils/logger"
import { sendEventEmail } from "../../../../../../lib/send-event-email"
import {
  findConflictingPanHashCustomer,
  findConflictingAadhaarHashCustomer,
} from "../../../../../../utils/identity-uniqueness"

/**
 * POST /admin/customers/:customer_id/kyc/manual
 *
 * Admin-driven KYC override. Two purposes:
 *   1. Approve / reject PAN or Aadhaar when Cashfree Secure ID isn't
 *      reachable (sandbox, merchant exception, support-driven exception).
 *   2. Close the manual-review queue items the partial-match flows feed.
 *
 * On approval we mirror what a successful Cashfree verification would
 * have done — not just the audit row:
 *   • secure_id_verification: status=success, response_raw.manual_override
 *     (drives getKycStatus → pan_verified / aadhaar_verified true).
 *   • customer.metadata.pan_hash / pan_registered_name / aadhaar_hash
 *     copied from the most recent pending audit row's pan/aadhaar_record
 *     pointer. Without this, every surface that gates on the metadata
 *     anchor (wizard's `meta.pan_hash` lookup, BuyBox, customer-360 admin
 *     tab) keeps showing the customer as not-verified even though
 *     getKycStatus says otherwise — that's the bug ops were hitting when
 *     "manual approve" looked successful but the wizard didn't advance.
 *   • kyc.pan_approved / kyc.aadhaar_approved event email — same one
 *     the live verify path fires, so the customer learns the override
 *     landed.
 *   • Any open manual_kyc_request for this customer is auto-closed with
 *     the admin's reason as reviewer_notes — saves the second click on
 *     /admin/manual-kyc-requests/:id/decide.
 *
 * Bank and demat manual verification have their own routes
 * (`/admin/bank-accounts/:id/verify`, `/admin/demat-accounts/:id/verify`)
 * because they need to touch the BankAccount / DematAccount rows.
 *
 * Body:
 *   {
 *     pan_approve?: boolean,       // true = mark PAN verified manually
 *     pan_reject?: boolean,        // true = log a rejection row
 *     aadhaar_approve?: boolean,
 *     aadhaar_reject?: boolean,
 *     reason: string               // required audit reason
 *   }
 */
const BodySchema = z.object({
  pan_approve: z.boolean().optional(),
  pan_reject: z.boolean().optional(),
  aadhaar_approve: z.boolean().optional(),
  aadhaar_reject: z.boolean().optional(),
  reason: z.string().trim().min(4).max(500),
  // Offline-verification convenience: admin can pass the typed
  // PAN/Aadhaar (+ holder name) alongside `pan_approve`/`aadhaar_approve`
  // and the route will hash, upsert into the registry, and link to the
  // customer in one shot. Useful when the customer never reached a
  // successful auto-verify (no audit row to inherit a hash from), e.g.
  // pure offline document-upload flow.
  pan_full: z
    .string()
    .trim()
    .transform((s) => s.toUpperCase())
    .refine((s) => /^[A-Z]{5}[0-9]{4}[A-Z]$/.test(s), "Invalid PAN format")
    .optional(),
  pan_name: z.string().trim().min(2).max(200).optional(),
  aadhaar_full: z
    .string()
    .trim()
    .transform((s) => s.replace(/\s+/g, ""))
    .refine((s) => /^\d{12}$/.test(s), "Aadhaar must be 12 digits")
    .optional(),
  aadhaar_name: z.string().trim().min(2).max(200).optional(),
})

/** Sort secure_id_verification rows newest-first using ISO created_at strings. */
function sortDescByCreatedAt<T extends { created_at?: string | Date | null }>(
  rows: T[],
): T[] {
  return [...rows].sort((a, b) =>
    String(b.created_at ?? "").localeCompare(String(a.created_at ?? "")),
  )
}

export const POST = async (req: MedusaRequest, res: MedusaResponse) => {
  const parsed = BodySchema.safeParse(req.body)
  if (!parsed.success) {
    return res
      .status(400)
      .json({ message: "Invalid input", errors: parsed.error.flatten() })
  }
  const { customer_id } = req.params
  if (!customer_id) return res.status(400).json({ message: "Missing customer_id" })

  const {
    pan_approve,
    pan_reject,
    aadhaar_approve,
    aadhaar_reject,
    reason,
    pan_full,
    pan_name,
    aadhaar_full,
    aadhaar_name,
  } = parsed.data
  if (pan_full && !pan_name) {
    return res.status(400).json({
      message: "pan_name is required when pan_full is supplied",
    })
  }
  if (aadhaar_full && !aadhaar_name) {
    return res.status(400).json({
      message: "aadhaar_name is required when aadhaar_full is supplied",
    })
  }
  if (pan_approve && pan_reject) {
    return res.status(400).json({ message: "pan_approve and pan_reject are mutually exclusive" })
  }
  if (aadhaar_approve && aadhaar_reject) {
    return res
      .status(400)
      .json({ message: "aadhaar_approve and aadhaar_reject are mutually exclusive" })
  }
  if (!pan_approve && !pan_reject && !aadhaar_approve && !aadhaar_reject) {
    return res.status(400).json({ message: "Nothing to do — set at least one flag" })
  }

  const walletModule = req.scope.resolve(
    CASHFREE_WALLET_MODULE
  ) as CashfreeWalletService
  const customerModule = req.scope.resolve(Modules.CUSTOMER) as any

  const adminUserId =
    (req as any).auth_context?.actor_id ??
    (req as any).auth_context?.app_metadata?.user_id ??
    "unknown"
  const refId = `manual:${adminUserId}:${Date.now()}`

  // We mutate the customer's metadata at the end with the cumulative
  // anchor writes from PAN + Aadhaar. Doing one update at the end (not
  // two interleaved) keeps the trigger-allowed payload spreadable in a
  // single jsonb assignment.
  const metadataPatch: Record<string, unknown> = {}
  let panMaskedForEmail: string | null = null
  let panNameForEmail: string | null = null
  let aadhaarMaskedForEmail: string | null = null

  try {
    if (pan_approve || pan_reject) {
      // Resolve the PAN anchor (hash + registered_name) from the most
      // recent audit row that pointed at a pan_record. The partial-match
      // and name-mismatch flows always stash pan_record_id in
      // response_raw, so this works for the common case (admin closing
      // a pending review). When no audit row carries it (rare —
      // typically only sandbox-only customers with zero prior attempts)
      // we still write the audit row + getKycStatus flips, but skip
      // the metadata anchor since we have nothing to attribute it to.
      if (pan_approve) {
        // Path A — admin supplied a typed PAN: hash it, upsert the
        // registry row, use that hash for the customer anchor. Lets the
        // customer be linked to a fresh registry entry from a pure-
        // offline (uploaded card) flow with no prior audit attempts.
        if (pan_full && pan_name) {
          const hash = createHash("sha256").update(pan_full).digest("hex")
          await walletModule.upsertPanRecord({
            pan_hash: hash,
            pan_masked: maskPan(pan_full),
            pan_full,
            registered_name: pan_name,
            response_raw: {
              manual_input: true,
              admin_user_id: adminUserId,
              reason,
              decision: "approved",
            },
          })
          metadataPatch.pan_hash = hash
          metadataPatch.pan_registered_name = pan_name
          panNameForEmail = pan_name
          panMaskedForEmail = maskPan(pan_full)
        } else {
          // Path B — fall back to inheriting from the most recent audit
          // row's pan_record_id (the partial-match / cached-mismatch
          // flows always stash one in response_raw). Works for "admin
          // closes a pending review" without re-typing the PAN.
          const panAttempts = await walletModule
            .listSecureIdVerifications({
              customer_id: customer_id as string,
              kind: "pan",
            })
            .catch(() => [] as Awaited<ReturnType<typeof walletModule.listSecureIdVerifications>>)
          const sorted = sortDescByCreatedAt(panAttempts as any[])
          const withRecord = sorted.find(
            (r) => (r.response_raw as any)?.pan_record_id,
          )
          const recordId = (withRecord?.response_raw as any)?.pan_record_id as
            | string
            | undefined
          panMaskedForEmail = (withRecord?.input_masked as string | null) ?? null
          if (recordId) {
            const pr = await walletModule
              .retrievePanRecord(recordId)
              .catch(() => null)
            if (pr?.pan_hash) {
              metadataPatch.pan_hash = pr.pan_hash
              metadataPatch.pan_registered_name = pr.registered_name ?? null
              panNameForEmail = pr.registered_name ?? null
            }
          }
        }
      }

      await walletModule.createSecureIdVerifications({
        customer_id: customer_id as string,
        kind: "pan",
        reference_id: refId,
        status: pan_approve ? "success" : "failed",
        input_masked: panMaskedForEmail ?? "MANUAL OVERRIDE",
        response_raw: {
          manual_override: true,
          admin_user_id: adminUserId,
          reason,
          decision: pan_approve ? "approved" : "rejected",
        },
        expires_at: null,
        attempt_no: 1,
      })
    }

    if (aadhaar_approve || aadhaar_reject) {
      if (aadhaar_approve) {
        // Path A — admin supplied a typed Aadhaar: hash + upsert the
        // registry row, use that hash for the customer anchor.
        if (aadhaar_full && aadhaar_name) {
          const hash = createHash("sha256")
            .update(aadhaar_full)
            .digest("hex")
          await walletModule.upsertAadhaarRecord({
            aadhaar_hash: hash,
            aadhaar_masked: maskAadhaar(aadhaar_full),
            aadhaar_full,
            name: aadhaar_name,
            response_raw: {
              manual_input: true,
              admin_user_id: adminUserId,
              reason,
              decision: "approved",
            },
          })
          metadataPatch.aadhaar_hash = hash
          // Match the storefront otp-verify success path so every
          // downstream gate that reads `metadata.aadhaar_verified`
          // (bank-account add, demat add, KYC banners) flips to OK
          // immediately on admin approval — without this, an admin
          // approval left the customer with `aadhaar_hash` set but
          // `aadhaar_verified` still falsy, blocking bank add.
          metadataPatch.aadhaar_verified = true
          metadataPatch.aadhaar_verified_at = new Date().toISOString()
          aadhaarMaskedForEmail = maskAadhaar(aadhaar_full)
        } else {
          // Path B — inherit from the most recent audit row.
          const aadhaarAttempts = await walletModule
            .listSecureIdVerifications({
              customer_id: customer_id as string,
            })
            .catch(() => [] as any[])
          const sorted = sortDescByCreatedAt(
            (aadhaarAttempts as any[]).filter((r) =>
              String(r.kind ?? "").startsWith("aadhaar"),
            ),
          )
          let aadhaarHash: string | null = null
          for (const r of sorted) {
            const raw = (r.response_raw ?? {}) as Record<string, unknown>
            if (typeof raw._aadhaar_hash === "string" && raw._aadhaar_hash) {
              aadhaarHash = raw._aadhaar_hash
              break
            }
            const recId = raw.aadhaar_record_id
            if (typeof recId === "string" && recId) {
              const ar = await walletModule
                .retrieveAadhaarRecord(recId)
                .catch(() => null)
              if (ar?.aadhaar_hash) {
                aadhaarHash = ar.aadhaar_hash
                break
              }
            }
          }
          aadhaarMaskedForEmail =
            (sorted.find((r) => r.input_masked)?.input_masked as string | null) ??
            null
          if (aadhaarHash) {
            metadataPatch.aadhaar_hash = aadhaarHash
            metadataPatch.aadhaar_verified = true
            metadataPatch.aadhaar_verified_at = new Date().toISOString()
          }
        }
      }

      // getKycStatus checks `aadhaar_otp_verify` kind specifically, so that's
      // what we write even for manual overrides.
      await walletModule.createSecureIdVerifications({
        customer_id: customer_id as string,
        kind: "aadhaar_otp_verify",
        reference_id: refId,
        status: aadhaar_approve ? "success" : "failed",
        input_masked: aadhaarMaskedForEmail ?? "MANUAL OVERRIDE",
        response_raw: {
          manual_override: true,
          admin_user_id: adminUserId,
          reason,
          decision: aadhaar_approve ? "approved" : "rejected",
        },
        expires_at: null,
        attempt_no: 1,
      })
    }

    // Cross-customer uniqueness check — even an admin shouldn't be
    // able to attach a PAN/Aadhaar that's already linked to a
    // different live customer. The storefront verify routes already
    // run these checks; this is the admin-side parity. We probe AFTER
    // the audit row writes so the admin still sees their reason
    // landed in the audit trail, but BEFORE the metadata anchors get
    // written so the conflict can't slip through.
    if (
      typeof metadataPatch.pan_hash === "string" &&
      metadataPatch.pan_hash.length > 0
    ) {
      const conflict = await findConflictingPanHashCustomer(
        req.scope,
        metadataPatch.pan_hash as string,
        customer_id as string,
      ).catch(() => null)
      if (conflict) {
        logger.warn("manual kyc override: pan_hash already on another customer", {
          customer_id,
          conflict_customer_id: conflict,
        })
        delete metadataPatch.pan_hash
        delete metadataPatch.pan_registered_name
        // Keep the audit row (already written) but don't link the
        // metadata anchor — admin needs to investigate the conflict
        // before committing.
        return res.status(409).json({
          ok: false,
          code: "kyc.pan_already_linked",
          message: `PAN already linked to another customer (${conflict}). Audit row written; metadata anchor NOT updated. Resolve the conflict first.`,
          conflict_customer_id: conflict,
        })
      }
    }
    if (
      typeof metadataPatch.aadhaar_hash === "string" &&
      (metadataPatch.aadhaar_hash as string).length > 0
    ) {
      const conflict = await findConflictingAadhaarHashCustomer(
        req.scope,
        metadataPatch.aadhaar_hash as string,
        customer_id as string,
      ).catch(() => null)
      if (conflict) {
        logger.warn("manual kyc override: aadhaar_hash already on another customer", {
          customer_id,
          conflict_customer_id: conflict,
        })
        delete metadataPatch.aadhaar_hash
        return res.status(409).json({
          ok: false,
          code: "kyc.aadhaar_already_linked",
          message: `Aadhaar already linked to another customer (${conflict}). Audit row written; metadata anchor NOT updated. Resolve the conflict first.`,
          conflict_customer_id: conflict,
        })
      }
    }

    // Single customer write. Spread existing metadata to preserve
    // unrelated keys (email_verified flags, OTP scratchpads, etc.).
    // When PAN approval landed a registered_name, also flip the
    // customer's display name (first/last) to the canonical PAN form
    // — same sync the storefront PAN-verify route does on its
    // success path. Keeps the navbar / dashboard greeting / VBA
    // beneficiary aligned with the regulator-canonical name.
    const displayNamePatch: { first_name?: string; last_name?: string } = {}
    if (panNameForEmail && panNameForEmail.trim().length > 0) {
      const parts = panNameForEmail.trim().split(/\s+/).filter(Boolean)
      if (parts.length >= 1) {
        displayNamePatch.first_name = parts[0]
        displayNamePatch.last_name = parts.slice(1).join(" ")
      }
      ;(metadataPatch as Record<string, unknown>).full_name = panNameForEmail
    }
    if (
      Object.keys(metadataPatch).length > 0 ||
      Object.keys(displayNamePatch).length > 0
    ) {
      try {
        const cust = await customerModule
          .retrieveCustomer(customer_id as string)
          .catch(() => null)
        const existingMeta = (cust?.metadata ?? {}) as Record<string, unknown>
        await customerModule.updateCustomers(customer_id as string, {
          ...displayNamePatch,
          metadata: {
            ...existingMeta,
            ...metadataPatch,
          },
        })
      } catch (e) {
        logger.warn("manual kyc override: customer write failed", {
          customer_id,
          error: (e as Error).message,
        })
      }
    }

    // Auto-close any pending manual_kyc_request — saves admin the
    // second click on /admin/manual-kyc-requests/:id/decide. Idempotent:
    // if no pending request exists this is a no-op.
    if (pan_approve || aadhaar_approve || pan_reject || aadhaar_reject) {
      try {
        const [pendingReq] = await walletModule.listManualKycRequests(
          { customer_id: customer_id as string, status: "pending" } as any,
          { take: 1 },
        )
        if (pendingReq) {
          const decision =
            (pan_approve || aadhaar_approve) && !(pan_reject || aadhaar_reject)
              ? "approved"
              : "rejected"
          await walletModule.updateManualKycRequests({
            selector: { id: (pendingReq as any).id },
            data: {
              status: decision,
              reviewer_user_id:
                adminUserId === "unknown" ? null : adminUserId,
              reviewer_notes: `[Auto-closed by manual override] ${reason}`,
              reviewed_at: new Date(),
            },
          })
        }
      } catch (e) {
        logger.warn("manual kyc override: auto-close manual_kyc_request failed", {
          customer_id,
          error: (e as Error).message,
        })
      }
    }

    // Notify customer. Mirrors the live-verify path's emails so the
    // customer-facing surface is consistent regardless of whether the
    // approval came from Cashfree or an admin.
    if (pan_approve) {
      await sendEventEmail(req.scope, "kyc.pan_approved", {
        customer_id: customer_id as string,
        pan_masked: panMaskedForEmail,
        name_on_pan: panNameForEmail,
      }).catch((e) =>
        logger.warn("manual kyc override: kyc.pan_approved email failed", {
          customer_id,
          error: (e as Error).message,
        }),
      )
    }
    if (aadhaar_approve) {
      await sendEventEmail(req.scope, "kyc.aadhaar_approved", {
        customer_id: customer_id as string,
        masked_aadhaar: aadhaarMaskedForEmail,
      }).catch((e) =>
        logger.warn("manual kyc override: kyc.aadhaar_approved email failed", {
          customer_id,
          error: (e as Error).message,
        }),
      )
    }

    const status = await walletModule.getKycStatus(customer_id as string)
    // If KYC just flipped to approved, drain any held payment attempts.
    if (status.overall === "approved") {
      await walletModule
        .captureHeldPaymentAttempts(customer_id as string)
        .catch((e) =>
          logger.warn("drain after manual KYC failed", { error: e })
        )
    }
    res.json({ ok: true, kyc_status: status, metadata_patch: metadataPatch })
  } catch (err) {
    logger.error("manual kyc override failed", { customer_id, error: err })
    res.status(500).json({ message: (err as Error).message })
  }
}
