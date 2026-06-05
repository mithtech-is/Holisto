import { Migration } from "@medusajs/framework/mikro-orm/migrations"

export class Migration20260506150000 extends Migration {
  override async up(): Promise<void> {
    this.addSql(
      `create table if not exists "ovo_override" (` +
        `"id" text not null, ` +
        `"entity_type" text not null, ` +
        `"entity_id" text not null, ` +
        `"seo_title" text null, ` +
        `"seo_description" text null, ` +
        `"og_image_url" text null, ` +
        `"canonical_url" text null, ` +
        `"keywords" jsonb null, ` +
        `"noindex" boolean not null default false, ` +
        `"faq" jsonb null, ` +
        `"summary_paragraph" text null, ` +
        `"author" text null, ` +
        `"reviewer" text null, ` +
        `"last_updated" text null, ` +
        `"updated_by_user_id" text null, ` +
        `"created_at" timestamptz not null default now(), ` +
        `"updated_at" timestamptz not null default now(), ` +
        `"deleted_at" timestamptz null, ` +
        `constraint "ovo_override_pkey" primary key ("id")` +
        `);`,
    )
    this.addSql(
      `CREATE UNIQUE INDEX IF NOT EXISTS "IDX_ovo_override_entity_type_entity_id_unique" ON "ovo_override" ("entity_type", "entity_id") WHERE deleted_at IS NULL;`,
    )
    this.addSql(
      `CREATE INDEX IF NOT EXISTS "IDX_ovo_override_entity_type_entity_id" ON "ovo_override" ("entity_type", "entity_id") WHERE deleted_at IS NULL;`,
    )
    this.addSql(
      `CREATE INDEX IF NOT EXISTS "IDX_ovo_override_deleted_at" ON "ovo_override" ("deleted_at") WHERE deleted_at IS NULL;`,
    )
  }

  override async down(): Promise<void> {
    this.addSql(`drop table if exists "ovo_override" cascade;`)
  }
}
