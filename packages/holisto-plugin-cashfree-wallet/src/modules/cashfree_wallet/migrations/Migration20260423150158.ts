import { Migration } from "@mikro-orm/migrations"

/**
 * Adds `pg_notification_group` to `cashfree_setting`.
 *
 * Cashfree's `/pg/vba` endpoint (API version 2024-07-10+) requires a
 * `notification_group` field that references a named group the merchant
 * has pre-created in their dashboard (Auto-Collect → Notifications).
 * Previously we didn't send one, which triggered
 * `notif_group_not_exists` from Cashfree and silently broke VBA
 * provisioning.
 *
 * Stored once per install (VBA notif groups aren't per-env — the same
 * name works on sandbox + production accounts as long as the merchant
 * has created it in both).
 */
export class Migration20260423150158 extends Migration {
  async up(): Promise<void> {
    this.addSql(`
      ALTER TABLE "cashfree_setting"
        ADD COLUMN IF NOT EXISTS "pg_notification_group" TEXT NULL;
    `)
  }

  async down(): Promise<void> {
    this.addSql(`
      ALTER TABLE "cashfree_setting"
        DROP COLUMN IF EXISTS "pg_notification_group";
    `)
  }
}
