import { Migration } from "@medusajs/framework/mikro-orm/migrations";

export class Migration20260415234457 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`alter table if exists "referral" drop constraint if exists "referral_status_check";`);

    this.addSql(`alter table if exists "cashfree_setting" add column if not exists "referral_enabled" boolean not null default true, add column if not exists "referral_reward_amount_inr" integer not null default 250;`);

    this.addSql(`drop index if exists "IDX_referral_referred_customer_id_unique";`);

    this.addSql(`alter table if exists "referral" add column if not exists "first_trade_at" text null, add column if not exists "credited_at" text null, add column if not exists "reversed_at" text null;`);
    this.addSql(`alter table if exists "referral" add constraint "referral_status_check" check("status" in ('pending', 'credited', 'expired', 'reversed'));`);
  }

  override async down(): Promise<void> {
    this.addSql(`alter table if exists "referral" drop constraint if exists "referral_status_check";`);

    this.addSql(`alter table if exists "cashfree_setting" drop column if exists "referral_enabled", drop column if exists "referral_reward_amount_inr";`);

    this.addSql(`alter table if exists "referral" drop column if exists "first_trade_at", drop column if exists "credited_at", drop column if exists "reversed_at";`);

    this.addSql(`alter table if exists "referral" add constraint "referral_status_check" check("status" in ('pending', 'credited', 'expired'));`);
    this.addSql(`CREATE UNIQUE INDEX IF NOT EXISTS "IDX_referral_referred_customer_id_unique" ON "referral" ("referred_customer_id") WHERE deleted_at IS NULL;`);
  }

}
