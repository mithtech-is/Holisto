import { model } from "@medusajs/framework/utils"

/**
 * Customer bank account used for wallet deposit. All customer bank accounts
 * must be in the customer's own name — verified via Cashfree penny-drop
 * (name-match score).
 *
 * `account_number_encrypted` is base64(aes-256-gcm) — see
 * `src/modules/cashfree_wallet/cashfree/crypto.ts`. `account_number_last4`
 * is always safe to display. `is_primary` is an application-level flag; at
 * most one per customer.
 */
export const BankAccount = model.define("bank_account", {
  id: model.id().primaryKey(),
  customer_id: model.text().index(),
  account_holder_name: model.text(),
  account_number_encrypted: model.text(),
  account_number_last4: model.text(),
  ifsc: model.text(),
  bank_name: model.text().nullable(),
  name_match_score: model.number().nullable(),
  verification_status: model
    .enum(["pending", "verified", "failed", "name_mismatch"])
    .default("pending"),
  cashfree_reference_id: model.text().nullable(),
  verification_raw: model.json().nullable(),
  verified_at: model.dateTime().nullable(),
  is_primary: model.boolean().default(false),
  /** Pointer to the global `bank_record` row for this (IFSC, account
   *  number) — same hash semantics as `customer.metadata.aadhaar_hash`
   *  / `pan_hash`. Lets admin Customer-360 + the bank registry
   *  resolve "this customer's verified bank" without joining the
   *  audit log. Nullable for legacy rows verified before the bank
   *  registry shipped. */
  bank_hash: model.text().index().nullable(),
  /**
   * Optional proof document for this bank account. Accepted types:
   *   - "cheque"     — cancelled cheque
   *   - "passbook"   — front page of the passbook
   *   - "statement"  — last 6-month bank statement
   *
   * Not required for any transactional flow — kept for admin review /
   * manual verification audit. The `bank_proof_type` mirrors the user's
   * selection at upload time.
   */
  bank_proof_file_url: model.text().nullable(),
  bank_proof_type: model.enum(["cheque", "passbook", "statement"]).nullable(),
})
