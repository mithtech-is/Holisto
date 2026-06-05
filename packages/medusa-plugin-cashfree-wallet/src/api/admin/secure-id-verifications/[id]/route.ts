import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import {
  CASHFREE_WALLET_MODULE,
  CashfreeWalletService,
} from "../../../../modules/cashfree_wallet"

/**
 * GET /admin/secure-id-verifications/:id
 *
 * Single verification row including the redacted `response_raw`. The list
 * endpoint intentionally strips `response_raw` from its payload — it's
 * verbose and most list screens never need it. Drill-down into the audit
 * page pulls the full row via this endpoint.
 */
export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const id = req.params.id as string | undefined
  if (!id) return res.status(400).json({ message: "Missing id" })

  const walletModule = req.scope.resolve(
    CASHFREE_WALLET_MODULE
  ) as CashfreeWalletService

  const row = await walletModule
    .retrieveSecureIdVerification(id)
    .catch(() => null)
  if (!row) return res.status(404).json({ message: "Not found" })

  res.json({
    verification: {
      id: row.id,
      customer_id: row.customer_id,
      kind: row.kind,
      status: row.status,
      reference_id: row.reference_id,
      input_masked: row.input_masked,
      response_raw: row.response_raw,
      expires_at: row.expires_at,
      attempt_no: row.attempt_no,
      created_at: row.created_at,
      updated_at: row.updated_at,
    },
  })
}
