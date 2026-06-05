import { Migration } from "@mikro-orm/migrations"

/**
 * `account_request` — DPDP Act data-subject request inbox.
 *
 * One row per export-or-delete request from a customer. Lifecycle is
 * pending → in_review → completed (or rejected / cancelled). The
 * partial unique index enforces a single open request per (customer, kind)
 * to deter spam and double-submits — but allows a fresh request once
 * the previous one is resolved.
 */
export class Migration20260416095246 extends Migration {
  async up(): Promise<void> {
    this.addSql(`
      CREATE TABLE IF NOT EXISTS "account_request" (
        "id" TEXT NOT NULL,
        "customer_id" TEXT NOT NULL,
        "customer_email" TEXT NOT NULL,
        "kind" TEXT NOT NULL CHECK ("kind" IN ('export', 'delete')),
        "status" TEXT NOT NULL DEFAULT 'pending'
          CHECK ("status" IN ('pending', 'in_review', 'completed', 'rejected', 'cancelled')),
        "customer_note" TEXT NULL,
        "export_file_url" TEXT NULL,
        "export_expires_at" TIMESTAMPTZ NULL,
        "reviewer_notes" TEXT NULL,
        "reviewer_user_id" TEXT NULL,
        "reviewed_at" TIMESTAMPTZ NULL,
        "source_ip" TEXT NULL,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "deleted_at" TIMESTAMPTZ NULL,
        CONSTRAINT "account_request_pkey" PRIMARY KEY ("id")
      );

      CREATE INDEX IF NOT EXISTS "IDX_account_request_customer"
        ON "account_request" ("customer_id")
        WHERE "deleted_at" IS NULL;

      CREATE INDEX IF NOT EXISTS "IDX_account_request_status_kind"
        ON "account_request" ("status", "kind")
        WHERE "deleted_at" IS NULL;

      -- One open request per (customer, kind) at a time. Once the request
      -- is completed/rejected/cancelled it leaves the partial index, so
      -- the customer can submit again.
      CREATE UNIQUE INDEX IF NOT EXISTS "UQ_account_request_open_per_kind"
        ON "account_request" ("customer_id", "kind")
        WHERE "deleted_at" IS NULL
          AND "status" IN ('pending', 'in_review');
    `)
  }

  async down(): Promise<void> {
    this.addSql(`DROP TABLE IF EXISTS "account_request" CASCADE;`)
  }
}
