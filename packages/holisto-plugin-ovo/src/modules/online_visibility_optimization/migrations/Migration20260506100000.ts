import { Migration } from "@medusajs/framework/mikro-orm/migrations"

export class Migration20260506100000 extends Migration {
  override async up(): Promise<void> {
    this.addSql(
      `create table if not exists "ovo_setting" (` +
        `"id" text not null, ` +
        `"singleton_key" text not null default 'default', ` +
        `"master_enabled" boolean not null default true, ` +
        `"seo_enabled" boolean not null default true, ` +
        `"geo_enabled" boolean not null default true, ` +
        `"aeo_enabled" boolean not null default true, ` +
        `"llmo_enabled" boolean not null default true, ` +
        `"eeo_enabled" boolean not null default true, ` +
        `"kgo_enabled" boolean not null default true, ` +
        `"reo_enabled" boolean not null default true, ` +
        `"sgeo_enabled" boolean not null default true, ` +
        `"brand" jsonb null, ` +
        `"default_meta" jsonb null, ` +
        `"robots" jsonb null, ` +
        `"sitemap_shards" jsonb null, ` +
        `"entity" jsonb null, ` +
        `"faq" jsonb null, ` +
        `"citations" jsonb null, ` +
        `"llms_txt" jsonb null, ` +
        `"bot_policy" jsonb null, ` +
        `"retrieval" jsonb null, ` +
        `"generative" jsonb null, ` +
        `"updated_by_user_id" text null, ` +
        `"created_at" timestamptz not null default now(), ` +
        `"updated_at" timestamptz not null default now(), ` +
        `"deleted_at" timestamptz null, ` +
        `constraint "ovo_setting_pkey" primary key ("id")` +
        `);`,
    )
    this.addSql(
      `CREATE INDEX IF NOT EXISTS "IDX_ovo_setting_deleted_at" ON "ovo_setting" ("deleted_at") WHERE deleted_at IS NULL;`,
    )
  }

  override async down(): Promise<void> {
    this.addSql(`drop table if exists "ovo_setting" cascade;`)
  }
}
