import { Migration } from "@mikro-orm/migrations"

export class Migration20260415000000 extends Migration {
  async up(): Promise<void> {
    // ---------- wallet ----------
    this.addSql(`
      CREATE TABLE IF NOT EXISTS "wallet" (
        "id" TEXT NOT NULL,
        "customer_id" TEXT NOT NULL,
        "balance_inr" BIGINT NOT NULL DEFAULT 0,
        "version" INTEGER NOT NULL DEFAULT 0,
        "status" TEXT NOT NULL DEFAULT 'active',
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "deleted_at" TIMESTAMPTZ NULL,
        CONSTRAINT "wallet_pkey" PRIMARY KEY ("id")
      );
      CREATE UNIQUE INDEX IF NOT EXISTS "IDX_wallet_customer_id_uq"
        ON "wallet" ("customer_id") WHERE "deleted_at" IS NULL;
      CREATE INDEX IF NOT EXISTS "IDX_wallet_deleted_at"
        ON "wallet" ("deleted_at") WHERE "deleted_at" IS NOT NULL;
    `)

    // ---------- wallet_transaction ----------
    this.addSql(`
      CREATE TABLE IF NOT EXISTS "wallet_transaction" (
        "id" TEXT NOT NULL,
        "wallet_id" TEXT NOT NULL,
        "customer_id" TEXT NOT NULL,
        "direction" TEXT NOT NULL,
        "amount_inr" BIGINT NOT NULL,
        "balance_after" BIGINT NOT NULL,
        "kind" TEXT NOT NULL,
        "reference_type" TEXT NULL,
        "reference_id" TEXT NULL,
        "cashfree_event_id" TEXT NULL,
        "idempotency_key" TEXT NOT NULL,
        "note" TEXT NULL,
        "metadata" JSONB NULL,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "deleted_at" TIMESTAMPTZ NULL,
        CONSTRAINT "wallet_transaction_pkey" PRIMARY KEY ("id")
      );
      CREATE INDEX IF NOT EXISTS "IDX_wallet_tx_wallet_id" ON "wallet_transaction" ("wallet_id");
      CREATE INDEX IF NOT EXISTS "IDX_wallet_tx_customer_id" ON "wallet_transaction" ("customer_id");
      CREATE UNIQUE INDEX IF NOT EXISTS "IDX_wallet_tx_idem_uq"
        ON "wallet_transaction" ("idempotency_key") WHERE "deleted_at" IS NULL;
      CREATE UNIQUE INDEX IF NOT EXISTS "IDX_wallet_tx_cashfree_event_uq"
        ON "wallet_transaction" ("cashfree_event_id")
        WHERE "deleted_at" IS NULL AND "cashfree_event_id" IS NOT NULL;
    `)

    // ---------- bank_account ----------
    this.addSql(`
      CREATE TABLE IF NOT EXISTS "bank_account" (
        "id" TEXT NOT NULL,
        "customer_id" TEXT NOT NULL,
        "account_holder_name" TEXT NOT NULL,
        "account_number_encrypted" TEXT NOT NULL,
        "account_number_last4" TEXT NOT NULL,
        "ifsc" TEXT NOT NULL,
        "bank_name" TEXT NULL,
        "name_match_score" NUMERIC NULL,
        "verification_status" TEXT NOT NULL DEFAULT 'pending',
        "cashfree_reference_id" TEXT NULL,
        "verification_raw" JSONB NULL,
        "verified_at" TIMESTAMPTZ NULL,
        "is_primary" BOOLEAN NOT NULL DEFAULT FALSE,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "deleted_at" TIMESTAMPTZ NULL,
        CONSTRAINT "bank_account_pkey" PRIMARY KEY ("id")
      );
      CREATE INDEX IF NOT EXISTS "IDX_bank_account_customer_id" ON "bank_account" ("customer_id");
      CREATE UNIQUE INDEX IF NOT EXISTS "IDX_bank_account_primary_uq"
        ON "bank_account" ("customer_id")
        WHERE "is_primary" = TRUE AND "deleted_at" IS NULL;
    `)

    // ---------- demat_account ----------
    this.addSql(`
      CREATE TABLE IF NOT EXISTS "demat_account" (
        "id" TEXT NOT NULL,
        "customer_id" TEXT NOT NULL,
        "depository" TEXT NOT NULL,
        "dp_id" TEXT NULL,
        "client_id" TEXT NULL,
        "boid" TEXT NULL,
        "dp_name" TEXT NOT NULL,
        "account_holder_name" TEXT NOT NULL,
        "cmr_file_url" TEXT NOT NULL,
        "name_match_score" NUMERIC NULL,
        "verification_status" TEXT NOT NULL DEFAULT 'pending',
        "cashfree_reference_id" TEXT NULL,
        "verification_raw" JSONB NULL,
        "verified_at" TIMESTAMPTZ NULL,
        "is_primary" BOOLEAN NOT NULL DEFAULT FALSE,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "deleted_at" TIMESTAMPTZ NULL,
        CONSTRAINT "demat_account_pkey" PRIMARY KEY ("id")
      );
      CREATE INDEX IF NOT EXISTS "IDX_demat_account_customer_id" ON "demat_account" ("customer_id");
      CREATE UNIQUE INDEX IF NOT EXISTS "IDX_demat_account_primary_uq"
        ON "demat_account" ("customer_id")
        WHERE "is_primary" = TRUE AND "deleted_at" IS NULL;
    `)

    // ---------- cashfree_virtual_account ----------
    this.addSql(`
      CREATE TABLE IF NOT EXISTS "cashfree_virtual_account" (
        "id" TEXT NOT NULL,
        "customer_id" TEXT NOT NULL,
        "virtual_account_id" TEXT NOT NULL,
        "virtual_account_number" TEXT NOT NULL,
        "ifsc" TEXT NOT NULL,
        "upi_id" TEXT NULL,
        "beneficiary_name" TEXT NULL,
        "status" TEXT NOT NULL DEFAULT 'active',
        "raw" JSONB NULL,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "deleted_at" TIMESTAMPTZ NULL,
        CONSTRAINT "cashfree_virtual_account_pkey" PRIMARY KEY ("id")
      );
      CREATE UNIQUE INDEX IF NOT EXISTS "IDX_cfva_customer_id_uq"
        ON "cashfree_virtual_account" ("customer_id") WHERE "deleted_at" IS NULL;
      CREATE UNIQUE INDEX IF NOT EXISTS "IDX_cfva_virtual_account_id_uq"
        ON "cashfree_virtual_account" ("virtual_account_id") WHERE "deleted_at" IS NULL;
    `)

    // ---------- secure_id_verification ----------
    this.addSql(`
      CREATE TABLE IF NOT EXISTS "secure_id_verification" (
        "id" TEXT NOT NULL,
        "customer_id" TEXT NOT NULL,
        "kind" TEXT NOT NULL,
        "reference_id" TEXT NULL,
        "status" TEXT NOT NULL DEFAULT 'pending',
        "input_masked" TEXT NULL,
        "response_raw" JSONB NULL,
        "expires_at" TIMESTAMPTZ NULL,
        "attempt_no" INTEGER NOT NULL DEFAULT 1,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "deleted_at" TIMESTAMPTZ NULL,
        CONSTRAINT "secure_id_verification_pkey" PRIMARY KEY ("id")
      );
      CREATE INDEX IF NOT EXISTS "IDX_sid_customer_id" ON "secure_id_verification" ("customer_id");
      CREATE INDEX IF NOT EXISTS "IDX_sid_kind" ON "secure_id_verification" ("kind");
      CREATE INDEX IF NOT EXISTS "IDX_sid_customer_kind_created"
        ON "secure_id_verification" ("customer_id", "kind", "created_at");
    `)

    // ---------- wallet_payment_attempt ----------
    this.addSql(`
      CREATE TABLE IF NOT EXISTS "wallet_payment_attempt" (
        "id" TEXT NOT NULL,
        "cart_id" TEXT NOT NULL,
        "customer_id" TEXT NOT NULL,
        "payment_session_id" TEXT NULL,
        "amount_inr" BIGINT NOT NULL,
        "wallet_balance_at_init" BIGINT NOT NULL,
        "shortfall_inr" BIGINT NOT NULL DEFAULT 0,
        "wallet_debit_tx_id" TEXT NULL,
        "held_order_id" TEXT NULL,
        "status" TEXT NOT NULL DEFAULT 'initiated',
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "deleted_at" TIMESTAMPTZ NULL,
        CONSTRAINT "wallet_payment_attempt_pkey" PRIMARY KEY ("id")
      );
      CREATE INDEX IF NOT EXISTS "IDX_wpa_cart_id" ON "wallet_payment_attempt" ("cart_id");
      CREATE INDEX IF NOT EXISTS "IDX_wpa_customer_id" ON "wallet_payment_attempt" ("customer_id");
      CREATE INDEX IF NOT EXISTS "IDX_wpa_session_id" ON "wallet_payment_attempt" ("payment_session_id");
    `)

    // ---------- held_order ----------
    this.addSql(`
      CREATE TABLE IF NOT EXISTS "held_order" (
        "id" TEXT NOT NULL,
        "order_id" TEXT NOT NULL,
        "customer_id" TEXT NOT NULL,
        "required_total_inr" BIGINT NOT NULL,
        "shortfall_inr_at_creation" BIGINT NOT NULL,
        "status" TEXT NOT NULL DEFAULT 'awaiting_funds',
        "created_from_payment_attempt_id" TEXT NULL,
        "captured_at" TIMESTAMPTZ NULL,
        "cancelled_at" TIMESTAMPTZ NULL,
        "cancellation_reason" TEXT NULL,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "deleted_at" TIMESTAMPTZ NULL,
        CONSTRAINT "held_order_pkey" PRIMARY KEY ("id")
      );
      CREATE UNIQUE INDEX IF NOT EXISTS "IDX_held_order_order_id_uq"
        ON "held_order" ("order_id") WHERE "deleted_at" IS NULL;
      CREATE INDEX IF NOT EXISTS "IDX_held_order_customer_id" ON "held_order" ("customer_id");
      CREATE INDEX IF NOT EXISTS "IDX_held_order_status_created"
        ON "held_order" ("status", "created_at");
    `)

    // ---------- cashfree_webhook_event ----------
    this.addSql(`
      CREATE TABLE IF NOT EXISTS "cashfree_webhook_event" (
        "id" TEXT NOT NULL,
        "provider" TEXT NOT NULL DEFAULT 'cashfree',
        "channel" TEXT NOT NULL,
        "event_id" TEXT NOT NULL,
        "event_type" TEXT NULL,
        "signature" TEXT NULL,
        "payload_raw" JSONB NOT NULL,
        "processing_status" TEXT NOT NULL DEFAULT 'received',
        "processing_error" TEXT NULL,
        "processed_at" TIMESTAMPTZ NULL,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "deleted_at" TIMESTAMPTZ NULL,
        CONSTRAINT "cashfree_webhook_event_pkey" PRIMARY KEY ("id")
      );
      CREATE UNIQUE INDEX IF NOT EXISTS "IDX_cfwh_event_id_uq"
        ON "cashfree_webhook_event" ("event_id") WHERE "deleted_at" IS NULL;
      CREATE INDEX IF NOT EXISTS "IDX_cfwh_channel_status"
        ON "cashfree_webhook_event" ("channel", "processing_status");
    `)
  }

  async down(): Promise<void> {
    this.addSql('DROP TABLE IF EXISTS "cashfree_webhook_event" CASCADE;')
    this.addSql('DROP TABLE IF EXISTS "held_order" CASCADE;')
    this.addSql('DROP TABLE IF EXISTS "wallet_payment_attempt" CASCADE;')
    this.addSql('DROP TABLE IF EXISTS "secure_id_verification" CASCADE;')
    this.addSql('DROP TABLE IF EXISTS "cashfree_virtual_account" CASCADE;')
    this.addSql('DROP TABLE IF EXISTS "demat_account" CASCADE;')
    this.addSql('DROP TABLE IF EXISTS "bank_account" CASCADE;')
    this.addSql('DROP TABLE IF EXISTS "wallet_transaction" CASCADE;')
    this.addSql('DROP TABLE IF EXISTS "wallet" CASCADE;')
  }
}
