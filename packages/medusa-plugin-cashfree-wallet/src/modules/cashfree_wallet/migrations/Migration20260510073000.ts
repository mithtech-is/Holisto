import { Migration } from "@medusajs/framework/mikro-orm/migrations";

/**
 * Drops the unique constraint on `referral.code`.
 *
 * The unique-on-code shape was wrong: one referrer's master code is
 * reused across the template row (referred_customer_id IS NULL) AND
 * every application row that consumed it. The unique partial index
 * `IDX_referral_code_unique` blocked the very first `applyReferralCode`
 * call because the create attempted to insert a second row with the
 * same code.
 *
 * The plain `IDX_referral_code` index stays — code lookups during
 * /store/referral/apply still need fast path. Application-layer
 * de-duplication in applyReferralCode (existing `alreadyReferred`
 * lookup) prevents double-dipping per referee.
 */
export class Migration20260510073000 extends Migration {
  override async up(): Promise<void> {
    this.addSql(
      `DROP INDEX IF EXISTS "IDX_referral_code_unique";`,
    );
  }

  override async down(): Promise<void> {
    // Recreate the unique index on rollback. Note: rolling back is
    // ONLY safe when there are no application rows on prod — i.e.
    // `SELECT COUNT(*) FROM referral WHERE referred_customer_id IS NOT NULL` = 0.
    this.addSql(
      `CREATE UNIQUE INDEX IF NOT EXISTS "IDX_referral_code_unique" ON "referral" ("code") WHERE deleted_at IS NULL;`,
    );
  }
}
