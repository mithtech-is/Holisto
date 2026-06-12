import type { MedusaResponse } from "@medusajs/framework/http"

/**
 * Response envelope helpers for /admin and /store routes that have a
 * documented contract in @polemarch/api-contracts.
 *
 * Wire shape (Phase 5 of the architecture refactor):
 *   { ok: true,  data: T }
 *   { ok: false, code: string, message: string, details?: object }
 *
 * Status: opt-in per route. Routes call respondOk/respondErr (or are
 * wrapped in withEnvelope) to emit the envelope; routes that haven't
 * been migrated yet keep their legacy ad-hoc shapes. Future phases
 * widen the conformance ring as more contracts land in
 * @polemarch/api-contracts.
 *
 * NOT applied to webhook routes (/webhooks/calcula, /webhooks/cashfree/*).
 * Webhook receivers expect a silent 200 on success and a structured
 * { ok: false, reason } on recoverable failure (e.g. signature mismatch
 * during retry). Wrapping them would break upstream producers.
 */

/**
 * Send a 2xx envelope-wrapped success response.
 *
 *     respondOk(res, { verified: true, name_on_pan: "RAJESH SHARMA" })
 *
 * Status code defaults to 200 — pass a third argument for 201/202/etc.
 */
export function respondOk<T>(
    res: MedusaResponse,
    data: T,
    status = 200,
): MedusaResponse {
    return res.status(status).json({ ok: true, data })
}

/**
 * Send a non-2xx envelope-wrapped error response.
 *
 *     respondErr(res, 400, "kyc.pan.format_invalid",
 *                "PAN must be 10 chars: AAAAA9999A")
 *
 * `code` is the machine-readable identifier — stable across releases,
 * consumed by clients to switch on error reason. `message` is the
 * human-readable explanation safe to render in a UI. `details` carries
 * structured supplementary context (field-level validation errors,
 * remaining attempts, reset_at timestamps, etc.) — clients ignore
 * unknown keys for forward compat.
 */
export function respondErr(
    res: MedusaResponse,
    status: number,
    code: string,
    message: string,
    details?: Record<string, unknown>,
): MedusaResponse {
    const body: { ok: false; code: string; message: string; details?: Record<string, unknown> } = {
        ok: false,
        code,
        message,
    }
    if (details) body.details = details
    return res.status(status).json(body)
}
