import { Migration } from "@mikro-orm/migrations"

/**
 * Pivot CashfreeVirtualAccount from one-per-customer to one-per-bank.
 *
 * Why: with Auto Collect we want each customer bank account to map to its
 * own VBA, locked to that source bank via Cashfree's `allowed_remitters`
 * payload. That guarantees inbound funds can only come from a bank in the
 * customer's own (verified) name. The old singleton-per-customer model
 * couldn't express that.
 *
 * Changes:
 *   - drop the unique partial index on (customer_id) — multiple VBAs per
 *     customer is now legal.
 *   - add `bank_account_id` FK column (nullable for legacy rows; new rows
 *     always set it).
 *   - add a unique partial index on `bank_account_id` so each bank
 *     account has at most one active VBA.
 *   - drop unique on `virtual_account_id` is kept (Cashfree side is still
 *     globally unique).
 */
export class Migration20260415120000 extends Migration {
  async up(): Promise<void> {
    this.addSql(`
      ALTER TABLE "cashfree_virtual_account"
        ADD COLUMN IF NOT EXISTS "bank_account_id" TEXT NULL;

      ALTER TABLE "cashfree_virtual_account"
        ADD COLUMN IF NOT EXISTS "bank_code" TEXT NULL;

      DROP INDEX IF EXISTS "IDX_cfva_customer_id_uq";

      CREATE INDEX IF NOT EXISTS "IDX_cfva_customer_id"
        ON "cashfree_virtual_account" ("customer_id");

      CREATE UNIQUE INDEX IF NOT EXISTS "IDX_cfva_bank_account_id_uq"
        ON "cashfree_virtual_account" ("bank_account_id")
        WHERE "deleted_at" IS NULL AND "bank_account_id" IS NOT NULL;
    `)
  }

  async down(): Promise<void> {
    this.addSql(`
      DROP INDEX IF EXISTS "IDX_cfva_bank_account_id_uq";
      DROP INDEX IF EXISTS "IDX_cfva_customer_id";

      CREATE UNIQUE INDEX IF NOT EXISTS "IDX_cfva_customer_id_uq"
        ON "cashfree_virtual_account" ("customer_id")
        WHERE "deleted_at" IS NULL;

      ALTER TABLE "cashfree_virtual_account"
        DROP COLUMN IF EXISTS "bank_code";
      ALTER TABLE "cashfree_virtual_account"
        DROP COLUMN IF EXISTS "bank_account_id";
    `)
  }
}
