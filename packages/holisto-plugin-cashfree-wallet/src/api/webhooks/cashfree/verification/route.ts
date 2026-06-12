import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import {
  CASHFREE_WALLET_MODULE,
  CashfreeWalletService,
} from "../../../../modules/cashfree_wallet"
import { verifyWebhookSignature } from "../../../../modules/cashfree_wallet/cashfree/signature"
import { redactSecureIdResponse } from "../../../../modules/cashfree_wallet/cashfree/secure-id"
import { sendEventEmail } from "../../../../lib/send-event-email"
import { logger } from "../../../../utils/logger"

/**
 * POST /webhooks/cashfree/verification
 *
 * Async Secure ID verification callbacks. Cashfree fires these for flows
 * that don't resolve synchronously — CMR extraction, some offline-Aadhaar
 * paths, and any long-running verification the Secure ID suite adds later.
 * Synchronous flows (sync PAN, Aadhaar OTP verify, bank penny-drop) are
 * handled inline by the store routes; when the same customer's sync +
 * async responses both land, the sync one wrote the final `SecureIdVerification`
 * status and the async handler here no-ops via the `pending` guard.
 *
 * Flow:
 *   1. Verify HMAC signature (timestamp + rawBody).
 *   2. Persist the raw event on `webhook_event` for audit — de-duped by
 *      event_id so Cashfree retries are idempotent.
 *   3. Match the payload's reference_id to a pending SecureIdVerification
 *      row. If found, flip status → success | failed, merge redacted
 *      response, fire the matching `kyc.*` email.
 *   4. If the flip completes a customer's KYC, capture any held payment
 *      attempts so in-flight orders can settle.
 */
/** GET /webhooks/cashfree/verification — reachability probe so
 *  Cashfree's URL-registration step accepts the endpoint before the
 *  signing secret has been saved in the admin UI. */
export const GET = async (_req: MedusaRequest, res: MedusaResponse) => {
  res.status(200).json({
    ok: true,
    endpoint: "cashfree.verification",
    method: "POST expected",
  })
}

export const POST = async (req: MedusaRequest, res: MedusaResponse) => {
  const walletModule = req.scope.resolve(
    CASHFREE_WALLET_MODULE
  ) as CashfreeWalletService

  // Cashfree's 2025-01-01 API adds an informational `x-webhook-version`
  // header. The signing scheme (timestamp + rawBody → HMAC-SHA256,
  // base64) is stable across versions so no branching is needed.
  const webhookVersion =
    (req.headers["x-webhook-version"] as string | undefined) ?? "legacy"

  // Cashfree's Verification Suite is the unusual product that signs
  // webhooks with the API client_secret rather than a dashboard-issued
  // webhook-specific secret. `getWebhookSecret("verification")` falls
  // back to client_secret when no explicit webhook_secret is stored,
  // which is the documented merchant setup.
  //   https://www.cashfree.com/docs/api-reference/vrs/webhook-signature-verification
  // So reaching `!secret` here now means neither a webhook_secret nor a
  // client_secret is configured — i.e. the VRS product isn't wired at
  // all. Accept the probe without verification so Cashfree's
  // URL-registration step can succeed before admin credentials are
  // pasted, and log so ops can see there's still wiring to do.
  const secret = await walletModule.getWebhookSecret("verification")
  if (!secret) {
    logger.warn(
      "verification webhook: no credentials (client_secret + webhook_secret both unset) — accepting without verification"
    )
    return res
      .status(200)
      .json({ ok: true, warning: "secret_not_configured" })
  }
  const rawBody =
    (req as any).rawBody !== undefined
      ? (req as any).rawBody
      : JSON.stringify(req.body ?? {})

  // Cashfree dashboard's "Add Webhook Endpoint" → "Test" button sends
  // a probe POST BEFORE the signing secret exists. Same reachability
  // pattern as the payment-gateway route — see comment there.
  const sigHeader = req.headers["x-webhook-signature"]
  if (!sigHeader) {
    logger.warn(
      "verification webhook: POST received with no signature header — treating as Cashfree reachability test",
      { webhookVersion },
    )
    return res.status(200).json({
      ok: true,
      warning: "no_signature_treated_as_reachability_test",
    })
  }

  const verify = verifyWebhookSignature({
    rawBody,
    signatureHeader: sigHeader,
    timestampHeader: req.headers["x-webhook-timestamp"],
    secret,
  })
  if (verify.ok !== true) {
    const reason = verify.reason
    logger.warn("verification webhook: signature rejected", {
      reason,
      webhookVersion,
    })
    return res.status(401).json({ ok: false, reason })
  }

  const payload =
    (typeof rawBody === "string"
      ? safeParse(rawBody)
      : safeParse(rawBody.toString("utf8"))) || (req.body as Record<string, unknown>) || {}
  const eventId = String(
    (payload as any).event_id ??
      (payload as any).reference_id ??
      (payload as any).verification_id ??
      `${Date.now()}_${Math.random().toString(36).slice(2)}`
  )
  try {
    await walletModule.createWebhookEvents({
      channel: "verification",
      event_id: eventId,
      event_type: String((payload as any).event ?? (payload as any).type ?? "verification"),
      signature: String(req.headers["x-webhook-signature"] ?? "") || null,
      payload_raw: payload as Record<string, unknown>,
      processing_status: "received",
    })
  } catch (err) {
    if (isUniqueViolation(err)) {
      return res.status(200).json({ ok: true, idempotent_replay: true })
    }
    logger.error("verification webhook: persist failed", { error: err })
    return res.status(500).json({ ok: false })
  }

  // ── Phase-5: flip SecureIdVerification.status from the callback ──
  //
  // Matching rules:
  //   - Cashfree echoes our request's `verification_id` as `reference_id`
  //     (or occasionally `cf_reference_id`) in the async payload. We stored
  //     that value in `secure_id_verification.reference_id` when we made
  //     the original request, so a single list-by-reference_id hits the
  //     right row.
  //   - Status mapping: Cashfree uses `status` = SUCCESS | FAILED | EXPIRED
  //     | UNDER_VERIFICATION across the Verification Suite. Anything that
  //     isn't clearly success gets mapped to "failed" so downstream gates
  //     don't wait on an ambiguous state.
  //
  // The whole block is wrapped in try/catch — failing to flip status
  // must NOT 500 to Cashfree, or they'll retry forever and fill the
  // audit log. We already persisted the event above, so a log+swallow
  // is safe; ops can re-run the match via an admin tool later.
  try {
    const refId = String(
      (payload as any).reference_id ??
        (payload as any).cf_reference_id ??
        (payload as any).verification_id ??
        "",
    )
    if (refId) {
      const matches = await walletModule.listSecureIdVerifications(
        { reference_id: refId },
        { take: 1 },
      )
      const existing = matches[0]
      if (existing && existing.status === "pending") {
        const statusRaw = String(
          (payload as any).status ??
            (payload as any).verification_status ??
            "",
        ).toUpperCase()
        const nextStatus: "success" | "failed" =
          statusRaw === "SUCCESS" || statusRaw === "VALID" || statusRaw === "VERIFIED"
            ? "success"
            : "failed"
        const merged = {
          ...((existing.response_raw as Record<string, unknown>) ?? {}),
          callback: redactSecureIdResponse(
            payload as Record<string, unknown>,
          ),
        }
        await walletModule.updateSecureIdVerifications(
          { id: existing.id },
          {
            status: nextStatus,
            response_raw: merged,
          },
        )

        // Fire the customer-facing kyc.* email that the sync flows would
        // have fired. Best-effort: don't block the webhook reply on the
        // email stack.
        const emailSlug = emailSlugForKind(
          String(existing.kind),
          nextStatus,
        )
        if (emailSlug && existing.customer_id) {
          try {
            await sendEventEmail(req.scope, emailSlug, {
              customer_id: existing.customer_id,
              reference_id: refId,
              reason:
                nextStatus === "failed"
                  ? String((payload as any).message ?? statusRaw ?? "Verification failed")
                  : undefined,
            })
          } catch (emailErr) {
            logger.warn("verification webhook: email dispatch failed", {
              error: (emailErr as Error).message,
              reference_id: refId,
              kind: existing.kind,
            })
          }
        }

        // If the flip completes the customer's KYC, drain any orders
        // that were parked on the held-orders queue waiting for KYC.
        if (nextStatus === "success" && existing.customer_id) {
          try {
            await walletModule.captureHeldPaymentAttempts(
              existing.customer_id,
            )
          } catch (captureErr) {
            logger.warn("verification webhook: held capture failed", {
              error: (captureErr as Error).message,
              customer_id: existing.customer_id,
            })
          }
        }
      }
    }
  } catch (err) {
    logger.error("verification webhook: status flip failed (event persisted)", {
      error: (err as Error).message,
      event_id: eventId,
    })
  }

  return res.status(200).json({ ok: true })
}

/** Map SecureIdVerification.kind + result to the polemarch_communication
 *  event slug. Kinds / slugs seeded in
 *  `polemarch_communication/seed/default-templates.ts` — anything not
 *  mapped here returns null and the email hop is skipped. */
function emailSlugForKind(
  kind: string,
  status: "success" | "failed",
): string | null {
  if (kind === "pan") {
    return status === "success" ? "kyc.pan_approved" : "kyc.pan_rejected"
  }
  if (kind === "aadhaar_otp_verify") {
    return status === "success"
      ? "kyc.aadhaar_approved"
      : "kyc.aadhaar_rejected"
  }
  if (kind === "bank_penny") {
    return status === "success"
      ? "kyc.bank_verified"
      : "kyc.bank_rejected"
  }
  // CMR webhook branch removed — Cashfree CMR isn't in our suite.
  // `kyc.cmr_verified` still fires, but only from the manual admin
  // approval path (POST /admin/demat-accounts/:id/verify).
  return null
}

function safeParse(s: string): Record<string, unknown> | null {
  try {
    return JSON.parse(s) as Record<string, unknown>
  } catch {
    return null
  }
}
function isUniqueViolation(err: unknown): boolean {
  const e = err as { code?: string; message?: string }
  return (
    e?.code === "23505" ||
    (typeof e?.message === "string" &&
      /duplicate key|unique constraint/i.test(e.message))
  )
}
