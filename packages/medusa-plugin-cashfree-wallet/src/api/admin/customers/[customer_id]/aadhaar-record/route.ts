import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { Modules } from "@medusajs/framework/utils"
import {
  CASHFREE_WALLET_MODULE,
  CashfreeWalletService,
} from "../../../../../modules/cashfree_wallet"
import { logger } from "../../../../../utils/logger"

/**
 * GET /admin/customers/:customer_id/aadhaar-record
 *
 * Returns the customer's Aadhaar data — sourced from the GLOBAL
 * `aadhaar_record` table (one row per unique Aadhaar hash, survives
 * customer deletion). Lookup path: customer.metadata.aadhaar_hash →
 * aadhaar_record by hash.
 *
 * 404 when the customer hasn't completed Aadhaar OTP verify (no
 * `aadhaar_hash` on metadata).
 */
export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const customerId = req.params.customer_id as string
  if (!customerId) {
    return res.status(400).json({ message: "Missing customer_id" })
  }
  const customerModule = req.scope.resolve(Modules.CUSTOMER) as any
  const walletModule = req.scope.resolve(
    CASHFREE_WALLET_MODULE,
  ) as CashfreeWalletService
  try {
    const customer = await customerModule
      .retrieveCustomer(customerId)
      .catch(() => null)
    if (!customer) {
      return res.status(404).json({ message: "Customer not found" })
    }
    const meta = (customer.metadata ?? {}) as Record<string, unknown>
    const hash = typeof meta.aadhaar_hash === "string" ? meta.aadhaar_hash : null
    if (!hash) {
      return res
        .status(404)
        .json({ message: "No Aadhaar on record", verified: false })
    }
    const record = await walletModule.lookupAadhaarRecordByHash(hash)
    if (!record) {
      return res
        .status(404)
        .json({ message: "Aadhaar record missing on global table", verified: false })
    }
    res.json({ verified: true, aadhaar_record: record })
  } catch (err: any) {
    logger.error("admin aadhaar-record GET failed", {
      customer_id: customerId,
      error: err?.message,
    })
    res.status(500).json({ message: err?.message ?? "load_failed" })
  }
}
