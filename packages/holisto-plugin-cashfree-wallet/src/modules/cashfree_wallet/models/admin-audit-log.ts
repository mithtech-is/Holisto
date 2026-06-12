import { model } from "@medusajs/framework/utils"

/**
 * Append-only audit log for sensitive admin actions on customer data.
 *
 * Every mutation from the Customer 360 admin UI (KYC edit, wallet
 * adjust, freeze/unfreeze, bank/demat verify, referral reverse, etc.)
 * writes a row here. The before/after JSON lets us reconstruct the
 * full state change for compliance review.
 *
 * Never mutate or delete rows — this table is write-only from the
 * application side.
 */
export const AdminAuditLog = model.define("admin_audit_log", {
  id: model.id().primaryKey(),
  /** The admin user who performed the action. From req.auth_context.actor_id. */
  admin_user_id: model.text().index(),
  /** The customer whose data was mutated. Nullable for non-customer-scoped actions. */
  customer_id: model.text().index().nullable(),
  /** Action type — keep this enum tight and expand deliberately. */
  action: model.enum([
    "kyc_edit",
    "kyc_approve",
    "kyc_reject",
    "wallet_adjust",
    "wallet_freeze",
    "wallet_unfreeze",
    // Manual deposit recheck triggered from /admin/customers/:id/sync-wallet
    // (Customer-360 → Bank & Demat → "Recheck deposits"). Records new
    // credit count / total paise / TPV failures in `after_json`.
    "wallet_sync",
    "bank_verify",
    "bank_edit",
    "bank_delete",
    "demat_verify",
    "demat_edit",
    "demat_delete",
    "demat_set_primary",
    "referral_reverse",
    "order_cancel",
    "deposit_proof_decide",
    "company_request_decide",
    "document_upload",
    "document_delete",
    "customer_edit",
    // DPDP §12 erasure trigger — /admin/customers/:id/hard-delete.
    // `after_json` carries the full HardDeleteReport; `before_json`
    // carries the customer's pre-erasure email / name (snapshot,
    // since the customer row itself is hard-deleted by the
    // operation).
    "customer_hard_delete",
  ]),
  /** Optional secondary subject ID — e.g. bank_account_id for a bank_verify. */
  target_id: model.text().nullable(),
  /** State snapshot before the mutation (partial, JSON-serialised). */
  before_json: model.json().nullable(),
  /** State snapshot after the mutation. */
  after_json: model.json().nullable(),
  /** Free-form reviewer note. Required for wallet_adjust (enforced at route). */
  note: model.text().nullable(),
  /** Optional reason code enum (e.g. "promo" for wallet_adjust). */
  reason_code: model.text().nullable(),
})
