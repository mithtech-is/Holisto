import { Migration } from "@medusajs/framework/mikro-orm/migrations";

/**
 * Adds the `customer_identity_registry` table — the PAN-anchored
 * persistent identity registry described in
 * `models/customer-identity-registry.ts`. The row outlives any single
 * customer account: hard-deletes set `current_customer_id` to NULL but
 * never touch the row itself.
 *
 * UNIQUE constraints (added directly here, beyond what the auto-gen
 * picks up from `model.text().index()` modifiers):
 *
 *   - `pan_hash`                       — one row per real human
 *   - `client_id`                      — one client_id per row,
 *                                        mirrored on `customer_client_id`
 *   - `cashfree_virtual_account_id`    — partial unique on rows
 *                                        where the VBA has been
 *                                        minted (i.e., not NULL).
 *                                        Lets us hold registry rows
 *                                        in a "pre-VBA" state for
 *                                        customers who completed PAN
 *                                        verify but haven't added a
 *                                        verified bank yet.
 */
export class Migration20260509072518 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`create table if not exists "customer_identity_registry" (
      "id" text not null,
      "pan_hash" text not null,
      "pan_masked" text not null,
      "client_id" text not null,
      "cashfree_virtual_account_id" text null,
      "virtual_account_number" text null,
      "ifsc" text null,
      "beneficiary_name" text null,
      "upi_id" text null,
      "first_customer_id" text not null,
      "current_customer_id" text null,
      "first_provisioned_at" timestamptz not null,
      "last_attached_at" timestamptz not null,
      "release_count" integer not null default 0,
      "reattach_count" integer not null default 0,
      "created_at" timestamptz not null default now(),
      "updated_at" timestamptz not null default now(),
      "deleted_at" timestamptz null,
      constraint "customer_identity_registry_pkey" primary key ("id")
    );`);

    this.addSql(`CREATE UNIQUE INDEX IF NOT EXISTS "IDX_cir_pan_hash_uq"
      ON "customer_identity_registry" ("pan_hash") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE UNIQUE INDEX IF NOT EXISTS "IDX_cir_client_id_uq"
      ON "customer_identity_registry" ("client_id") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE UNIQUE INDEX IF NOT EXISTS "IDX_cir_vba_id_uq"
      ON "customer_identity_registry" ("cashfree_virtual_account_id")
      WHERE deleted_at IS NULL AND cashfree_virtual_account_id IS NOT NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_cir_current_customer_id"
      ON "customer_identity_registry" ("current_customer_id")
      WHERE deleted_at IS NULL AND current_customer_id IS NOT NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_cir_first_customer_id"
      ON "customer_identity_registry" ("first_customer_id") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_cir_deleted_at"
      ON "customer_identity_registry" ("deleted_at") WHERE deleted_at IS NULL;`);
  }

  override async down(): Promise<void> {
    this.addSql(`drop table if exists "customer_identity_registry" cascade;`);
  }

}
