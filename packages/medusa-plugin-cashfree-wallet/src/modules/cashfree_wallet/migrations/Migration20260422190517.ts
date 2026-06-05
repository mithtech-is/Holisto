import { Migration } from "@mikro-orm/migrations"

/**
 * Per-env Cashfree credentials.
 *
 * Before: `cashfree_setting` held a single flat set of columns (client_id,
 * client_secret_encrypted, …) plus an `env` pointer. Switching `env` in the
 * admin UI and saving would overwrite the one-and-only secret slot — the
 * "other" env's secrets were effectively lost unless re-pasted.
 *
 * After: each secret lives under a `{sandbox_,production_}*` sibling column.
 * `env` remains the active-env pointer. The flat columns are kept (nullable)
 * as a legacy read-fallback so an existing runtime keeps working across
 * a restart. Writes always go to the per-env columns.
 *
 * Backfill: copy each flat column into the matching env column based on the
 * row's current `env`. Runs only for rows where the per-env column is still
 * NULL so re-running is idempotent.
 */
export class Migration20260422190517 extends Migration {
  async up(): Promise<void> {
    this.addSql(`
      ALTER TABLE "cashfree_setting"
        ADD COLUMN IF NOT EXISTS "sandbox_client_id" TEXT NULL,
        ADD COLUMN IF NOT EXISTS "sandbox_client_secret_encrypted" TEXT NULL,
        ADD COLUMN IF NOT EXISTS "sandbox_payouts_client_id" TEXT NULL,
        ADD COLUMN IF NOT EXISTS "sandbox_payouts_client_secret_encrypted" TEXT NULL,
        ADD COLUMN IF NOT EXISTS "sandbox_webhook_secret_encrypted" TEXT NULL,
        ADD COLUMN IF NOT EXISTS "sandbox_verify_webhook_secret_encrypted" TEXT NULL,
        ADD COLUMN IF NOT EXISTS "production_client_id" TEXT NULL,
        ADD COLUMN IF NOT EXISTS "production_client_secret_encrypted" TEXT NULL,
        ADD COLUMN IF NOT EXISTS "production_payouts_client_id" TEXT NULL,
        ADD COLUMN IF NOT EXISTS "production_payouts_client_secret_encrypted" TEXT NULL,
        ADD COLUMN IF NOT EXISTS "production_webhook_secret_encrypted" TEXT NULL,
        ADD COLUMN IF NOT EXISTS "production_verify_webhook_secret_encrypted" TEXT NULL;
    `)

    // Backfill — copy current flat values into the matching env's column set.
    // Only fills columns that are still NULL so re-running is safe.
    this.addSql(`
      UPDATE "cashfree_setting"
         SET "sandbox_client_id"                         = COALESCE("sandbox_client_id", "client_id"),
             "sandbox_client_secret_encrypted"           = COALESCE("sandbox_client_secret_encrypted", "client_secret_encrypted"),
             "sandbox_payouts_client_id"                 = COALESCE("sandbox_payouts_client_id", "payouts_client_id"),
             "sandbox_payouts_client_secret_encrypted"   = COALESCE("sandbox_payouts_client_secret_encrypted", "payouts_client_secret_encrypted"),
             "sandbox_webhook_secret_encrypted"          = COALESCE("sandbox_webhook_secret_encrypted", "webhook_secret_encrypted"),
             "sandbox_verify_webhook_secret_encrypted"   = COALESCE("sandbox_verify_webhook_secret_encrypted", "verify_webhook_secret_encrypted")
       WHERE "env" = 'sandbox';

      UPDATE "cashfree_setting"
         SET "production_client_id"                        = COALESCE("production_client_id", "client_id"),
             "production_client_secret_encrypted"          = COALESCE("production_client_secret_encrypted", "client_secret_encrypted"),
             "production_payouts_client_id"                = COALESCE("production_payouts_client_id", "payouts_client_id"),
             "production_payouts_client_secret_encrypted"  = COALESCE("production_payouts_client_secret_encrypted", "payouts_client_secret_encrypted"),
             "production_webhook_secret_encrypted"         = COALESCE("production_webhook_secret_encrypted", "webhook_secret_encrypted"),
             "production_verify_webhook_secret_encrypted"  = COALESCE("production_verify_webhook_secret_encrypted", "verify_webhook_secret_encrypted")
       WHERE "env" = 'production';
    `)
  }

  async down(): Promise<void> {
    this.addSql(`
      ALTER TABLE "cashfree_setting"
        DROP COLUMN IF EXISTS "sandbox_client_id",
        DROP COLUMN IF EXISTS "sandbox_client_secret_encrypted",
        DROP COLUMN IF EXISTS "sandbox_payouts_client_id",
        DROP COLUMN IF EXISTS "sandbox_payouts_client_secret_encrypted",
        DROP COLUMN IF EXISTS "sandbox_webhook_secret_encrypted",
        DROP COLUMN IF EXISTS "sandbox_verify_webhook_secret_encrypted",
        DROP COLUMN IF EXISTS "production_client_id",
        DROP COLUMN IF EXISTS "production_client_secret_encrypted",
        DROP COLUMN IF EXISTS "production_payouts_client_id",
        DROP COLUMN IF EXISTS "production_payouts_client_secret_encrypted",
        DROP COLUMN IF EXISTS "production_webhook_secret_encrypted",
        DROP COLUMN IF EXISTS "production_verify_webhook_secret_encrypted";
    `)
  }
}
