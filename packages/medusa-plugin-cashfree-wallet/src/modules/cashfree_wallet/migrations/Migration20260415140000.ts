import { Migration } from "@mikro-orm/migrations"

/**
 * New tables for the two manual flows:
 *
 *   - `manual_kyc_request` — customer asks ops to review their KYC
 *     documents when Cashfree Secure ID isn't available / fails.
 *   - `deposit_proof`     — customer uploaded proof of an offline bank
 *     transfer to the Polemarch operational account; admin reviews and
 *     credits the wallet on approval.
 *
 * Both are append-only inboxes + audit rows.
 */
export class Migration20260415140000 extends Migration {
  async up(): Promise<void> {
    this.addSql(`
      CREATE TABLE IF NOT EXISTS "manual_kyc_request" (
        "id" TEXT NOT NULL,
        "customer_id" TEXT NOT NULL,
        "customer_note" TEXT NULL,
        "status" TEXT NOT NULL DEFAULT 'pending',
        "reviewer_user_id" TEXT NULL,
        "reviewer_notes" TEXT NULL,
        "reviewed_at" TIMESTAMPTZ NULL,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "deleted_at" TIMESTAMPTZ NULL,
        CONSTRAINT "manual_kyc_request_pkey" PRIMARY KEY ("id")
      );
      CREATE INDEX IF NOT EXISTS "IDX_manual_kyc_request_customer"
        ON "manual_kyc_request" ("customer_id");
      CREATE INDEX IF NOT EXISTS "IDX_manual_kyc_request_status_created"
        ON "manual_kyc_request" ("status", "created_at");
    `)
    this.addSql(`
      CREATE TABLE IF NOT EXISTS "deposit_proof" (
        "id" TEXT NOT NULL,
        "customer_id" TEXT NOT NULL,
        "claimed_amount_inr" BIGINT NOT NULL,
        "credited_amount_inr" BIGINT NULL,
        "utr" TEXT NULL,
        "customer_note" TEXT NULL,
        "proof_file_url" TEXT NOT NULL,
        "status" TEXT NOT NULL DEFAULT 'pending',
        "reviewer_user_id" TEXT NULL,
        "reviewer_notes" TEXT NULL,
        "reviewed_at" TIMESTAMPTZ NULL,
        "wallet_transaction_id" TEXT NULL,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "deleted_at" TIMESTAMPTZ NULL,
        CONSTRAINT "deposit_proof_pkey" PRIMARY KEY ("id")
      );
      CREATE INDEX IF NOT EXISTS "IDX_deposit_proof_customer"
        ON "deposit_proof" ("customer_id");
      CREATE INDEX IF NOT EXISTS "IDX_deposit_proof_status_created"
        ON "deposit_proof" ("status", "created_at");
    `)
  }

  async down(): Promise<void> {
    this.addSql('DROP TABLE IF EXISTS "deposit_proof" CASCADE;')
    this.addSql('DROP TABLE IF EXISTS "manual_kyc_request" CASCADE;')
  }
}
