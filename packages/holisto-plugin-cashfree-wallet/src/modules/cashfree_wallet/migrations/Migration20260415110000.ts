import { Migration } from "@mikro-orm/migrations"

/**
 * Adds the `cashfree_setting` singleton table backing the admin UI for
 * Cashfree credentials. See `models/cashfree-setting.ts` for field docs.
 *
 * Singleton enforcement: a partial unique index on `singleton_key` (which
 * defaults to the literal "default") guarantees at most one live row.
 */
export class Migration20260415110000 extends Migration {
  async up(): Promise<void> {
    this.addSql(`
      CREATE TABLE IF NOT EXISTS "cashfree_setting" (
        "id" TEXT NOT NULL,
        "singleton_key" TEXT NOT NULL DEFAULT 'default',
        "env" TEXT NOT NULL DEFAULT 'sandbox',
        "client_id" TEXT NULL,
        "client_secret_encrypted" TEXT NULL,
        "payouts_client_id" TEXT NULL,
        "payouts_client_secret_encrypted" TEXT NULL,
        "webhook_secret_encrypted" TEXT NULL,
        "verify_webhook_secret_encrypted" TEXT NULL,
        "vba_prefix" TEXT NULL,
        "updated_by_user_id" TEXT NULL,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "deleted_at" TIMESTAMPTZ NULL,
        CONSTRAINT "cashfree_setting_pkey" PRIMARY KEY ("id")
      );
      CREATE UNIQUE INDEX IF NOT EXISTS "IDX_cashfree_setting_singleton_uq"
        ON "cashfree_setting" ("singleton_key") WHERE "deleted_at" IS NULL;
    `)
  }

  async down(): Promise<void> {
    this.addSql('DROP TABLE IF EXISTS "cashfree_setting" CASCADE;')
  }
}
