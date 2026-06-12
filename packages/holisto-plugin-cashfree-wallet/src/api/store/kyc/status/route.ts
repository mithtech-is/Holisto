import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import {
  CASHFREE_WALLET_MODULE,
  CashfreeWalletService,
} from "../../../../modules/cashfree_wallet"
import { respondOk, respondErr } from "../../../../utils/envelope"

/**
 * GET /store/kyc/status
 *
 * Derived KYC status for the authenticated customer, computed from the
 * SecureIdVerification / BankAccount / DematAccount tables. Replaces reads
 * of `customer.metadata.kyc_status`.
 *
 * Response: envelope-shaped { ok: true, data: KycStatus } per
 * @polemarch/api-contracts/medusa#kycStatusResponse. Migrated in Phase 5
 * of the architecture refactor.
 */
export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const customerId = (req as any).auth_context?.app_metadata?.customer_id as
    | string
    | undefined
  if (!customerId) return respondErr(res, 401, "auth.unauthenticated", "Not authenticated")

  const walletModule = req.scope.resolve(
    CASHFREE_WALLET_MODULE
  ) as CashfreeWalletService
  const status = await walletModule.getKycStatus(customerId)
  return respondOk(res, status)
}
