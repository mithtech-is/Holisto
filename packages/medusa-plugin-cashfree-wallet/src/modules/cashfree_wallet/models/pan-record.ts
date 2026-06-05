import { model } from "@medusajs/framework/utils"

/**
 * Global PAN record — the authoritative cache of every PAN we've
 * ever seen Cashfree confirm.
 *
 * Keyed on the SHA-256 of the uppercase PAN — we never store the
 * PAN itself in plaintext. The masked form (`pan_masked`, e.g.
 * "ABCDE****F") is kept for human-readable reference.
 *
 * IMPORTANT — retention semantics:
 *   This table outlives customers. When a customer account is
 *   purged (soft-delete on `customer`), the PAN record they
 *   verified STAYS. Two reasons:
 *     1. Cost: a PAN 360 call is paid; throwing the data away
 *        when a customer leaves means we'd pay again on next
 *        sign-up with the same PAN.
 *     2. Source-of-truth: the data describes a real human's
 *        ITD record, not the customer-platform relationship.
 *        Their PAN holder name doesn't change because they
 *        deleted their Polemarch account.
 *
 *   The customer-purge SQL block in scripts / docs MUST NOT
 *   touch this table. It's globally scoped, indexed by PAN hash.
 *
 * Linkage to customer: each `secure_id_verification` audit row
 * carries the same `pan_hash` (set on customer.metadata.pan_hash
 * at verify time), so you can trace "which customer triggered
 * this PAN's first lookup" via that audit table — but the row
 * here remains regardless.
 *
 * Storage: ~1 KB per record. Even at 100k unique PANs that's
 * 100 MB — trivial vs. the orders / wallet tables.
 */
export const PanRecord = model.define("pan_record", {
  id: model.id().primaryKey(),

  /** SHA-256 hex of the uppercase, trimmed PAN. Unique. */
  pan_hash: model.text().unique().index(),

  /** "ABCDE****F" — first 5 + last 1 of the PAN, middle masked.
   *  Safe to display in admin UI for "I'm looking at the row for
   *  PAN starting with ABCDE..." identification. */
  pan_masked: model.text(),

  /** FULL 10-character PAN — populated only after a successful verify
   *  (forward-only, added 2026-05-06). Stored plaintext to mirror the
   *  `aadhaar_record.aadhaar_full` retention contract — also exposed
   *  to admins via the registry's "Reveal" toggle, never returned by
   *  storefront APIs. The reason we keep it: Cashfree's PG-VBA
   *  `kyc_details` block on `/pg/vba` (and the PUT update endpoint)
   *  takes the full PAN, and we don't want to re-prompt the customer
   *  every time we mint or sync a VBA. Existing rows from before this
   *  field landed will have `null` here — those customers' VBAs
   *  won't carry PAN on Cashfree's side until they re-verify. */
  pan_full: model.text().nullable(),

  // ─── Identity ──────────────────────────────────────────────────
  /** Name as registered with the Income Tax Department.
   *  Always present on a successful verify. */
  registered_name: model.text(),
  /** Name as printed on the physical PAN card. May differ from
   *  `registered_name` (post-marriage rename, transliteration). */
  name_pan_card: model.text().nullable(),
  /** First name as Cashfree splits the registered name. */
  first_name: model.text().nullable(),
  /** Last name as Cashfree splits the registered name. */
  last_name: model.text().nullable(),
  /** PAN holder category — "Individual or Person", "Company", "HUF", etc. */
  pan_type: model.text().nullable(),
  /** Father's name (PAN Basic / 360 returns this when available). */
  father_name: model.text().nullable(),

  // ─── Card lifecycle ────────────────────────────────────────────
  /** "VALID" / "INVALID" / "DELETED" / "DEACTIVATED" / "MARKED_DECEASED". */
  pan_status: model.text().nullable(),
  /** Date IT Dept last updated this PAN record (string from
   *  Cashfree, format varies). */
  last_updated_at_itd: model.text().nullable(),

  // ─── Aadhaar linkage ───────────────────────────────────────────
  /** Boolean from PAN 360. True = linked, false = not linked,
   *  null = field not returned by tier. */
  aadhaar_linked: model.boolean().nullable(),
  /** "Y" / "R" / "NA" string from PAN Basic. */
  aadhaar_seeding_status: model.text().nullable(),
  /** Human-readable equivalent. */
  aadhaar_seeding_status_desc: model.text().nullable(),
  /** Last 4 digits of linked Aadhaar (e.g. "XXXXXXXX8848"). */
  masked_aadhaar: model.text().nullable(),

  // ─── Demographics (PAN 360, ~45% fill rate) ────────────────────
  /** "Male" / "Female" / "Transgender" / etc. */
  gender: model.text().nullable(),
  /** DOB as Cashfree returns it ("DD-MM-YYYY"). String to preserve
   *  the source format without forcing a re-parse. */
  date_of_birth: model.text().nullable(),

  // ─── Contact (PAN 360, masked, ~45% fill rate) ─────────────────
  /** e.g. "a*c@gmail.com". */
  email_masked: model.text().nullable(),
  /** e.g. "99XXXXXX99". */
  phone_masked: model.text().nullable(),

  // ─── Address (PAN 360 structured object) ──────────────────────
  /** { full_address, street, city, state, pincode, country } */
  address: model.json().nullable(),

  // ─── Match grading at first verify ────────────────────────────
  /** 0..1 token-overlap ratio between the typed name + registered
   *  name on the call that first cached this record. Diagnostic. */
  name_match_score_initial: model.number().nullable(),
  /** "EXACT_MATCH" / "GOOD_PARTIAL_MATCH" / "POOR_PARTIAL_MATCH"
   *  / "NO_MATCH" — same call as `name_match_score_initial`. */
  name_match_result_initial: model.text().nullable(),

  // ─── Cashfree audit pointers ──────────────────────────────────
  /** Cashfree's reference_id from the call that first cached this
   *  record. Useful when raising support tickets. */
  cashfree_reference_id: model.text().nullable(),
  /** Caller-supplied verification_id from the same call (PAN 360
   *  required field). */
  cashfree_verification_id: model.text().nullable(),
  /** FULL Cashfree response — every field PAN 360 / Advance / Basic
   *  returned, unredacted. `pan_record` is the global canonical cache:
   *  keyed by pan_hash, never customer-bound, retained across customer
   *  purges. The DPDP-redacted variant goes into
   *  `secure_id_verification.response_raw` (customer-bound, audit log).
   *  Storing the full payload here means a new field Cashfree starts
   *  returning is captured automatically — we don't silently lose it
   *  just because no typed column exists for it yet. */
  response_raw: model.json().nullable(),

  // ─── Lifecycle ────────────────────────────────────────────────
  /** Timestamp of the very first successful verify that cached
   *  this PAN. Never updated — `last_refreshed_at` tracks subsequent
   *  re-verifies. */
  first_verified_at: model.dateTime(),
  /** Updated whenever a fresh Cashfree call lands for this PAN
   *  (e.g. admin "force re-verify" — out of scope today; future). */
  last_refreshed_at: model.dateTime(),
})
