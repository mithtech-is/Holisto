// @ts-nocheck
import { Migration } from "@medusajs/framework/mikro-orm/migrations"

export class Migration20260608000000 extends Migration {
  override async up(): Promise<void> {
    this.addSql(`CREATE TABLE IF NOT EXISTS "communication_brand_config" (
      "id" text NOT NULL,
      "tenant_key" text NOT NULL DEFAULT 'default',
      "brand_name" text NOT NULL DEFAULT 'Communication Hub',
      "company_name" text NULL,
      "storefront_url" text NOT NULL DEFAULT 'https://example.com',
      "tagline" text NULL,
      "support_email" text NULL,
      "support_phone" text NULL,
      "address" text NULL,
      "whatsapp_bot_label" text NOT NULL DEFAULT 'Initiate Bot',
      "whatsapp_bot_categories" jsonb NULL,
      "updated_by_user_id" text NULL,
      "created_at" timestamptz NOT NULL DEFAULT now(),
      "updated_at" timestamptz NOT NULL DEFAULT now(),
      "deleted_at" timestamptz NULL,
      CONSTRAINT "communication_brand_config_pkey" PRIMARY KEY ("id")
    );`)
    this.addSql(`CREATE UNIQUE INDEX IF NOT EXISTS "IDX_comm_brand_tenant" ON "communication_brand_config" ("tenant_key") WHERE deleted_at IS NULL;`)

    this.addSql(`CREATE TABLE IF NOT EXISTS "communication_provider_config" (
      "id" text NOT NULL,
      "tenant_key" text NOT NULL DEFAULT 'default',
      "channel" text NOT NULL,
      "provider" text NOT NULL,
      "enabled" boolean NOT NULL DEFAULT false,
      "is_primary" boolean NOT NULL DEFAULT true,
      "is_fallback" boolean NOT NULL DEFAULT false,
      "settings" jsonb NULL,
      "secrets" jsonb NULL,
      "last_test_ok" boolean NULL,
      "last_test_error" text NULL,
      "last_test_at" timestamptz NULL,
      "created_at" timestamptz NOT NULL DEFAULT now(),
      "updated_at" timestamptz NOT NULL DEFAULT now(),
      "deleted_at" timestamptz NULL,
      CONSTRAINT "communication_provider_config_pkey" PRIMARY KEY ("id")
    );`)
    this.addSql(`CREATE UNIQUE INDEX IF NOT EXISTS "IDX_comm_provider_tenant_channel_provider" ON "communication_provider_config" ("tenant_key","channel","provider") WHERE deleted_at IS NULL;`)

    this.addSql(`CREATE TABLE IF NOT EXISTS "communication_template" (
      "id" text NOT NULL,
      "tenant_key" text NOT NULL DEFAULT 'default',
      "channel" text NOT NULL,
      "slug" text NOT NULL,
      "name" text NULL,
      "label" text NULL,
      "description" text NULL,
      "category" text NULL,
      "language" text NULL,
      "template_type" text NULL,
      "subject" text NULL,
      "body" text NULL,
      "html" text NULL,
      "mjml" text NULL,
      "components" jsonb NULL,
      "variables" jsonb NULL,
      "media" jsonb NULL,
      "is_system" boolean NOT NULL DEFAULT false,
      "is_otp" boolean NOT NULL DEFAULT false,
      "dlt_template_id" text NULL,
      "dlt_status" text NULL,
      "provider_template_id" text NULL,
      "provider_status" text NULL,
      "provider_pushed_at" timestamptz NULL,
      "provider_last_synced_at" timestamptz NULL,
      "provider_last_error" text NULL,
      "created_at" timestamptz NOT NULL DEFAULT now(),
      "updated_at" timestamptz NOT NULL DEFAULT now(),
      "deleted_at" timestamptz NULL,
      CONSTRAINT "communication_template_pkey" PRIMARY KEY ("id")
    );`)
    this.addSql(`CREATE UNIQUE INDEX IF NOT EXISTS "IDX_comm_template_tenant_channel_slug" ON "communication_template" ("tenant_key","channel","slug") WHERE deleted_at IS NULL;`)

    this.addSql(`CREATE TABLE IF NOT EXISTS "communication_event_rule" (
      "id" text NOT NULL,
      "tenant_key" text NOT NULL DEFAULT 'default',
      "event_name" text NOT NULL,
      "channel" text NOT NULL,
      "template_slug" text NOT NULL,
      "recipient_resolver" text NOT NULL DEFAULT 'customer',
      "static_recipient" text NULL,
      "enabled" boolean NOT NULL DEFAULT true,
      "delay_seconds" integer NOT NULL DEFAULT 0,
      "conditions" jsonb NULL,
      "retry_policy" jsonb NULL,
      "created_at" timestamptz NOT NULL DEFAULT now(),
      "updated_at" timestamptz NOT NULL DEFAULT now(),
      "deleted_at" timestamptz NULL,
      CONSTRAINT "communication_event_rule_pkey" PRIMARY KEY ("id")
    );`)

    this.addSql(`CREATE TABLE IF NOT EXISTS "communication_message_log" (
      "id" text NOT NULL,
      "tenant_key" text NOT NULL DEFAULT 'default',
      "channel" text NOT NULL,
      "event_name" text NULL,
      "template_slug" text NULL,
      "recipient" text NOT NULL,
      "to_phone" text NULL,
      "to_email" text NULL,
      "subject" text NULL,
      "body" text NULL,
      "provider" text NULL,
      "provider_message_id" text NULL,
      "status" text NOT NULL DEFAULT 'queued',
      "error" text NULL,
      "metadata" jsonb NULL,
      "opened_at" timestamptz NULL,
      "clicked_at" timestamptz NULL,
      "delivered_at" timestamptz NULL,
      "read_at" timestamptz NULL,
      "created_at" timestamptz NOT NULL DEFAULT now(),
      "updated_at" timestamptz NOT NULL DEFAULT now(),
      "deleted_at" timestamptz NULL,
      CONSTRAINT "communication_message_log_pkey" PRIMARY KEY ("id")
    );`)
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_comm_log_channel_status_created" ON "communication_message_log" ("channel","status","created_at");`)

    this.addSql(`CREATE TABLE IF NOT EXISTS "communication_otp_request" (
      "id" text NOT NULL,
      "tenant_key" text NOT NULL DEFAULT 'default',
      "phone_e164" text NOT NULL,
      "purpose" text NOT NULL,
      "customer_id" text NULL,
      "code_hash" text NOT NULL,
      "attempts" integer NOT NULL DEFAULT 0,
      "max_attempts" integer NOT NULL DEFAULT 5,
      "resend_count" integer NOT NULL DEFAULT 0,
      "resend_available_at" timestamptz NULL,
      "expires_at" timestamptz NOT NULL,
      "consumed_at" timestamptz NULL,
      "sent_via" text NULL,
      "ip_hash" text NULL,
      "created_at" timestamptz NOT NULL DEFAULT now(),
      "updated_at" timestamptz NOT NULL DEFAULT now(),
      "deleted_at" timestamptz NULL,
      CONSTRAINT "communication_otp_request_pkey" PRIMARY KEY ("id")
    );`)
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_comm_otp_phone_purpose_created" ON "communication_otp_request" ("phone_e164","purpose","created_at");`)

    this.addSql(`CREATE TABLE IF NOT EXISTS "communication_webhook_event" (
      "id" text NOT NULL,
      "tenant_key" text NOT NULL DEFAULT 'default',
      "provider" text NOT NULL,
      "event_type" text NULL,
      "signature" text NULL,
      "replay_key" text NULL,
      "payload" jsonb NULL,
      "status" text NOT NULL DEFAULT 'received',
      "processing_result" jsonb NULL,
      "processed_at" timestamptz NULL,
      "created_at" timestamptz NOT NULL DEFAULT now(),
      "updated_at" timestamptz NOT NULL DEFAULT now(),
      "deleted_at" timestamptz NULL,
      CONSTRAINT "communication_webhook_event_pkey" PRIMARY KEY ("id")
    );`)
    this.addSql(`CREATE UNIQUE INDEX IF NOT EXISTS "IDX_comm_webhook_replay" ON "communication_webhook_event" ("provider","replay_key") WHERE replay_key IS NOT NULL AND deleted_at IS NULL;`)

    this.addSql(`CREATE TABLE IF NOT EXISTS "communication_audit_log" (
      "id" text NOT NULL,
      "tenant_key" text NOT NULL DEFAULT 'default',
      "actor_user_id" text NULL,
      "action" text NOT NULL,
      "resource_type" text NOT NULL,
      "resource_id" text NULL,
      "old_value" jsonb NULL,
      "new_value" jsonb NULL,
      "metadata" jsonb NULL,
      "created_at" timestamptz NOT NULL DEFAULT now(),
      "updated_at" timestamptz NOT NULL DEFAULT now(),
      "deleted_at" timestamptz NULL,
      CONSTRAINT "communication_audit_log_pkey" PRIMARY KEY ("id")
    );`)
  }

  override async down(): Promise<void> {
    this.addSql(`DROP TABLE IF EXISTS "communication_audit_log";`)
    this.addSql(`DROP TABLE IF EXISTS "communication_webhook_event";`)
    this.addSql(`DROP TABLE IF EXISTS "communication_otp_request";`)
    this.addSql(`DROP TABLE IF EXISTS "communication_message_log";`)
    this.addSql(`DROP TABLE IF EXISTS "communication_event_rule";`)
    this.addSql(`DROP TABLE IF EXISTS "communication_template";`)
    this.addSql(`DROP TABLE IF EXISTS "communication_provider_config";`)
    this.addSql(`DROP TABLE IF EXISTS "communication_brand_config";`)
  }
}
