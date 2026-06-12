import { createHmac, timingSafeEqual } from "node:crypto"

/**
 * Cashfree webhook signature verifier.
 *
 * Cashfree signs webhook deliveries with HMAC-SHA256 over (timestamp || rawBody)
 * using the merchant secret. The signature is sent base64-encoded in
 * `x-webhook-signature`, the timestamp as unix seconds in `x-webhook-timestamp`.
 *
 * We:
 *   1. Reject if either header is missing.
 *   2. Reject if |now - timestamp| > MAX_SKEW_SECONDS (replay window).
 *   3. Compute HMAC and timing-safe compare.
 *
 * The `rawBody` MUST be the exact bytes Cashfree posted — DO NOT pass a
 * re-stringified parsed object, as JSON re-serialisation can change bytes
 * (key order, whitespace) and break the signature.
 */

export const MAX_WEBHOOK_SKEW_SECONDS = 5 * 60 // 5 minutes

export type SignatureVerifyResult =
  | { ok: true }
  | {
      ok: false
      reason:
        | "missing_signature"
        | "missing_timestamp"
        | "invalid_timestamp"
        | "stale_timestamp"
        | "signature_mismatch"
        | "missing_secret"
    }

export function verifyWebhookSignature(input: {
  rawBody: string | Buffer
  signatureHeader: string | string[] | undefined
  timestampHeader: string | string[] | undefined
  secret: string
  /** Override "now" — for tests */
  now?: number
}): SignatureVerifyResult {
  if (!input.secret) return { ok: false, reason: "missing_secret" }
  const sig = pickSingle(input.signatureHeader)
  const ts = pickSingle(input.timestampHeader)
  if (!sig) return { ok: false, reason: "missing_signature" }
  if (!ts) return { ok: false, reason: "missing_timestamp" }

  const tsNum = Number(ts)
  if (!Number.isFinite(tsNum)) return { ok: false, reason: "invalid_timestamp" }
  const nowSec = Math.floor((input.now ?? Date.now()) / 1000)
  if (Math.abs(nowSec - tsNum) > MAX_WEBHOOK_SKEW_SECONDS) {
    return { ok: false, reason: "stale_timestamp" }
  }

  const bodyStr =
    typeof input.rawBody === "string"
      ? input.rawBody
      : input.rawBody.toString("utf8")
  const expectedB64 = createHmac("sha256", input.secret)
    .update(ts + bodyStr)
    .digest("base64")

  // timingSafeEqual requires equal-length buffers
  const expected = Buffer.from(expectedB64, "utf8")
  const provided = Buffer.from(sig, "utf8")
  if (expected.length !== provided.length) {
    return { ok: false, reason: "signature_mismatch" }
  }
  if (!timingSafeEqual(expected, provided)) {
    return { ok: false, reason: "signature_mismatch" }
  }
  return { ok: true }
}

function pickSingle(h: string | string[] | undefined): string | undefined {
  if (!h) return undefined
  if (Array.isArray(h)) return h[0]
  return h
}
