import { Migration } from "@medusajs/framework/mikro-orm/migrations";

/**
 * Bank registry — `bank_record` global cache + `bank_account.bank_hash`
 * pointer. Mirrors the PAN / Aadhaar registry pattern so admin
 * Customer-360 + a new `/app/bank-records` page can resolve a
 * customer's verified banks via SHA-256 hash lookup, without joining
 * the audit log.
 *
 * Hash key: SHA-256(`<IFSC>:<account_number>`). Neither field is
 * unique on its own; the colon-joined pair is.
 *
 * BAV v2 (`x-api-version: 2024-01-01`) returns the v2 fields
 * (account_status_code, name_match_result with finer grades,
 * ifsc_details, branch / city / micr / utr / swift_code / nbin /
 * category) — these all live on this table directly so admin can
 * filter / search without unpacking response_raw every time.
 */
export class Migration20260504000004 extends Migration {

  override async up(): Promise<void> {
    this.addSql(
      `create table if not exists "bank_record" (` +
      `"id" text not null, ` +
      `"bank_hash" text not null, ` +
      `"account_number_masked" text not null, ` +
      `"account_number_full" text null, ` +
      `"ifsc" text not null, ` +
      `"account_status" text null, ` +
      `"account_status_code" text null, ` +
      `"name_at_bank" text null, ` +
      `"name_match_result" text null, ` +
      `"name_match_score" integer null, ` +
      `"bank_name" text null, ` +
      `"branch" text null, ` +
      `"city" text null, ` +
      `"micr" text null, ` +
      `"swift_code" text null, ` +
      `"nbin" text null, ` +
      `"category" text null, ` +
      `"ifsc_details" jsonb null, ` +
      `"cashfree_ref_id" text null, ` +
      `"utr" text null, ` +
      `"response_raw" jsonb null, ` +
      `"first_verified_at" timestamptz not null, ` +
      `"last_refreshed_at" timestamptz not null, ` +
      `"created_at" timestamptz not null default now(), ` +
      `"updated_at" timestamptz not null default now(), ` +
      `"deleted_at" timestamptz null, ` +
      `constraint "bank_record_pkey" primary key ("id"));`,
    );
    this.addSql(
      `create unique index if not exists "IDX_bank_record_bank_hash_unique" ` +
      `on "bank_record" ("bank_hash") where deleted_at is null;`,
    );
    this.addSql(
      `create index if not exists "IDX_bank_record_ifsc" ` +
      `on "bank_record" ("ifsc") where deleted_at is null;`,
    );
    this.addSql(
      `create index if not exists "IDX_bank_record_deleted_at" ` +
      `on "bank_record" ("deleted_at") where deleted_at is null;`,
    );

    this.addSql(
      `alter table if exists "bank_account" ` +
      `add column if not exists "bank_hash" text null;`,
    );
    this.addSql(
      `create index if not exists "IDX_bank_account_bank_hash" ` +
      `on "bank_account" ("bank_hash") where deleted_at is null;`,
    );
  }

  override async down(): Promise<void> {
    this.addSql(`drop index if exists "IDX_bank_account_bank_hash";`);
    this.addSql(
      `alter table if exists "bank_account" ` +
      `drop column if exists "bank_hash";`,
    );
    this.addSql(`drop table if exists "bank_record" cascade;`);
  }
}
