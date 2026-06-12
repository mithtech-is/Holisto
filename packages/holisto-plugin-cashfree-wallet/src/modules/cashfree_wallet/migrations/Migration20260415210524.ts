import { Migration } from "@medusajs/framework/mikro-orm/migrations";

export class Migration20260415210524 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`alter table if exists "referral" drop constraint if exists "referral_code_unique";`);
    this.addSql(`alter table if exists "referral" drop constraint if exists "referral_referred_customer_id_unique";`);
    this.addSql(`create table if not exists "referral" ("id" text not null, "referrer_customer_id" text not null, "referred_customer_id" text null, "code" text not null, "status" text check ("status" in ('pending', 'credited', 'expired')) not null default 'pending', "reward_amount_inr" integer not null default 250, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "referral_pkey" primary key ("id"));`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_referral_referrer_customer_id" ON "referral" ("referrer_customer_id") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE UNIQUE INDEX IF NOT EXISTS "IDX_referral_referred_customer_id_unique" ON "referral" ("referred_customer_id") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE UNIQUE INDEX IF NOT EXISTS "IDX_referral_code_unique" ON "referral" ("code") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_referral_code" ON "referral" ("code") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_referral_deleted_at" ON "referral" ("deleted_at") WHERE deleted_at IS NULL;`);

    this.addSql(`alter table if exists "wallet_transaction" drop constraint if exists "wallet_transaction_kind_check";`);

    this.addSql(`alter table if exists "wallet_transaction" add constraint "wallet_transaction_kind_check" check("kind" in ('vba_credit', 'order_debit', 'order_reversal', 'refund', 'manual_adjust', 'referral_credit'));`);
  }

  override async down(): Promise<void> {
    this.addSql(`drop table if exists "referral" cascade;`);

    this.addSql(`alter table if exists "wallet_transaction" drop constraint if exists "wallet_transaction_kind_check";`);

    this.addSql(`alter table if exists "wallet_transaction" add constraint "wallet_transaction_kind_check" check("kind" in ('vba_credit', 'order_debit', 'order_reversal', 'refund', 'manual_adjust'));`);
  }

}
