import { Migration } from "@medusajs/framework/mikro-orm/migrations";

/**
 * Adds the global cmr_record registry (parallel to pan_record /
 * aadhaar_record / bank_record) plus a `cmr_hash` link column on
 * demat_account. CMR data and CMR PDFs in /static/ now survive
 * customer hard-delete (see utils/dpdp/hard-delete-customer.ts).
 *
 * The auto-generated migration also picked up unrelated schema
 * drift (already applied on prod via prior migrations); those have
 * been removed so this one focuses solely on the cmr_record + cmr_hash
 * additions and is safe to re-run.
 */
export class Migration20260509122016 extends Migration {

  override async up(): Promise<void> {
    // Global CMR registry — hash-keyed, retained across customer
    // erasure per regulator. Mirrors bank_record / pan_record /
    // aadhaar_record shape.
    this.addSql(`create table if not exists "cmr_record" (
      "id" text not null,
      "cmr_hash" text not null,
      "depository" text check ("depository" in ('NSDL', 'CDSL')) not null,
      "cmr_masked" text not null,
      "dp_id" text null,
      "client_id" text null,
      "boid" text null,
      "dp_name" text not null,
      "account_holder_name" text not null,
      "cmr_file_url" text not null,
      "name_match_score" integer null,
      "verification_status" text check ("verification_status" in ('pending', 'verified', 'failed', 'name_mismatch')) not null default 'pending',
      "cashfree_reference_id" text null,
      "verification_raw" jsonb null,
      "first_verified_at" timestamptz null,
      "last_refreshed_at" timestamptz not null,
      "created_at" timestamptz not null default now(),
      "updated_at" timestamptz not null default now(),
      "deleted_at" timestamptz null,
      constraint "cmr_record_pkey" primary key ("id")
    );`);
    this.addSql(`CREATE UNIQUE INDEX IF NOT EXISTS "IDX_cmr_record_cmr_hash_unique" ON "cmr_record" ("cmr_hash") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_cmr_record_cmr_hash" ON "cmr_record" ("cmr_hash") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_cmr_record_deleted_at" ON "cmr_record" ("deleted_at") WHERE deleted_at IS NULL;`);

    // Link column on the customer-bound demat row, pointing at the
    // global registry. Same hash semantics as bank_account.bank_hash.
    this.addSql(`alter table if exists "demat_account" add column if not exists "cmr_hash" text null;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_demat_account_cmr_hash" ON "demat_account" ("cmr_hash") WHERE deleted_at IS NULL;`);
  }

  override async down(): Promise<void> {
    this.addSql(`alter table if exists "demat_account" drop column if exists "cmr_hash";`);
    this.addSql(`drop table if exists "cmr_record" cascade;`);
  }

}
