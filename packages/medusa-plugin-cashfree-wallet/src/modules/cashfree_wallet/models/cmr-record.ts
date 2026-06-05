import { model } from "@medusajs/framework/utils"

/**
 * Global CMR (Client Master Report) record — authoritative cache of
 * every demat account we've ever ingested via the customer-facing
 * demat-add path. Same retention contract as `pan_record` /
 * `aadhaar_record` / `bank_record`:
 *
 *   - Keyed on SHA-256 of a normalised depository identifier:
 *       CDSL → "cdsl|<boid>"
 *       NSDL → "nsdl|<dp_id>|<client_id>"
 *     One row per real demat account; multiple customers verifying
 *     the same demat share one row (cross-customer dedupe still
 *     prevents simultaneous claim — see store/demat-accounts/route.ts).
 *   - Survives customer deletion. The DPDP §12 erasure pipeline does
 *     NOT touch this table; only the customer-bound `demat_account`
 *     row + the customer's other uploaded docs go.
 *   - The `cmr_file_url` here is the canonical pointer to the CMR
 *     PDF in `/static/`; that file is also preserved across erasure
 *     (see static_files.scrub in hard-delete-customer.ts).
 *
 * Linkage: per-customer `demat_account.cmr_hash` carries the same
 * hash so admin Customer 360 can resolve a customer's verified
 * demats via the registry without joining the audit log.
 */
export const CmrRecord = model.define("cmr_record", {
  id: model.id().primaryKey(),

  /** SHA-256 hex of the normalised depository identifier. Unique per
   *  global record. */
  cmr_hash: model.text().unique().index(),

  depository: model.enum(["NSDL", "CDSL"]),

  /** Display mask, safe for admin tables.
   *    CDSL → "CDSL · XXXXXXXXXXXX9876"  (last 4 visible)
   *    NSDL → "NSDL · IN3XXXXX/XXXX5678" (last 4 of each)              */
  cmr_masked: model.text(),

  /** FULL identifiers — populated only after a successful CMR ingest.
   *  Same operator decision as PAN / Aadhaar / Bank (2026-04-28):
   *  plaintext today with admin Reveal toggle gating display.
   *  Encryption to be added later. Never returned in storefront API. */
  dp_id: model.text().nullable(),
  client_id: model.text().nullable(),
  boid: model.text().nullable(),

  /** Registered DP / holder name as recorded in the CMR. */
  dp_name: model.text(),
  account_holder_name: model.text(),

  /** Pointer to the CMR PDF in `/static/`. Retained across customer
   *  erasure (regulator). Updated on re-verify. */
  cmr_file_url: model.text(),

  /** 0–100, when computed against the customer's PAN-registered name
   *  during upload. Mirrors bank_record.name_match_score. */
  name_match_score: model.number().nullable(),

  /** Last terminal verification verdict for this CMR globally.
   *  pending / verified / failed / name_mismatch. */
  verification_status: model
    .enum(["pending", "verified", "failed", "name_mismatch"])
    .default("pending"),

  /** Cashfree-side reference id of the verifying call, when one was
   *  made. Null when admin manual-verified. */
  cashfree_reference_id: model.text().nullable(),

  /** Full UNREDACTED Cashfree response, when applicable. Same
   *  contract as bank_record.response_raw. */
  verification_raw: model.json().nullable(),

  /** Lifecycle. */
  first_verified_at: model.dateTime().nullable(),
  last_refreshed_at: model.dateTime(),
})
