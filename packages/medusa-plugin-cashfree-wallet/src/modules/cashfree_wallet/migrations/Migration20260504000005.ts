import { Migration } from "@medusajs/framework/mikro-orm/migrations";

/**
 * Rename `cashfree_setting.vba_prefix` → `beneficiary_name`.
 *
 * The old column name implied this was a *prefix* concatenated to
 * something else — it never was. The value lands directly into Cashfree
 * PG-VBA's `virtual_account_name` field, which Cashfree surfaces as
 * "Account Holder Name" on its dashboard and as the *beneficiary name*
 * on the remitter's transfer-confirmation screen.
 *
 * Operationally: post-rename, per-customer VBAs created via
 * `provisionVirtualAccountForCustomer` always override this setting
 * with the customer's PAN-verified name. The setting stays as a
 * fallback for any future shared-VBA use-case (marketing landing-page
 * collections etc.).
 *
 * Idempotent: the IF EXISTS / IF NOT EXISTS checks make this safe to
 * re-run if the column has already been renamed manually via psql.
 */
export class Migration20260504000005 extends Migration {

  override async up(): Promise<void> {
    // Mikro's migration runner runs as `medusa_app`. The cashfree_setting
    // table is owned by `medusa_app` (verified via earlier migration
    // patterns in this module) so RENAME COLUMN doesn't have the same
    // ownership trip-up the bank_record migration hit.
    this.addSql(
      `do $$ begin ` +
      `  if exists (select 1 from information_schema.columns ` +
      `             where table_name = 'cashfree_setting' ` +
      `               and column_name = 'vba_prefix') ` +
      `     and not exists (select 1 from information_schema.columns ` +
      `                     where table_name = 'cashfree_setting' ` +
      `                       and column_name = 'beneficiary_name') ` +
      `  then ` +
      `    alter table "cashfree_setting" rename column "vba_prefix" to "beneficiary_name"; ` +
      `  end if; ` +
      `end $$;`,
    );
    // Defensive: if both somehow exist (a partial manual rename), pull
    // any non-null vba_prefix into beneficiary_name and drop the old.
    this.addSql(
      `do $$ begin ` +
      `  if exists (select 1 from information_schema.columns ` +
      `             where table_name = 'cashfree_setting' ` +
      `               and column_name = 'vba_prefix') ` +
      `     and exists (select 1 from information_schema.columns ` +
      `                 where table_name = 'cashfree_setting' ` +
      `                   and column_name = 'beneficiary_name') ` +
      `  then ` +
      `    update "cashfree_setting" set beneficiary_name = coalesce(beneficiary_name, vba_prefix); ` +
      `    alter table "cashfree_setting" drop column "vba_prefix"; ` +
      `  end if; ` +
      `end $$;`,
    );
  }

  override async down(): Promise<void> {
    this.addSql(
      `alter table if exists "cashfree_setting" ` +
      `rename column "beneficiary_name" to "vba_prefix";`,
    );
  }
}
