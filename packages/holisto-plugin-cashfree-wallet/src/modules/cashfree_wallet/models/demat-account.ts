import { model } from "@medusajs/framework/utils"

/**
 * Customer demat account (CMR — Client Master Report). Multiple allowed per
 * customer; exactly one is_primary=true per customer enforced via a partial
 * unique index (see migration). All CMRs must be in the customer's own name,
 * verified against the PAN name via Cashfree CMR verification API.
 *
 * `boid` is the 16-digit CDSL ID; `dp_id`/`client_id` is the NSDL split
 * (IN + 8 digit DP + 8 digit client). One of the pair is populated based on
 * `depository`.
 */
export const DematAccount = model.define("demat_account", {
  id: model.id().primaryKey(),
  customer_id: model.text().index(),
  depository: model.enum(["NSDL", "CDSL"]),
  dp_id: model.text().nullable(),
  client_id: model.text().nullable(),
  boid: model.text().nullable(),
  dp_name: model.text(),
  account_holder_name: model.text(),
  cmr_file_url: model.text(),
  name_match_score: model.number().nullable(),
  verification_status: model
    .enum(["pending", "verified", "failed", "name_mismatch"])
    .default("pending"),
  cashfree_reference_id: model.text().nullable(),
  verification_raw: model.json().nullable(),
  verified_at: model.dateTime().nullable(),
  is_primary: model.boolean().default(false),
  /** Pointer to the global `cmr_record` row for this demat — same
   *  hash semantics as `bank_account.bank_hash`. Lets admin
   *  Customer 360 + the cmr registry resolve "this customer's
   *  verified demats" without joining the audit log. Nullable for
   *  legacy rows verified before the cmr registry shipped (see
   *  scripts/backfill-cmr-registry.ts). */
  cmr_hash: model.text().index().nullable(),
})
