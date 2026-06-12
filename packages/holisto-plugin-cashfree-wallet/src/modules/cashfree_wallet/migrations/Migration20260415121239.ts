import { Migration } from "@medusajs/framework/mikro-orm/migrations";

export class Migration20260415121239 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`alter table if exists "newsletter_subscription" drop constraint if exists "newsletter_subscription_email_unique";`);
    this.addSql(`create table if not exists "company_request" ("id" text not null, "customer_id" text not null, "company_name" text not null, "isin" text null, "customer_note" text null, "status" text check ("status" in ('pending', 'approved', 'rejected')) not null default 'pending', "reviewer_user_id" text null, "reviewer_notes" text null, "reviewed_at" timestamptz null, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "company_request_pkey" primary key ("id"));`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_company_request_customer_id" ON "company_request" ("customer_id") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_company_request_deleted_at" ON "company_request" ("deleted_at") WHERE deleted_at IS NULL;`);

    this.addSql(`create table if not exists "contact_submission" ("id" text not null, "name" text not null, "email" text not null, "phone" text null, "subject" text not null, "message" text not null, "source_ip" text null, "customer_id" text null, "status" text check ("status" in ('new', 'in_review', 'resolved', 'spam')) not null default 'new', "reviewer_notes" text null, "reviewer_user_id" text null, "reviewed_at" timestamptz null, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "contact_submission_pkey" primary key ("id"));`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_contact_submission_deleted_at" ON "contact_submission" ("deleted_at") WHERE deleted_at IS NULL;`);

    this.addSql(`create table if not exists "deposit_proof" ("id" text not null, "customer_id" text not null, "claimed_amount_inr" integer not null, "credited_amount_inr" integer null, "utr" text null, "customer_note" text null, "proof_file_url" text not null, "status" text check ("status" in ('pending', 'approved', 'rejected')) not null default 'pending', "reviewer_user_id" text null, "reviewer_notes" text null, "reviewed_at" timestamptz null, "wallet_transaction_id" text null, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "deposit_proof_pkey" primary key ("id"));`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_deposit_proof_customer_id" ON "deposit_proof" ("customer_id") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_deposit_proof_deleted_at" ON "deposit_proof" ("deleted_at") WHERE deleted_at IS NULL;`);

    this.addSql(`create table if not exists "manual_kyc_request" ("id" text not null, "customer_id" text not null, "customer_note" text null, "status" text check ("status" in ('pending', 'approved', 'rejected', 'cancelled')) not null default 'pending', "reviewer_user_id" text null, "reviewer_notes" text null, "reviewed_at" timestamptz null, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "manual_kyc_request_pkey" primary key ("id"));`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_manual_kyc_request_customer_id" ON "manual_kyc_request" ("customer_id") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_manual_kyc_request_deleted_at" ON "manual_kyc_request" ("deleted_at") WHERE deleted_at IS NULL;`);

    this.addSql(`create table if not exists "newsletter_subscription" ("id" text not null, "email" text not null, "source" text null, "source_ip" text null, "unsubscribed_at" timestamptz null, "first_seen_at" timestamptz null, "last_seen_at" timestamptz null, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "newsletter_subscription_pkey" primary key ("id"));`);
    this.addSql(`CREATE UNIQUE INDEX IF NOT EXISTS "IDX_newsletter_subscription_email_unique" ON "newsletter_subscription" ("email") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_newsletter_subscription_deleted_at" ON "newsletter_subscription" ("deleted_at") WHERE deleted_at IS NULL;`);

    this.addSql(`alter table if exists "bank_account" add column if not exists "bank_proof_file_url" text null, add column if not exists "bank_proof_type" text check ("bank_proof_type" in ('cheque', 'passbook', 'statement')) null;`);
  }

  override async down(): Promise<void> {
    this.addSql(`drop table if exists "company_request" cascade;`);

    this.addSql(`drop table if exists "contact_submission" cascade;`);

    this.addSql(`drop table if exists "deposit_proof" cascade;`);

    this.addSql(`drop table if exists "manual_kyc_request" cascade;`);

    this.addSql(`drop table if exists "newsletter_subscription" cascade;`);

    this.addSql(`alter table if exists "bank_account" drop column if exists "bank_proof_file_url", drop column if exists "bank_proof_type";`);
  }

}
