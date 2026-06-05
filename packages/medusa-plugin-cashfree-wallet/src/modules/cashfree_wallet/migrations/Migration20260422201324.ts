import { Migration } from "@mikro-orm/migrations"

/**
 * Cashfree product expansion.
 *
 * Cashfree exposes each product as a separate integration with its own
 * (x-client-id, x-client-secret, webhook_signing_secret) triple. The prior
 * schema only modelled two slots (verification + payouts-ish) and conflated
 * PG's Auto-Collect/VBA webhook with the Payouts webhook. This migration
 * adds explicit, per-env columns for each supported product:
 *
 *   - Payment Gateway    (PG, includes Auto-Collect /pg/vba)
 *   - Payouts            (outbound disbursements)
 *   - Subscriptions      (recurring mandates)
 *   - Cross-border       (international receive)
 *   - Verification Suite (Secure ID, production-only — no test mode in the
 *                         Cashfree merchant dashboard; sandbox slot kept for
 *                         future affordance but hidden in UI)
 *
 * Plus per-product flags:
 *   - `<product>_enabled`      : admin toggle. When off, runtime throws
 *                                 "product disabled" rather than attempting
 *                                 calls with stale/missing creds.
 *   - `<product>_active_env`   : which env is live for that product
 *                                 (sandbox | production). Verification Suite
 *                                 has no active_env column — always
 *                                 production at the service layer.
 *
 * Legacy per-env columns from Migration20260422190517 are retained and
 * mapped to concrete products by the service:
 *   - {sandbox,production}_client_*              → Verification Suite
 *   - {sandbox,production}_payouts_*             → Payouts
 *   - {sandbox,production}_webhook_secret_*      → Payouts webhook
 *   - {sandbox,production}_verify_webhook_secret → Verification webhook
 *
 * Prod DB currently has zero cashfree_setting rows (credentials were
 * env-var-only) so no data backfill is required.
 */
export class Migration20260422201324 extends Migration {
  async up(): Promise<void> {
    // Per-product flags
    this.addSql(`
      ALTER TABLE "cashfree_setting"
        ADD COLUMN IF NOT EXISTS "pg_enabled"                BOOLEAN NOT NULL DEFAULT false,
        ADD COLUMN IF NOT EXISTS "pg_active_env"             TEXT    NOT NULL DEFAULT 'sandbox',
        ADD COLUMN IF NOT EXISTS "payouts_enabled"           BOOLEAN NOT NULL DEFAULT false,
        ADD COLUMN IF NOT EXISTS "payouts_active_env"        TEXT    NOT NULL DEFAULT 'sandbox',
        ADD COLUMN IF NOT EXISTS "subscriptions_enabled"     BOOLEAN NOT NULL DEFAULT false,
        ADD COLUMN IF NOT EXISTS "subscriptions_active_env"  TEXT    NOT NULL DEFAULT 'sandbox',
        ADD COLUMN IF NOT EXISTS "cross_border_enabled"      BOOLEAN NOT NULL DEFAULT false,
        ADD COLUMN IF NOT EXISTS "cross_border_active_env"   TEXT    NOT NULL DEFAULT 'sandbox',
        ADD COLUMN IF NOT EXISTS "verification_enabled"      BOOLEAN NOT NULL DEFAULT false;
    `)

    // New per-env credentials for products that didn't previously have a
    // dedicated slot: PG, Subscriptions, Cross-border.
    const products = ["pg", "subscriptions", "cross_border"] as const
    const envs = ["sandbox", "production"] as const
    const cols: string[] = []
    for (const p of products) {
      for (const e of envs) {
        cols.push(`ADD COLUMN IF NOT EXISTS "${e}_${p}_client_id"                  TEXT NULL`)
        cols.push(`ADD COLUMN IF NOT EXISTS "${e}_${p}_client_secret_encrypted"    TEXT NULL`)
        cols.push(`ADD COLUMN IF NOT EXISTS "${e}_${p}_webhook_secret_encrypted"   TEXT NULL`)
      }
    }
    this.addSql(`ALTER TABLE "cashfree_setting"\n  ${cols.join(",\n  ")};`)
  }

  async down(): Promise<void> {
    const products = ["pg", "subscriptions", "cross_border"] as const
    const envs = ["sandbox", "production"] as const
    const drops: string[] = [
      `DROP COLUMN IF EXISTS "pg_enabled"`,
      `DROP COLUMN IF EXISTS "pg_active_env"`,
      `DROP COLUMN IF EXISTS "payouts_enabled"`,
      `DROP COLUMN IF EXISTS "payouts_active_env"`,
      `DROP COLUMN IF EXISTS "subscriptions_enabled"`,
      `DROP COLUMN IF EXISTS "subscriptions_active_env"`,
      `DROP COLUMN IF EXISTS "cross_border_enabled"`,
      `DROP COLUMN IF EXISTS "cross_border_active_env"`,
      `DROP COLUMN IF EXISTS "verification_enabled"`,
    ]
    for (const p of products) {
      for (const e of envs) {
        drops.push(`DROP COLUMN IF EXISTS "${e}_${p}_client_id"`)
        drops.push(`DROP COLUMN IF EXISTS "${e}_${p}_client_secret_encrypted"`)
        drops.push(`DROP COLUMN IF EXISTS "${e}_${p}_webhook_secret_encrypted"`)
      }
    }
    this.addSql(`ALTER TABLE "cashfree_setting"\n  ${drops.join(",\n  ")};`)
  }
}
