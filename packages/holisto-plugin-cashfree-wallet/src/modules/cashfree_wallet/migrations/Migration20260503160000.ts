import { Migration } from "@medusajs/framework/mikro-orm/migrations";

/**
 * Referral programme: per-side rewards + min-purchase gate.
 *
 *   - cashfree_setting: add `referral_min_purchase_inr`,
 *     `referral_referrer_reward_inr`, `referral_referee_reward_inr`.
 *     Legacy `referral_reward_amount_inr` stays as a fallback.
 *   - referral row: add per-side reward snapshots +
 *     first_order_subtotal_inr for audit.
 */
export class Migration20260503160000 extends Migration {

  override async up(): Promise<void> {
    this.addSql(
      `alter table if exists "cashfree_setting" ` +
      `add column if not exists "referral_min_purchase_inr" integer not null default 1000;`,
    );
    this.addSql(
      `alter table if exists "cashfree_setting" ` +
      `add column if not exists "referral_referrer_reward_inr" integer not null default 250;`,
    );
    this.addSql(
      `alter table if exists "cashfree_setting" ` +
      `add column if not exists "referral_referee_reward_inr" integer not null default 250;`,
    );

    this.addSql(
      `alter table if exists "referral" ` +
      `add column if not exists "referrer_reward_inr" integer not null default 0;`,
    );
    this.addSql(
      `alter table if exists "referral" ` +
      `add column if not exists "referee_reward_inr" integer not null default 0;`,
    );
    this.addSql(
      `alter table if exists "referral" ` +
      `add column if not exists "first_order_subtotal_inr" integer null;`,
    );
  }

  override async down(): Promise<void> {
    this.addSql(
      `alter table if exists "cashfree_setting" ` +
      `drop column if exists "referral_min_purchase_inr", ` +
      `drop column if exists "referral_referrer_reward_inr", ` +
      `drop column if exists "referral_referee_reward_inr";`,
    );
    this.addSql(
      `alter table if exists "referral" ` +
      `drop column if exists "referrer_reward_inr", ` +
      `drop column if exists "referee_reward_inr", ` +
      `drop column if exists "first_order_subtotal_inr";`,
    );
  }
}
