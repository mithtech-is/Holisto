import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import {
  CASHFREE_WALLET_MODULE,
  CashfreeWalletService,
} from "../../../../../modules/cashfree_wallet"

/**
 * PATCH /store/demat-accounts/:id/primary
 *
 * Make :id the customer's primary demat. Atomic — flips is_primary off on
 * all siblings and on for :id. Rejects unverified targets.
 */
export const PATCH = async (req: MedusaRequest, res: MedusaResponse) => {
  const customerId = (req as any).auth_context?.app_metadata?.customer_id as
    | string
    | undefined
  if (!customerId) return res.status(401).json({ message: "Not authenticated" })
  const { id } = req.params

  const walletModule = req.scope.resolve(
    CASHFREE_WALLET_MODULE
  ) as CashfreeWalletService

  const target = await walletModule
    .retrieveDematAccount(id as string)
    .catch(() => null)
  if (!target || target.customer_id !== customerId) {
    return res.status(404).json({ message: "Not found" })
  }
  try {
    const updated = await walletModule.setPrimaryDemat(customerId, id as string)
    res.json({ demat_account: { id: updated.id, is_primary: updated.is_primary } })
  } catch (err) {
    res.status(400).json({ message: (err as Error).message })
  }
}
