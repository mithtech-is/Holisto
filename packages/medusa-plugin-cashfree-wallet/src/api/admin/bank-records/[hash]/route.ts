import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import {
  CASHFREE_WALLET_MODULE,
  CashfreeWalletService,
} from "../../../../modules/cashfree_wallet"

/**
 * GET /admin/bank-records/:hash
 *
 * Drill-down for a single bank_record. Returns:
 *   - bank_record       — full row (incl. ifsc_details + response_raw)
 *   - linked_customers  — every bank_account whose `bank_hash` ==
 *                          this hash, joined to the customer table
 *   - verifications     — secure_id_verification rows with
 *                          kind='bank_penny' for the linked customers
 *
 * `:hash` is the SHA-256 hex of `<IFSC>:<account_number>`. 64 hex
 * chars enforced by regex below.
 */
export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const hash = (req.params.hash as string | undefined)?.trim()
  if (!hash || !/^[a-f0-9]{64}$/i.test(hash)) {
    return res.status(400).json({ message: "Invalid bank_hash" })
  }

  const walletModule = req.scope.resolve(
    CASHFREE_WALLET_MODULE,
  ) as CashfreeWalletService
  const pg: any = req.scope.resolve(ContainerRegistrationKeys.PG_CONNECTION)

  const record = await walletModule.lookupBankRecordByHash(hash)
  if (!record)
    return res.status(404).json({ message: "Bank record not found" })

  const customersQ = await pg.raw(
    `
    SELECT ba.id AS bank_account_id, ba.customer_id, ba.is_primary,
           ba.verification_status, ba.account_holder_name, ba.created_at,
           ba.deleted_at AS bank_account_deleted_at,
           c.email, c.first_name, c.last_name, c.deleted_at AS customer_deleted_at
    FROM bank_account ba
    LEFT JOIN customer c ON c.id = ba.customer_id
    WHERE ba.bank_hash = ?
    ORDER BY ba.created_at DESC
    LIMIT 100
    `,
    [hash],
  )
  const linked_customers = (customersQ.rows ?? customersQ).map((r: any) => ({
    bank_account_id: r.bank_account_id,
    customer_id: r.customer_id,
    is_primary: r.is_primary,
    verification_status: r.verification_status,
    account_holder_name: r.account_holder_name,
    email: r.email ?? null,
    first_name: r.first_name ?? null,
    last_name: r.last_name ?? null,
    created_at: r.created_at,
    bank_account_deleted_at: r.bank_account_deleted_at,
    customer_deleted_at: r.customer_deleted_at,
  }))

  let verifications: any[] = []
  if (linked_customers.length) {
    const ids = Array.from(
      new Set(linked_customers.map((c: any) => c.customer_id)),
    )
    const vq = await pg.raw(
      `
      SELECT id, customer_id, kind, status, reference_id, input_masked,
             expires_at, attempt_no, created_at, updated_at
      FROM secure_id_verification
      WHERE kind = 'bank_penny'
        AND customer_id = ANY(?::text[])
      ORDER BY created_at DESC
      LIMIT 50
      `,
      [ids],
    )
    verifications = vq.rows ?? vq
  }

  res.json({ bank_record: record, linked_customers, verifications })
}
