import { Migration } from "@medusajs/framework/mikro-orm/migrations"

/**
 * Global Aadhaar cache table. Mirrors `pan_record` — keyed on
 * SHA-256(aadhaar_number), survives customer deletion, shared
 * across customers if they happen to verify the same Aadhaar.
 *
 * Schema is shorter than pan_record because UIDAI's offline-XML
 * response is more compact than PAN 360 (no separate first/last
 * split, no father, no aadhaar-seeding-status — Aadhaar IS the
 * thing being checked).
 */
export class Migration20260427000002 extends Migration {
  override async up(): Promise<void> {
    this.addSql(
      `create table if not exists "aadhaar_record" (` +
        `"id" text not null, ` +
        `"aadhaar_hash" text not null, ` +
        `"aadhaar_masked" text not null, ` +
        `"name" text not null, ` +
        `"date_of_birth" text null, ` +
        `"gender" text null, ` +
        `"address" jsonb null, ` +
        `"has_photo" boolean null, ` +
        `"cashfree_ref_id" text null, ` +
        `"response_raw" jsonb null, ` +
        `"first_verified_at" timestamptz not null default now(), ` +
        `"last_refreshed_at" timestamptz not null default now(), ` +
        `"created_at" timestamptz not null default now(), ` +
        `"updated_at" timestamptz not null default now(), ` +
        `"deleted_at" timestamptz null, ` +
        `constraint "aadhaar_record_pkey" primary key ("id"));`,
    )
    this.addSql(
      `create unique index if not exists "IDX_aadhaar_record_hash_unique" ` +
        `on "aadhaar_record" ("aadhaar_hash") where deleted_at is null;`,
    )
    this.addSql(
      `create index if not exists "IDX_aadhaar_record_hash" ` +
        `on "aadhaar_record" ("aadhaar_hash") where deleted_at is null;`,
    )
    this.addSql(
      `create index if not exists "IDX_aadhaar_record_first_verified_at" ` +
        `on "aadhaar_record" ("first_verified_at") where deleted_at is null;`,
    )
    this.addSql(
      `create index if not exists "IDX_aadhaar_record_deleted_at" ` +
        `on "aadhaar_record" ("deleted_at") where deleted_at is null;`,
    )
  }

  override async down(): Promise<void> {
    this.addSql(`drop table if exists "aadhaar_record" cascade;`)
  }
}
