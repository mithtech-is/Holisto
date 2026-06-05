import { model } from "@medusajs/framework/utils"

/**
 * Cashfree Virtual Bank Account — one row per linked customer bank
 * account. Auto Collect (`POST /pg/vba`) creates a VBA locked to a
 * specific source bank via `allowed_remitters: [{account_number, ifsc}]`.
 *
 * Lifecycle:
 *   - Customer adds + verifies a bank account (penny-drop, name match).
 *   - We auto-provision a VBA tied to that bank → `bank_account_id` set,
 *     `allowed_remitters` populated.
 *   - Customer transfers from that bank → AMOUNT_COLLECTED webhook fires
 *     → we credit their wallet.
 *   - If the bank is removed, we mark the VBA `closed` rather than delete.
 *
 * `bank_account_id` is the application-level link to BankAccount. The
 * partial unique index in the migration enforces "at most one active VBA
 * per bank". The `customer_id` index is a fast lookup for the wallet
 * page; multiple rows per customer is now the norm.
 *
 * `virtual_account_id` is the merchant-side ID we pass to Cashfree at
 * create time and the dedupe key on the way back through webhooks. We
 * derive it from the bank id (e.g. `vba_<bank_account_id>`) so it's
 * predictable.
 */
export const CashfreeVirtualAccount = model.define("cashfree_virtual_account", {
  id: model.id().primaryKey(),
  customer_id: model.text().index(),
  bank_account_id: model.text().nullable(),
  virtual_account_id: model.text().unique(),
  virtual_account_number: model.text(),
  ifsc: model.text(),
  upi_id: model.text().nullable(),
  beneficiary_name: model.text().nullable(),
  bank_code: model.text().nullable(),
  status: model.enum(["active", "closed"]).default("active"),
  raw: model.json().nullable(),
})
