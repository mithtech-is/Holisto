import { Migration } from "@medusajs/framework/mikro-orm/migrations";

/**
 * Promo wallet — second sub-balance on every wallet, plus the admin
 * knobs that control how it behaves.
 *
 *   wallet.promo_balance_inr        — paise, default 0
 *   wallet_transaction.bucket       — 'main' | 'promo', default 'main'
 *   wallet_transaction.kind         — adds 'points_conversion'
 *   cashfree_setting.promo_*        — utilisation cap + enabled
 *   cashfree_setting.referrer_credit_bucket / referee_credit_bucket
 *   cashfree_setting.points_*       — conversion rate + min/max + enabled
 *
 * Idempotent — every column add is `IF NOT EXISTS`. The kind-enum
 * extension is via a check-constraint swap (the standard pattern in
 * the rest of this migrations directory).
 */
export class Migration20260510130000 extends Migration {
  override async up(): Promise<void> {
    // wallet.promo_balance_inr
    this.addSql(
      `ALTER TABLE IF EXISTS "wallet"
        ADD COLUMN IF NOT EXISTS "promo_balance_inr" bigint NOT NULL DEFAULT 0;`,
    );

    // wallet_transaction.bucket
    this.addSql(
      `ALTER TABLE IF EXISTS "wallet_transaction"
        ADD COLUMN IF NOT EXISTS "bucket" text NOT NULL DEFAULT 'main';`,
    );
    // Re-create the kind check-constraint to include points_conversion.
    this.addSql(
      `ALTER TABLE IF EXISTS "wallet_transaction"
        DROP CONSTRAINT IF EXISTS "wallet_transaction_kind_check";`,
    );
    this.addSql(
      `ALTER TABLE IF EXISTS "wallet_transaction"
        ADD CONSTRAINT "wallet_transaction_kind_check"
        CHECK ("kind" IN (
          'vba_credit', 'order_debit', 'order_reversal', 'refund',
          'manual_adjust', 'referral_credit', 'points_conversion'
        ));`,
    );
    // bucket check
    this.addSql(
      `ALTER TABLE IF EXISTS "wallet_transaction"
        DROP CONSTRAINT IF EXISTS "wallet_transaction_bucket_check";`,
    );
    this.addSql(
      `ALTER TABLE IF EXISTS "wallet_transaction"
        ADD CONSTRAINT "wallet_transaction_bucket_check"
        CHECK ("bucket" IN ('main', 'promo'));`,
    );

    // cashfree_setting columns — promo cap + referral routing + points conversion
    this.addSql(
      `ALTER TABLE IF EXISTS "cashfree_setting"
        ADD COLUMN IF NOT EXISTS "promo_payment_enabled" boolean NOT NULL DEFAULT true,
        ADD COLUMN IF NOT EXISTS "promo_max_pct_of_subtotal" numeric(10, 6) NOT NULL DEFAULT 0.02,
        ADD COLUMN IF NOT EXISTS "promo_max_flat_inr" integer NOT NULL DEFAULT 500,
        ADD COLUMN IF NOT EXISTS "referrer_credit_bucket" text NOT NULL DEFAULT 'promo',
        ADD COLUMN IF NOT EXISTS "referee_credit_bucket" text NOT NULL DEFAULT 'promo',
        ADD COLUMN IF NOT EXISTS "points_conversion_enabled" boolean NOT NULL DEFAULT true,
        ADD COLUMN IF NOT EXISTS "points_per_inr" integer NOT NULL DEFAULT 100,
        ADD COLUMN IF NOT EXISTS "points_min_convert" integer NOT NULL DEFAULT 100,
        ADD COLUMN IF NOT EXISTS "points_max_convert" integer NOT NULL DEFAULT 100000;`,
    );
    // bucket check on the routing columns
    this.addSql(
      `ALTER TABLE IF EXISTS "cashfree_setting"
        DROP CONSTRAINT IF EXISTS "cashfree_setting_referrer_credit_bucket_check";`,
    );
    this.addSql(
      `ALTER TABLE IF EXISTS "cashfree_setting"
        ADD CONSTRAINT "cashfree_setting_referrer_credit_bucket_check"
        CHECK ("referrer_credit_bucket" IN ('main', 'promo'));`,
    );
    this.addSql(
      `ALTER TABLE IF EXISTS "cashfree_setting"
        DROP CONSTRAINT IF EXISTS "cashfree_setting_referee_credit_bucket_check";`,
    );
    this.addSql(
      `ALTER TABLE IF EXISTS "cashfree_setting"
        ADD CONSTRAINT "cashfree_setting_referee_credit_bucket_check"
        CHECK ("referee_credit_bucket" IN ('main', 'promo'));`,
    );
  }

  override async down(): Promise<void> {
    this.addSql(
      `ALTER TABLE IF EXISTS "cashfree_setting"
        DROP COLUMN IF EXISTS "points_max_convert",
        DROP COLUMN IF EXISTS "points_min_convert",
        DROP COLUMN IF EXISTS "points_per_inr",
        DROP COLUMN IF EXISTS "points_conversion_enabled",
        DROP COLUMN IF EXISTS "referee_credit_bucket",
        DROP COLUMN IF EXISTS "referrer_credit_bucket",
        DROP COLUMN IF EXISTS "promo_max_flat_inr",
        DROP COLUMN IF EXISTS "promo_max_pct_of_subtotal",
        DROP COLUMN IF EXISTS "promo_payment_enabled";`,
    );
    this.addSql(
      `ALTER TABLE IF EXISTS "wallet_transaction"
        DROP CONSTRAINT IF EXISTS "wallet_transaction_bucket_check",
        DROP COLUMN IF EXISTS "bucket";`,
    );
    this.addSql(
      `ALTER TABLE IF EXISTS "wallet"
        DROP COLUMN IF EXISTS "promo_balance_inr";`,
    );
  }
}
