import { model } from "@medusajs/framework/utils"

/**
 * Global bank-account record — authoritative cache of every bank
 * account we've ever confirmed via Cashfree's BAV v2 sync
 * (`/verification/bank-account/sync`, x-api-version: 2024-01-01).
 *
 * Same retention contract as `pan_record` / `aadhaar_record`:
 *   - Keyed on SHA-256 of `(ifsc + ":" + account_number)` — neither
 *     the raw account number nor IFSC alone are unique.
 *   - One row per unique (IFSC, account number) pair. Multiple
 *     customers verifying the same account (rare, AML-flagged
 *     elsewhere) share one row.
 *   - Survives customer deletion. The customer-purge SQL block does
 *     NOT touch this table.
 *
 * Linkage: per-customer `bank_account.bank_hash` carries the same
 * hash so admin Customer 360 / `/app/bank-records` can resolve a
 * customer's verified banks via the registry without joining the
 * audit log. The customer-bound `secure_id_verification` row
 * (kind="bank_penny") records every attempt regardless.
 *
 * IFSC details (bank, branch, address, city, state, swift_code,
 * micr, nbin) come from Cashfree's v2 response `ifsc_details` and
 * are persisted as a JSON blob — same fields Razorpay's free IFSC
 * API returns, so admins can cross-reference. We also keep the
 * full unredacted Cashfree response on `response_raw` for dispute
 * resolution.
 */
export const BankRecord = model.define("bank_record", {
  id: model.id().primaryKey(),

  /** SHA-256 hex of `(ifsc + ":" + account_number)`. Unique per
   *  global record. Collisions are vanishingly small (~2^-256). */
  bank_hash: model.text().unique().index(),

  /** "XXXXXX1234" — last 4 visible. Safe for admin UI default. */
  account_number_masked: model.text(),
  /** FULL account number — populated only after a successful BAV v2
   *  verify. Per the same operator decision used for PAN / Aadhaar
   *  (2026-04-28): plaintext, with admin Reveal toggle gating display.
   *  Encryption to be added later. Never returned in storefront API. */
  account_number_full: model.text().nullable(),
  /** IFSC as typed; uppercase. */
  ifsc: model.text().index(),

  // ─── BAV v2 outcome ──────────────────────────────────────────
  /** "VALID" / "INVALID" — top-level verification verdict. */
  account_status: model.text().nullable(),
  /** Specific Cashfree status code:
   *    ACCOUNT_IS_VALID, INVALID_ACCOUNT_FAIL, ACCOUNT_BLOCKED,
   *    INVALID_IFSC_FAIL, NRE_ACCOUNT_FAIL, …
   */
  account_status_code: model.text().nullable(),

  // ─── Identity (always returned by Cashfree on success) ────────
  /** Holder name as registered with the bank. */
  name_at_bank: model.text().nullable(),
  /** DIRECT_MATCH / GOOD_PARTIAL_MATCH / MODERATE_PARTIAL_MATCH /
   *  POOR_PARTIAL_MATCH / NO_MATCH (BAV v2 vocab). */
  name_match_result: model.text().nullable(),
  /** 0–100 numeric score (string in the wire payload, normalised
   *  to number when parseable). */
  name_match_score: model.number().nullable(),

  // ─── Bank metadata (BAV v2 + IFSC details) ────────────────────
  bank_name: model.text().nullable(),
  branch: model.text().nullable(),
  city: model.text().nullable(),
  /** MICR code. Keep as text since some Cashfree responses pad it
   *  with leading zeros that lose meaning when coerced to integer. */
  micr: model.text().nullable(),
  /** SWIFT (BIC) code from ifsc_details. */
  swift_code: model.text().nullable(),
  /** NBIN — sub-bank routing identifier. */
  nbin: model.text().nullable(),
  /** Bank category — "Public Sector", "Private", etc. */
  category: model.text().nullable(),
  /** Full structured IFSC payload (state/district/address/etc.) —
   *  retained whole so future fields surface without schema migration. */
  ifsc_details: model.json().nullable(),

  // ─── Cashfree audit pointers ─────────────────────────────────
  /** Cashfree-side reference_id of the verifying call. */
  cashfree_ref_id: model.text().nullable(),
  /** Bank-side UTR for the test debit, when Cashfree returned one. */
  utr: model.text().nullable(),
  /** Full UNREDACTED Cashfree response. `bank_record` is the global
   *  canonical cache (keyed by bank_hash, never customer-bound,
   *  retained across customer purges) — same contract as pan_record.
   *  The DPDP-redacted variant goes into
   *  `secure_id_verification.response_raw` (customer-bound audit log). */
  response_raw: model.json().nullable(),

  // ─── Lifecycle ────────────────────────────────────────────────
  first_verified_at: model.dateTime(),
  last_refreshed_at: model.dateTime(),
})
