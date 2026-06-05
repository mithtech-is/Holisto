import { Migration } from "@mikro-orm/migrations"

/**
 * Add optional bank-proof document columns to `bank_account`.
 *
 * Customers can upload any ONE of: cancelled cheque, front page of
 * passbook, or a 6-month bank statement as proof of the account. The
 * type is recorded in `bank_proof_type` (e.g. "cheque" | "passbook" |
 * "statement"), and the file URL in `bank_proof_file_url`.
 *
 * Both columns are nullable — this document is not required for any
 * transactional flow, just kept for admin review / manual verification.
 */
export class Migration20260415130000 extends Migration {
  async up(): Promise<void> {
    this.addSql(`
      ALTER TABLE "bank_account"
        ADD COLUMN IF NOT EXISTS "bank_proof_file_url" TEXT NULL;
      ALTER TABLE "bank_account"
        ADD COLUMN IF NOT EXISTS "bank_proof_type" TEXT NULL;
    `)
  }

  async down(): Promise<void> {
    this.addSql(`
      ALTER TABLE "bank_account"
        DROP COLUMN IF EXISTS "bank_proof_file_url";
      ALTER TABLE "bank_account"
        DROP COLUMN IF EXISTS "bank_proof_type";
    `)
  }
}
