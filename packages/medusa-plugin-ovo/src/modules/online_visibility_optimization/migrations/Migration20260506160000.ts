import { Migration } from "@medusajs/framework/mikro-orm/migrations"

export class Migration20260506160000 extends Migration {
  override async up(): Promise<void> {
    // ovo_override — new columns
    this.addSql(
      `alter table if exists "ovo_override" add column if not exists "custom_json_ld" jsonb null;`,
    )
    this.addSql(
      `alter table if exists "ovo_override" add column if not exists "inherit_default_faq" boolean not null default false;`,
    )
    this.addSql(
      `alter table if exists "ovo_override" add column if not exists "inherit_default_json_ld" boolean not null default false;`,
    )

    // ovo_setting — type-specific default FAQs (cascade fallback for
    // product / category pages without per-entity overrides).
    this.addSql(
      `alter table if exists "ovo_setting" add column if not exists "default_product_faq" jsonb null;`,
    )
    this.addSql(
      `alter table if exists "ovo_setting" add column if not exists "default_category_faq" jsonb null;`,
    )
  }

  override async down(): Promise<void> {
    this.addSql(
      `alter table if exists "ovo_override" drop column if exists "custom_json_ld";`,
    )
    this.addSql(
      `alter table if exists "ovo_override" drop column if exists "inherit_default_faq";`,
    )
    this.addSql(
      `alter table if exists "ovo_override" drop column if exists "inherit_default_json_ld";`,
    )
    this.addSql(
      `alter table if exists "ovo_setting" drop column if exists "default_product_faq";`,
    )
    this.addSql(
      `alter table if exists "ovo_setting" drop column if exists "default_category_faq";`,
    )
  }
}
