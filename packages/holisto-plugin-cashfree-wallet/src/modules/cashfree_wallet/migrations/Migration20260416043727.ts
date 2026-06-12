import { Migration } from "@medusajs/framework/mikro-orm/migrations";

export class Migration20260416043727 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`create table if not exists "admin_audit_log" ("id" text not null, "admin_user_id" text not null, "customer_id" text null, "action" text check ("action" in ('kyc_edit', 'kyc_approve', 'kyc_reject', 'wallet_adjust', 'wallet_freeze', 'wallet_unfreeze', 'bank_verify', 'bank_edit', 'bank_delete', 'demat_verify', 'demat_edit', 'demat_delete', 'demat_set_primary', 'referral_reverse', 'order_cancel', 'deposit_proof_decide', 'company_request_decide', 'document_upload', 'document_delete', 'customer_edit')) not null, "target_id" text null, "before_json" jsonb null, "after_json" jsonb null, "note" text null, "reason_code" text null, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "admin_audit_log_pkey" primary key ("id"));`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_admin_audit_log_admin_user_id" ON "admin_audit_log" ("admin_user_id") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_admin_audit_log_customer_id" ON "admin_audit_log" ("customer_id") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_admin_audit_log_deleted_at" ON "admin_audit_log" ("deleted_at") WHERE deleted_at IS NULL;`);
  }

  override async down(): Promise<void> {
    this.addSql(`drop table if exists "admin_audit_log" cascade;`);
  }

}
