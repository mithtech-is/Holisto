import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { Modules } from "@medusajs/framework/utils"
import { z } from "zod"
import {
  CASHFREE_WALLET_MODULE,
  CashfreeWalletService,
} from "../../../modules/cashfree_wallet"
import {
  hitRateLimit,
  SECURE_ID_LIMITS,
} from "../../../modules/cashfree_wallet/rate-limit"
import { sendEventEmail } from "../../../lib/send-event-email"
import { logger } from "../../../utils/logger"
import { extractCmrFingerprints } from "../../../utils/cmr-text-match"
import { grantPointsForEvent } from "../../../lib/grant-points"
import { fireInvestingReadyIfReady } from "../../../utils/onboarding-events"

const CreateSchema = z
  .object({
    depository: z.enum(["NSDL", "CDSL"]),
    dp_name: z.string().trim().min(2).max(100),
    dp_id: z.string().trim().regex(/^IN\d{6}$/).optional(),
    client_id: z.string().trim().regex(/^\d{8}$/).optional(),
    boid: z.string().trim().regex(/^\d{16}$/).optional(),
    account_holder_name: z.string().trim().min(2).max(100),
    cmr_file_url: z.string().trim().refine(
      (s) => s.startsWith("/static/") || s.startsWith("http"),
      "CMR file URL must be uploaded first"
    ),
  })
  .superRefine((v, ctx) => {
    if (v.depository === "NSDL") {
      if (!v.dp_id || !v.client_id) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "NSDL accounts require dp_id (IN + 6 digits) and client_id (8 digits)",
          path: ["dp_id"],
        })
      }
    } else {
      if (!v.boid) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "CDSL accounts require a 16-digit BO ID",
          path: ["boid"],
        })
      }
    }
  })

export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const customerId = (req as any).auth_context?.app_metadata?.customer_id as
    | string
    | undefined
  if (!customerId) return res.status(401).json({ message: "Not authenticated" })
  const walletModule = req.scope.resolve(
    CASHFREE_WALLET_MODULE
  ) as CashfreeWalletService
  const rows = await walletModule.listDematAccounts({ customer_id: customerId })
  res.json({
    demat_accounts: rows.map((d) => ({
      id: d.id,
      depository: d.depository,
      dp_id: d.dp_id,
      client_id: d.client_id,
      boid: d.boid,
      dp_name: d.dp_name,
      account_holder_name: d.account_holder_name,
      cmr_file_url: d.cmr_file_url,
      name_match_score: d.name_match_score,
      verification_status: d.verification_status,
      is_primary: d.is_primary,
      verified_at: d.verified_at,
      created_at: d.created_at,
    })),
  })
}

export const POST = async (req: MedusaRequest, res: MedusaResponse) => {
  const customerId = (req as any).auth_context?.app_metadata?.customer_id as
    | string
    | undefined
  if (!customerId) return res.status(401).json({ message: "Not authenticated" })

  const parsed = CreateSchema.safeParse(req.body)
  if (!parsed.success) {
    return res
      .status(400)
      .json({ message: "Invalid input", errors: parsed.error.flatten() })
  }
  const input = parsed.data

  const walletModule = req.scope.resolve(
    CASHFREE_WALLET_MODULE
  ) as CashfreeWalletService

  // CMR / demat verification is now MANUAL.
  //
  // Cashfree's CMR endpoint is no longer in our verification suite, so
  // the customer-facing add path stops short of any partner call. We
  // accept the demat row + uploaded CMR PDF and queue it for an
  // admin to approve in /app/customer-360 → Accounts. The admin path
  // (`/admin/demat-accounts/:id/verify`) flips `verification_status`
  // to verified/failed and sends `demat.verified` / `demat.rejected`
  // emails — same end state, just human-in-the-loop.
  //
  // We deliberately leave the storefront's `cmr` rate-limit bucket
  // active to keep customers from spam-uploading CMR files; the
  // backend just doesn't make a Cashfree call.

  const rl = hitRateLimit(
    `cmr:${customerId}`,
    SECURE_ID_LIMITS.cmr.limit,
    SECURE_ID_LIMITS.cmr.windowMs
  )
  if (!rl.allowed) {
    return res
      .status(429)
      .json({ message: "Demat upload limit reached. Try again later." })
  }

  // Same-customer dedupe — refuse if this customer has already
  // submitted this demat (any state). The depository scope keeps the
  // check tight: a CDSL row with BOID 1234 and an NSDL row with the
  // same numeric "1234" in dp_id are different fingerprints.
  const dedupe = await walletModule.listDematAccounts({
    customer_id: customerId,
    depository: input.depository,
    ...(input.boid
      ? { boid: input.boid }
      : { dp_id: input.dp_id, client_id: input.client_id }),
  })
  if (dedupe.length > 0) {
    return res.status(409).json({ message: "This demat account is already on file" })
  }

  // Cross-customer enforcement — one depository account belongs to one
  // Polemarch customer. Refuse if any OTHER customer has this demat
  // on file in a non-failed state. Same compliance logic as the bank
  // gate at /store/bank-accounts: dual-claim demats route through ops
  // for human review rather than auto-blocking the second submission.
  const sharedCount = await walletModule.countDematAccountsByFingerprint({
    depository: input.depository,
    boid: input.boid ?? null,
    dp_id: input.dp_id ?? null,
    client_id: input.client_id ?? null,
    exclude_customer_id: customerId,
  })
  if (sharedCount >= 1) {
    return res.status(409).json({
      ok: false,
      reason: "compliance_review",
      message:
        "This demat account is already linked to another Polemarch account. " +
        "If that's also you, sign in with the other account — or contact " +
        "grievance@polemarch.in if this looks wrong.",
    })
  }

  // ── CMR text-match auto-verify ──────────────────────────────────
  //
  // Pull the customer's verified PAN from `pan_record` (linked via
  // `customer.metadata.pan_hash`), then text-extract the uploaded CMR
  // PDF and search for both the PAN and the typed BOID / DP-ID +
  // Client-ID. When all anchors land in the document, the demat is
  // almost certainly the customer's — auto-verify and skip the manual
  // queue. Anything less drops to pending → manual review (existing
  // path). The matcher is best-effort: failures (corrupt PDF, image-
  // only PDF) silently fall through to manual review.
  const customerModule = req.scope.resolve(Modules.CUSTOMER) as any
  const customer = await customerModule
    .retrieveCustomer(customerId)
    .catch(() => null)
  const customerMeta = (customer?.metadata ?? {}) as Record<string, unknown>
  const panHash =
    typeof customerMeta.pan_hash === "string" && customerMeta.pan_hash.length > 0
      ? (customerMeta.pan_hash as string)
      : null
  let customerPan: string | null = null
  if (panHash) {
    const panRecord = await walletModule
      .lookupPanRecordByHash(panHash)
      .catch(() => null)
    const panFull = (panRecord as any)?.pan_full
    if (typeof panFull === "string" && panFull.length === 10) {
      customerPan = panFull
    }
  }

  const match = await extractCmrFingerprints({
    cmrFileUrl: input.cmr_file_url,
    pan: customerPan,
    depository: input.depository,
    boid: input.boid ?? null,
    dp_id: input.dp_id ?? null,
    client_id: input.client_id ?? null,
  }).catch(
    (err) =>
      ({
        pan_found: false,
        account_found: false,
        findings:
          input.depository === "CDSL"
            ? { kind: "cdsl" as const, boid_found: false }
            : {
                kind: "nsdl" as const,
                dp_id_found: false,
                client_id_found: false,
              },
        text_length: 0,
        auto_verified: false,
        reason: `matcher_threw:${(err as Error).message?.slice(0, 80) ?? "unknown"}`,
        candidates: { pans: [], boids: [], dpIds: [], clientIds: [] },
      } as Awaited<ReturnType<typeof extractCmrFingerprints>>),
  )

  // ── Block on confident mismatches BEFORE creating the row ──────
  //
  // The matcher pulls candidate identifiers from the PDF text.
  // Two refusals worth issuing here so the customer can fix their
  // input without an admin touching the queue:
  //
  //   pan_mismatch         — the PDF has a PAN, but it isn't the
  //                          customer's verified PAN. Almost
  //                          certainly someone else's CMR. Reject
  //                          and ask them to upload their own.
  //
  //   identifier_mismatch  — PDF has the customer's PAN, but the
  //                          typed BOID / DP-ID / Client-ID disagree
  //                          with what's in the document. Return the
  //                          actual values so the storefront can
  //                          surface a "did you mean X?" dialog
  //                          without forcing a re-upload or a re-
  //                          type of the (unrelated) PAN.
  //
  // Anything we can't confidently classify (image-only PDF, no
  // candidates, missing customer PAN on file) still falls through
  // to the existing manual-review path — better to under-block than
  // gate on noise.
  if (customerPan) {
    const pansInDoc = match.candidates.pans.map((p) => p.toUpperCase())
    if (
      pansInDoc.length > 0 &&
      !pansInDoc.includes(customerPan.toUpperCase())
    ) {
      return res.status(400).json({
        ok: false,
        reason: "pan_mismatch",
        message:
          "The PAN on the uploaded CMR doesn't match the PAN you verified earlier. " +
          "Upload your own CMR — using someone else's account is a compliance issue.",
        cmr_pan_masked: pansInDoc[0]
          ? `${pansInDoc[0].slice(0, 2)}****${pansInDoc[0].slice(-1)}`
          : null,
      })
    }
  }

  // Identifier mismatch — only when the PAN landed (so we know the
  // CMR really is the customer's) AND the document has at least one
  // depository-relevant candidate AND the typed value isn't among
  // them. If the PDF has no candidates of that shape (image-only or
  // unusual layout) we can't claim a mismatch — fall through to
  // manual review.
  if (match.pan_found && !match.account_found) {
    if (input.depository === "CDSL") {
      const boids = match.candidates.boids
      if (boids.length > 0 && !boids.includes(input.boid ?? "")) {
        return res.status(400).json({
          ok: false,
          reason: "identifier_mismatch",
          depository: "CDSL" as const,
          typed: { boid: input.boid ?? null },
          cmr_extracted: { boid: boids[0] },
          message:
            "The BO ID you entered doesn't match what we found on this CMR. " +
            "Use the value from the CMR or re-enter — your PAN and uploaded " +
            "file are kept.",
        })
      }
    } else {
      const dpIds = match.candidates.dpIds
      const clientIds = match.candidates.clientIds
      // Surface a mismatch only when at least one candidate of the
      // wrong-typed field exists. (E.g. customer typed correct DP-ID
      // but wrong Client-ID → return the extracted Client-ID.)
      const dpMismatch =
        dpIds.length > 0 &&
        !dpIds.map((d) => d.toUpperCase()).includes(
          (input.dp_id ?? "").toUpperCase(),
        )
      const cidMismatch =
        clientIds.length > 0 && !clientIds.includes(input.client_id ?? "")
      if (dpMismatch || cidMismatch) {
        return res.status(400).json({
          ok: false,
          reason: "identifier_mismatch",
          depository: "NSDL" as const,
          typed: {
            dp_id: input.dp_id ?? null,
            client_id: input.client_id ?? null,
          },
          cmr_extracted: {
            dp_id: dpIds[0] ?? null,
            client_id: clientIds[0] ?? null,
          },
          message:
            "The depository details you entered don't match what we found " +
            "on this CMR. Use the values from the CMR or re-enter — your PAN " +
            "and uploaded file are kept.",
        })
      }
    }
  }

  // Auto-promote to primary only when this is the customer's first
  // verified demat. Mirrors the manual-verify route's logic so the
  // KYC gate at checkout (has_primary_demat) flips on the first
  // auto-verified demat too.
  let shouldPromote = false
  if (match.auto_verified) {
    const existingDemats = (await walletModule
      .listDematAccounts({ customer_id: customerId } as any, { take: 50 } as any)
      .catch(() => [])) as any[]
    shouldPromote = !existingDemats.some(
      (d) =>
        d.verification_status === "verified" && d.is_primary === true,
    )
  }

  const verificationStatus: "verified" | "pending" = match.auto_verified
    ? "verified"
    : "pending"
  const verifiedAt = match.auto_verified ? new Date() : null

  // ── Global cmr_record upsert ────────────────────────────────────
  //
  // Mirrors the bank_record / pan_record / aadhaar_record pattern:
  // hash the depository fingerprint, upsert into the global registry,
  // and stamp the resulting `cmr_hash` onto this customer's
  // demat_account row. The registry survives customer hard-delete so
  // re-registration with the same demat reuses the same CMR file +
  // verification history.
  const cmrHash = walletModule.computeCmrHash({
    depository: input.depository,
    boid: input.boid,
    dp_id: input.dp_id,
    client_id: input.client_id,
  })
  if (cmrHash) {
    await walletModule
      .upsertCmrRecord({
        cmr_hash: cmrHash,
        depository: input.depository,
        cmr_masked: walletModule.buildCmrMasked({
          depository: input.depository,
          boid: input.boid,
          dp_id: input.dp_id,
          client_id: input.client_id,
        }),
        dp_id: input.dp_id ?? null,
        client_id: input.client_id ?? null,
        boid: input.boid ?? null,
        dp_name: input.dp_name,
        account_holder_name: input.account_holder_name,
        cmr_file_url: input.cmr_file_url,
        name_match_score: null,
        verification_status: verificationStatus,
        cashfree_reference_id: null,
        verification_raw: {
          auto_extracted: {
            pan_found: match.pan_found,
            account_found: match.account_found,
            findings: match.findings,
            text_length: match.text_length,
            ...(match.reason ? { reason: match.reason } : {}),
            had_pan_on_file: customerPan != null,
          },
          auto_verified: match.auto_verified,
          source: "store.demat-accounts.create",
          submitted_at: new Date().toISOString(),
        },
      })
      .catch((err: unknown) => {
        // Non-fatal — the customer-bound demat row still gets
        // created. The registry can be reconciled later via the
        // backfill script.
        logger.error("[cmr-registry] upsert failed (non-fatal)", {
          customer_id: customerId,
          cmr_hash: cmrHash,
          error: (err as Error).message,
        })
      })
  }

  const row = await walletModule.createDematAccounts({
    customer_id: customerId,
    depository: input.depository,
    dp_id: input.dp_id ?? null,
    client_id: input.client_id ?? null,
    boid: input.boid ?? null,
    dp_name: input.dp_name,
    account_holder_name: input.account_holder_name,
    cmr_file_url: input.cmr_file_url,
    cmr_hash: cmrHash,
    name_match_score: null,
    verification_status: verificationStatus,
    cashfree_reference_id: null,
    verification_raw: {
      auto_extracted: {
        pan_found: match.pan_found,
        account_found: match.account_found,
        // Tagged-union findings — only the depository's relevant
        // identifier(s) appear here. CDSL submissions get
        // `{kind: "cdsl", boid_found}`; NSDL gets
        // `{kind: "nsdl", dp_id_found, client_id_found}`. Avoids
        // writing `dp_id_found: false` for a CDSL row where DP-ID
        // was never sent.
        findings: match.findings,
        text_length: match.text_length,
        ...(match.reason ? { reason: match.reason } : {}),
        had_pan_on_file: customerPan != null,
      },
      auto_verified: match.auto_verified,
      manual_review: !match.auto_verified,
      submitted_at: new Date().toISOString(),
    },
    verified_at: verifiedAt,
    is_primary: shouldPromote,
  })

  // Audit row — `success` when the matcher cleared the bar, `pending`
  // otherwise. Mirrors the manual-verify route's audit shape so
  // /app/customer-360 → KYC reads correctly.
  await walletModule.createSecureIdVerifications({
    customer_id: customerId,
    kind: "cmr",
    reference_id: match.auto_verified
      ? `cmr_text_match:${Date.now()}`
      : null,
    status: match.auto_verified ? "success" : "pending",
    input_masked:
      input.boid ?? `${input.dp_id ?? ""}-${input.client_id ?? ""}`,
    response_raw: {
      auto_extracted: {
        pan_found: match.pan_found,
        account_found: match.account_found,
        findings: match.findings,
        text_length: match.text_length,
        ...(match.reason ? { reason: match.reason } : {}),
      },
      auto_verified: match.auto_verified,
      manual_review: !match.auto_verified,
    },
    expires_at: null,
    attempt_no: 1,
  })

  // Auto-verified post-side effects — same as the manual-verify
  // route fires on admin approval. Best-effort: each block soft-
  // fails so a non-blocking miss (gamification rate-limit, email
  // template missing, etc.) doesn't break the verify response.
  if (match.auto_verified) {
    await walletModule
      .captureHeldPaymentAttempts(customerId)
      .catch(() => {})
    await grantPointsForEvent({
      scope: req.scope,
      customer_id: customerId,
      event_kind: "kyc.cmr_verified",
      amount: 150,
      source: "KYC_STEP",
      reference_type: "demat_account",
      reference_id: row.id,
      idempotency_key: `KYC_STEP:cmr:${row.id}`,
      note: "Demat / CMR verified (auto, text-match)",
    }).catch(() => null)
    await sendEventEmail(req.scope, "demat.verified", {
      customer_id: customerId,
      dp_name: input.dp_name,
      client_id: input.client_id ?? "",
      depository: input.depository,
      reason: "Auto-verified — PAN and account ID matched the uploaded CMR.",
      demat_url: `${process.env.STOREFRONT_URL || "https://polemarch.in"}/dashboard/demat-accounts`,
    }).catch(() => {})
    // The CMR auto-verify might have just closed the KYC + bank +
    // demat trio. The admin-verify route already fires
    // `investing.ready` here — call the shared helper so the
    // customer-driven path fires the same celebratory email + SMS +
    // WhatsApp. Idempotent via `customer.metadata.investing_ready_notified_at`.
    await fireInvestingReadyIfReady(req.scope, customerId).catch(() => {})
  }

  // Open / piggyback a manual_kyc_request so the admin queue at
  // /app/manual-kyc surfaces this CMR submission alongside other
  // pending reviews. Skipped on the auto-verified path — there's
  // nothing for ops to review when the matcher already cleared
  // PAN + BOID/DP+Client against the uploaded CMR.
  if (!match.auto_verified) try {
    const [existingReq] = await walletModule.listManualKycRequests(
      { customer_id: customerId, status: "pending" },
      { take: 1 },
    )
    if (!existingReq) {
      await walletModule.createManualKycRequests({
        customer_id: customerId,
        customer_note:
          "[Auto-flagged] CMR / demat submitted. Cashfree CMR endpoint is not in our suite, so demat verification is manual-only. Approve via /app/customer-360 → Accounts → Verify, or reject with a reason and ping the customer.",
        status: "pending",
      })
    }
    // Notify ops so they don't have to poll the queue. Uses the same
    // `admin.new_manual_kyc_request` event the customer-initiated
    // request route emits — admins see one inbox.
    await sendEventEmail(req.scope, "admin.new_manual_kyc_request", {
      customer_id: customerId,
      customer_note:
        "[Auto-flagged] CMR / demat upload — depository=" +
        input.depository +
        ", dp=" +
        input.dp_name,
      admin_review_url: `${process.env.MEDUSA_ADMIN_URL || ""}/app/manual-kyc`,
    })
  } catch (e) {
    // Non-blocking: the demat row is already saved, so even if the
    // notification fan-out fails the customer-side state is fine and
    // ops can still find the row by polling the queue or via
    // /app/customer-360.
    logger.warn("demat manual-review fan-out failed (non-blocking)", {
      customer_id: customerId,
      error: (e as Error).message,
    })
  }

  // Gamification points are NOT awarded on submission — the manual-
  // verify route fires `kyc.cmr_verified` after admin approval. This
  // keeps the credit aligned with actual verification, not just upload.

  // Per-field verification summary for the storefront's success
  // panel. Lets the customer see "PAN matched ✓, BOID matched ✓"
  // explicitly instead of a generic "submitted" toast. Mirrors the
  // tagged-union shape of `match.findings` so the UI can render
  // depository-specific rows without checking irrelevant fields.
  const verification_summary =
    match.findings.kind === "cdsl"
      ? {
          depository: "CDSL" as const,
          pan_match: match.pan_found,
          boid_match: match.findings.boid_found,
          auto_verified: match.auto_verified,
        }
      : {
          depository: "NSDL" as const,
          pan_match: match.pan_found,
          dp_id_match: match.findings.dp_id_found,
          client_id_match: match.findings.client_id_found,
          auto_verified: match.auto_verified,
        }

  res.status(201).json({
    demat_account: {
      id: row.id,
      depository: row.depository,
      dp_id: row.dp_id,
      client_id: row.client_id,
      boid: row.boid,
      dp_name: row.dp_name,
      account_holder_name: row.account_holder_name,
      name_match_score: row.name_match_score,
      verification_status: row.verification_status,
      is_primary: row.is_primary,
    },
    verified: match.auto_verified,
    pending_review: !match.auto_verified,
    verification_summary,
    message: match.auto_verified
      ? input.depository === "CDSL"
        ? "Verified — PAN and BO ID both matched the uploaded CMR."
        : "Verified — PAN, DP-ID, and Client-ID all matched the uploaded CMR."
      : "Demat submitted for manual review. We typically approve within one business day; you'll get an email when it's done.",
  })
}
