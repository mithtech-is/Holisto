import { Migration } from "@medusajs/framework/mikro-orm/migrations"

/**
 * Adds three encrypted credential columns to `ovo_setting`:
 *   - gsc_service_account_json_encrypted
 *   - bing_webmaster_api_key_encrypted
 *   - spaceserp_api_key_encrypted
 *
 * All three are AES-256-GCM ciphertext from
 * the OVO crypto helper. NULL = "not configured in DB,
 * fall back to env var".
 *
 * The OVO admin reads via mask+last4; the OvoService consumer methods
 * prefer the DB row over the env var when both are set.
 */
export class Migration20260515080000 extends Migration {
  override async up(): Promise<void> {
    this.addSql(`
      ALTER TABLE "ovo_setting"
        ADD COLUMN IF NOT EXISTS "gsc_service_account_json_encrypted" text NULL,
        ADD COLUMN IF NOT EXISTS "bing_webmaster_api_key_encrypted" text NULL,
        ADD COLUMN IF NOT EXISTS "spaceserp_api_key_encrypted" text NULL;
    `)
  }

  override async down(): Promise<void> {
    this.addSql(`
      ALTER TABLE "ovo_setting"
        DROP COLUMN IF EXISTS "gsc_service_account_json_encrypted",
        DROP COLUMN IF EXISTS "bing_webmaster_api_key_encrypted",
        DROP COLUMN IF EXISTS "spaceserp_api_key_encrypted";
    `)
  }
}
