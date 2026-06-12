import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import {
  CASHFREE_WALLET_MODULE,
  CashfreeWalletService,
} from "../../../../modules/cashfree_wallet"

/**
 * GET /admin/aadhaar-records/:hash
 *
 * Drill-down detail for one aadhaar_record. Returns:
 *   - aadhaar_record    : full row (incl. response_raw)
 *   - linked_customers  : every customer whose metadata.aadhaar_hash
 *                          points here
 *   - verifications     : recent secure_id_verification rows for
 *                          kind='aadhaar_otp_verify' OR
 *                          'aadhaar_otp_send' tied to those customers
 *
 * UIDAI compliance: the full 12-digit Aadhaar is never stored or
 * returned. The :hash path is the SHA-256 of the typed Aadhaar.
 */
export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const hash = (req.params.hash as string | undefined)?.trim()
  if (!hash || !/^[a-f0-9]{64}$/i.test(hash)) {
    return res.status(400).json({ message: "Invalid aadhaar_hash" })
  }

  const walletModule = req.scope.resolve(
    CASHFREE_WALLET_MODULE,
  ) as CashfreeWalletService
  const pg: any = req.scope.resolve(ContainerRegistrationKeys.PG_CONNECTION)

  const record = await walletModule.lookupAadhaarRecordByHash(hash)
  if (!record)
    return res.status(404).json({ message: "Aadhaar record not found" })

  // Knex/pg uses `?` positional bindings.
  const customersQ = await pg.raw(
    `
    SELECT id, email, first_name, last_name, created_at, deleted_at
    FROM customer
    WHERE metadata->>'aadhaar_hash' = ?
    ORDER BY created_at DESC
    LIMIT 100
    `,
    [hash],
  )
  const linked_customers = (customersQ.rows ?? customersQ).map((r: any) => ({
    id: r.id,
    email: r.email,
    first_name: r.first_name,
    last_name: r.last_name,
    created_at: r.created_at,
    deleted_at: r.deleted_at,
  }))

  let verifications: any[] = []
  if (linked_customers.length) {
    const ids = linked_customers.map((c: any) => c.id)
    const vq = await pg.raw(
      `
      SELECT id, customer_id, kind, status, reference_id, input_masked,
             expires_at, attempt_no, created_at, updated_at
      FROM secure_id_verification
      WHERE kind IN ('aadhaar_otp_send', 'aadhaar_otp_verify')
        AND customer_id = ANY(?::text[])
      ORDER BY created_at DESC
      LIMIT 50
      `,
      [ids],
    )
    verifications = vq.rows ?? vq
  }

  res.json({ aadhaar_record: record, linked_customers, verifications })
}
