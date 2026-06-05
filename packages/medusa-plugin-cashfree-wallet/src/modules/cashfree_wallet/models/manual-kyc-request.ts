import { model } from "@medusajs/framework/utils"

/**
 * A customer-initiated request for admin to manually review KYC. Used when
 * Cashfree Secure ID isn't available (e.g. sandbox without activation) or
 * a customer's documents can't be machine-verified.
 *
 * The customer is expected to have already uploaded the relevant documents
 * (PAN card, Aadhaar card, CMR, bank proof). Those live on:
 *   - `customer.metadata.pan_card_file_url`
 *   - `customer.metadata.aadhaar_card_file_url`
 *   - `demat_account.cmr_file_url`
 *   - `bank_account.bank_proof_file_url`
 *
 * When an admin approves the request, the `POST /admin/customers/:id/
 * kyc/manual` and `/admin/bank-accounts/:id/verify` etc. routes do the
 * actual flag flipping. This table is just the inbox + audit trail.
 */
export const ManualKycRequest = model.define("manual_kyc_request", {
  id: model.id().primaryKey(),
  customer_id: model.text().index(),
  customer_note: model.text().nullable(),
  status: model
    .enum(["pending", "approved", "rejected", "cancelled"])
    .default("pending"),
  reviewer_user_id: model.text().nullable(),
  reviewer_notes: model.text().nullable(),
  reviewed_at: model.dateTime().nullable(),
})
