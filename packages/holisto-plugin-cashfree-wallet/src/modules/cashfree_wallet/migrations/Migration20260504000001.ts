import { Migration } from "@medusajs/framework/mikro-orm/migrations";

/**
 * Aadhaar registry: persist the holder photo Cashfree returns on
 * offline-Aadhaar OTP verify so we can use it as the storefront
 * profile-picture fallback (profile_photo → aadhaar_photo → avatar)
 * and as a visual identifier in admin Customer-360 / Aadhaar registry.
 *
 * Cashfree's verify response includes the face crop as base64 (key
 * `photo`) or as a CDN link (`photo_link`); we decode/fetch and
 * re-host via polemarch.uploadLocal so the registry doesn't depend
 * on Cashfree's CDN retention. Mirror of the same pattern used for
 * the Aadhaar masking flow's `kyc_aadhaar_card_masked_url`.
 */
export class Migration20260504000001 extends Migration {

  override async up(): Promise<void> {
    this.addSql(
      `alter table if exists "aadhaar_record" ` +
      `add column if not exists "photo_url" text null;`,
    );
  }

  override async down(): Promise<void> {
    this.addSql(
      `alter table if exists "aadhaar_record" ` +
      `drop column if exists "photo_url";`,
    );
  }
}
