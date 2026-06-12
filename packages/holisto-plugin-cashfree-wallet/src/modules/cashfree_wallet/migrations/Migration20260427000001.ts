import { Migration } from "@medusajs/framework/mikro-orm/migrations"

/**
 * Global PAN cache table.
 *
 * One row per unique PAN hash. Survives customer deletion — the
 * customer-purge SQL in scripts/sync-local-db-to-vps.sh and the
 * docs runbook explicitly skip this table. Same retention promise
 * as `cashfree_setting` — it's a fact-table, not a customer-scoped
 * record.
 *
 * Indexes:
 *   - UNIQUE(pan_hash) — every read goes through the hash; the
 *     route hashes the submitted PAN and looks up here before
 *     deciding whether to call Cashfree.
 *   - first_verified_at — admin "recently cached" panel.
 *
 * The model emits `deleted_at` for parity with the rest of the
 * schema, but the routes never set it — soft-delete stays unused
 * here. Hard-delete is the only way a row leaves this table, and
 * that's a manual ops action.
 */
export class Migration20260427000001 extends Migration {
  override async up(): Promise<void> {
    this.addSql(
      `create table if not exists "pan_record" (` +
        `"id" text not null, ` +
        `"pan_hash" text not null, ` +
        `"pan_masked" text not null, ` +
        `"registered_name" text not null, ` +
        `"name_pan_card" text null, ` +
        `"first_name" text null, ` +
        `"last_name" text null, ` +
        `"pan_type" text null, ` +
        `"father_name" text null, ` +
        `"pan_status" text null, ` +
        `"last_updated_at_itd" text null, ` +
        `"aadhaar_linked" boolean null, ` +
        `"aadhaar_seeding_status" text null, ` +
        `"aadhaar_seeding_status_desc" text null, ` +
        `"masked_aadhaar" text null, ` +
        `"gender" text null, ` +
        `"date_of_birth" text null, ` +
        `"email_masked" text null, ` +
        `"phone_masked" text null, ` +
        `"address" jsonb null, ` +
        `"name_match_score_initial" double precision null, ` +
        `"name_match_result_initial" text null, ` +
        `"cashfree_reference_id" text null, ` +
        `"cashfree_verification_id" text null, ` +
        `"response_raw" jsonb null, ` +
        `"first_verified_at" timestamptz not null default now(), ` +
        `"last_refreshed_at" timestamptz not null default now(), ` +
        `"created_at" timestamptz not null default now(), ` +
        `"updated_at" timestamptz not null default now(), ` +
        `"deleted_at" timestamptz null, ` +
        `constraint "pan_record_pkey" primary key ("id"));`,
    )
    this.addSql(
      `create unique index if not exists "IDX_pan_record_pan_hash_unique" ` +
        `on "pan_record" ("pan_hash") where deleted_at is null;`,
    )
    this.addSql(
      `create index if not exists "IDX_pan_record_pan_hash" ` +
        `on "pan_record" ("pan_hash") where deleted_at is null;`,
    )
    this.addSql(
      `create index if not exists "IDX_pan_record_first_verified_at" ` +
        `on "pan_record" ("first_verified_at") where deleted_at is null;`,
    )
    this.addSql(
      `create index if not exists "IDX_pan_record_deleted_at" ` +
        `on "pan_record" ("deleted_at") where deleted_at is null;`,
    )
  }

  override async down(): Promise<void> {
    this.addSql(`drop table if exists "pan_record" cascade;`)
  }
}
