import { Migration } from "@medusajs/framework/mikro-orm/migrations"

/**
 * Extend `admin_audit_log.action` allowlist to include
 * `customer_hard_delete` (DPDP §12 erasure trigger) and
 * `wallet_sync` (manual deposit recheck on Customer-360).
 *
 * The original migration locked `action` to a 20-value CHECK
 * constraint. Two routes added this week (`customer_hard_delete`
 * via /admin/customers/:id/hard-delete, `wallet_sync` via
 * /admin/customers/:id/sync-wallet) attempted to write audit rows
 * with new action values — Postgres silently rejected the insert,
 * so neither operation has been auditable until now. Both are
 * destructive / data-modifying, so audit coverage is load-bearing
 * for the SEBI 8-year retention story.
 *
 * Idempotent — drops + recreates the constraint with the union of
 * old + new values, guarded so a re-run doesn't fail.
 */
export class Migration20260507000001 extends Migration {
  override async up(): Promise<void> {
    this.addSql(
      `alter table if exists "admin_audit_log" drop constraint if exists "admin_audit_log_action_check";`,
    )
    this.addSql(
      `alter table if exists "admin_audit_log" add constraint "admin_audit_log_action_check" check ("action" in (` +
        `'kyc_edit','kyc_approve','kyc_reject',` +
        `'wallet_adjust','wallet_freeze','wallet_unfreeze','wallet_sync',` +
        `'bank_verify','bank_edit','bank_delete',` +
        `'demat_verify','demat_edit','demat_delete','demat_set_primary',` +
        `'referral_reverse','order_cancel',` +
        `'deposit_proof_decide','company_request_decide',` +
        `'document_upload','document_delete',` +
        `'customer_edit','customer_hard_delete'` +
        `));`,
    )
  }

  override async down(): Promise<void> {
    this.addSql(
      `alter table if exists "admin_audit_log" drop constraint if exists "admin_audit_log_action_check";`,
    )
    this.addSql(
      `alter table if exists "admin_audit_log" add constraint "admin_audit_log_action_check" check ("action" in (` +
        `'kyc_edit','kyc_approve','kyc_reject',` +
        `'wallet_adjust','wallet_freeze','wallet_unfreeze',` +
        `'bank_verify','bank_edit','bank_delete',` +
        `'demat_verify','demat_edit','demat_delete','demat_set_primary',` +
        `'referral_reverse','order_cancel',` +
        `'deposit_proof_decide','company_request_decide',` +
        `'document_upload','document_delete',` +
        `'customer_edit'` +
        `));`,
    )
  }
}
