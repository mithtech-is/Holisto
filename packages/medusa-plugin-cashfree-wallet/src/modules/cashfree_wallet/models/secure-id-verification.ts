import { model } from "@medusajs/framework/utils"

/**
 * An individual Cashfree Secure ID verification attempt. One row per
 * (customer, verification kind, attempt). Kept for audit + status queries +
 * rate limiting (count recent rows per customer per kind).
 *
 * `input_masked` holds a masked version of the PII input — e.g.
 * `ABCDE****F` for PAN, `XXXX-XXXX-1234` for Aadhaar — never the raw value.
 * Raw inputs are never stored.
 *
 * `response_raw` holds the Cashfree response with PII redacted before
 * insert (see service.redactSecureIdResponse).
 */
export const SecureIdVerification = model.define("secure_id_verification", {
  id: model.id().primaryKey(),
  customer_id: model.text().index(),
  kind: model.enum([
    "pan",
    "aadhaar_otp_send",
    "aadhaar_otp_verify",
    "bank_penny",
    "cmr",
  ]),
  reference_id: model.text().nullable(),
  status: model.enum(["pending", "success", "failed"]).default("pending"),
  input_masked: model.text().nullable(),
  response_raw: model.json().nullable(),
  expires_at: model.dateTime().nullable(),
  attempt_no: model.number().default(1),
})
