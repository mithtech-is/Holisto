import { Migration } from "@mikro-orm/migrations"

export class Migration20260504000000 extends Migration {
  async up(): Promise<void> {
    this.addSql(`
      CREATE TABLE IF NOT EXISTS "customer_client_id" (
        "id" TEXT NOT NULL,
        "customer_id" TEXT NOT NULL,
        "client_id" TEXT NOT NULL,
        "seq" INTEGER NOT NULL,
        "iso_year" INTEGER NOT NULL,
        "iso_week" INTEGER NOT NULL,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "deleted_at" TIMESTAMPTZ NULL,
        CONSTRAINT "customer_client_id_pkey" PRIMARY KEY ("id")
      );

      CREATE UNIQUE INDEX IF NOT EXISTS "IDX_customer_client_id_customer_uq"
        ON "customer_client_id" ("customer_id") WHERE "deleted_at" IS NULL;
      CREATE UNIQUE INDEX IF NOT EXISTS "IDX_customer_client_id_client_id_uq"
        ON "customer_client_id" ("client_id") WHERE "deleted_at" IS NULL;
      CREATE UNIQUE INDEX IF NOT EXISTS "IDX_customer_client_id_week_seq_uq"
        ON "customer_client_id" ("iso_year", "iso_week", "seq")
        WHERE "deleted_at" IS NULL;
      CREATE INDEX IF NOT EXISTS "IDX_customer_client_id_deleted_at"
        ON "customer_client_id" ("deleted_at") WHERE "deleted_at" IS NOT NULL;
    `)
  }

  async down(): Promise<void> {
    this.addSql('DROP TABLE IF EXISTS "customer_client_id" CASCADE;')
  }
}
