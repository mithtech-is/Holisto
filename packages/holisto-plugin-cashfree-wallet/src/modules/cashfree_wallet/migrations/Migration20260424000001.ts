import { Migration } from "@mikro-orm/migrations"

/**
 * Adds per-kind Secure ID toggles to `cashfree_setting` (one singleton row).
 *
 * The existing `verification_enabled` boolean is the umbrella master switch
 * for the Verification Suite product. This migration adds four fine-grained
 * toggles that the admin can flip independently:
 *
 *   - pan_verification_enabled
 *   - aadhaar_verification_enabled
 *   - bank_verification_enabled
 *   - cmr_verification_enabled
 *
 * Default TRUE so every existing installation keeps the same runtime
 * behavior (all four kinds live whenever the master switch is on). Admin
 * flips any to false → storefront hides that step + store route rejects
 * the call with 403.
 */
export class Migration20260424000001 extends Migration {
  async up(): Promise<void> {
    this.addSql(`
      ALTER TABLE "cashfree_setting"
        ADD COLUMN IF NOT EXISTS "pan_verification_enabled" BOOLEAN NOT NULL DEFAULT TRUE,
        ADD COLUMN IF NOT EXISTS "aadhaar_verification_enabled" BOOLEAN NOT NULL DEFAULT TRUE,
        ADD COLUMN IF NOT EXISTS "bank_verification_enabled" BOOLEAN NOT NULL DEFAULT TRUE,
        ADD COLUMN IF NOT EXISTS "cmr_verification_enabled" BOOLEAN NOT NULL DEFAULT TRUE;
    `)
  }

  async down(): Promise<void> {
    this.addSql(`
      ALTER TABLE "cashfree_setting"
        DROP COLUMN IF EXISTS "pan_verification_enabled",
        DROP COLUMN IF EXISTS "aadhaar_verification_enabled",
        DROP COLUMN IF EXISTS "bank_verification_enabled",
        DROP COLUMN IF EXISTS "cmr_verification_enabled";
    `)
  }
}
