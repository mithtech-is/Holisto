import { model } from "@medusajs/framework/utils"

/**
 * Global Aadhaar record — the authoritative cache of every Aadhaar
 * we've ever seen Cashfree confirm (via OTP verification on the
 * `/verification/offline-aadhaar/verify` endpoint).
 *
 * Same retention contract as `pan_record`:
 *   - Keyed on SHA-256 of the 12-digit Aadhaar number; the raw
 *     number is NEVER stored in plaintext.
 *   - One row per unique Aadhaar — multiple customers verifying
 *     the same Aadhaar (joint family share) reuse one row.
 *   - Survives customer deletion. The customer-purge SQL block
 *     does NOT touch this table.
 *
 * Linkage to customer: `customer.metadata.aadhaar_hash` carries
 * the same hash so admin Customer 360 can resolve "this customer's
 * Aadhaar record" via the global table without joining the audit
 * log. The audit row in `secure_id_verification` (kind=
 * "aadhaar_otp_verify") still records every attempt regardless.
 *
 * Storage: ~0.5 KB per record (smaller than PAN — fewer documented
 * fields). Trivial at scale.
 */
export const AadhaarRecord = model.define("aadhaar_record", {
  id: model.id().primaryKey(),

  /** SHA-256 hex of the 12-digit Aadhaar (whitespace stripped). Unique. */
  aadhaar_hash: model.text().unique().index(),

  /** "XXXX XXXX 1234" — last 4 digits visible. Safe for admin UI
   *  default state (rendered before the operator clicks Reveal). */
  aadhaar_masked: model.text(),

  /** FULL 12-digit Aadhaar — populated only after a successful OTP
   *  verify. Stored in plaintext per operator decision (2026-04-28);
   *  encryption to be added later. UIDAI Act §28 compliance: this
   *  field is exposed to admins via an explicit "Reveal" toggle in
   *  the registry UI; default state is masked. Never returned in
   *  the storefront API. */
  aadhaar_full: model.text().nullable(),

  // ─── Identity (always returned by Cashfree on success) ────────
  /** Holder name as registered with UIDAI. */
  name: model.text(),

  // ─── Demographics (from offline Aadhaar XML) ────────────────
  /** YYYY-MM-DD per UIDAI. String to preserve format. */
  date_of_birth: model.text().nullable(),
  /** "M" / "F" / "T" or full word — preserve Cashfree's format. */
  gender: model.text().nullable(),
  /** Father's / care-of name printed on the Aadhaar card. UIDAI's
   *  offline-Aadhaar XML calls this `care_of`; Cashfree echoes it as
   *  `father_name` in their JSON. Surfaced in admin registry for
   *  visual identity confirmation. */
  father_name: model.text().nullable(),

  // ─── Address (UIDAI structured address block) ─────────────────
  /** Combined / structured address — Cashfree returns the full
   *  XML address tree. We persist as jsonb so admin UI can render
   *  whichever fields landed (house / street / locality / city /
   *  state / pincode / country / vtc / etc.). */
  address: model.json().nullable(),

  // ─── Photo (Aadhaar offline returns a base64-encoded face) ────
  /** Set to true when Cashfree returned a photo. */
  has_photo: model.boolean().nullable(),
  /** Local /static URL of the Aadhaar photo (face crop) extracted
   *  from Cashfree's verify response. Persisted via polemarch.uploadLocal
   *  so we keep our own copy — Cashfree's response is the only place
   *  the photo lives at issue time, and we need it forever for:
   *    (a) the storefront profile-picture fallback chain
   *        (profile_photo → aadhaar_photo → avatar)
   *    (b) admin Customer-360 / Aadhaar registry visual identification.
   *  Nullable because pre-existing rows (verified before this column
   *  shipped) won't have one. */
  photo_url: model.text().nullable(),

  // ─── Cashfree audit pointers ─────────────────────────────────
  /** Cashfree-side ref_id from the OTP verify call that first
   *  cached this record. */
  cashfree_ref_id: model.text().nullable(),
  /** FULL Cashfree response — every field offline-Aadhaar OTP verify
   *  returned, unredacted. `aadhaar_record` is the global canonical
   *  cache: keyed by aadhaar_hash, never customer-bound, retained
   *  across customer purges. UIDAI compliance: the raw 12-digit
   *  Aadhaar is NOT in this blob (Cashfree only echoes masked last-4
   *  per UIDAI rules — the full number never leaves their gateway).
   *  The DPDP-redacted variant goes into
   *  `secure_id_verification.response_raw` (customer-bound audit
   *  log). */
  response_raw: model.json().nullable(),

  // ─── Lifecycle ────────────────────────────────────────────────
  first_verified_at: model.dateTime(),
  last_refreshed_at: model.dateTime(),
})
