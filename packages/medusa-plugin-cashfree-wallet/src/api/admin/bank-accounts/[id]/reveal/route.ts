import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import {
  CASHFREE_WALLET_MODULE,
  CashfreeWalletService,
} from "../../../../../modules/cashfree_wallet"
import { decryptString } from "../../../../../modules/cashfree_wallet/cashfree/crypto"
import { logger } from "../../../../../utils/logger"

/**
 * POST /admin/bank-accounts/:id/reveal
 *
 * Decrypt and return the full bank account number for one row.
 * Behind the admin auth + rate-limit middlewares; every reveal is
 * audit-logged so we can prove who saw what plaintext when, and
 * when (incident-response trail).
 *
 * Rationale: bank accounts are stored AES-256-GCM encrypted at
 * rest (`account_number_encrypted`); the storefront and default
 * admin views only ever see `account_number_last4`. Operator
 * workflows that need the full number (DIS share-transfer,
 * support call) hit this endpoint on click of a "Reveal" toggle.
 *
 * No request body. Returns `{ id, account_number }`.
 */
export const POST = async (req: MedusaRequest, res: MedusaResponse) => {
  const id = req.params.id as string | undefined
  if (!id) return res.status(400).json({ message: "Missing id" })

  const adminUserId =
    (req as any).auth_context?.actor_id ??
    (req as any).auth_context?.app_metadata?.user_id ??
    "unknown_admin"

  const walletModule = req.scope.resolve(
    CASHFREE_WALLET_MODULE,
  ) as CashfreeWalletService

  const [row] = await walletModule.listBankAccounts({ id }, { take: 1 })
  if (!row) return res.status(404).json({ message: "Bank account not found" })

  const encrypted = (row as any).account_number_encrypted as string | null
  if (!encrypted) {
    return res
      .status(404)
      .json({ message: "Account number not stored on this row" })
  }

  let plain: string
  try {
    plain = decryptString(encrypted)
  } catch (err) {
    logger.error("bank-account reveal failed: decrypt error", {
      id,
      error: (err as Error).message,
    })
    return res
      .status(500)
      .json({ message: "Failed to decrypt account number" })
  }

  // Audit-log every reveal — the goal is a defensible trail of
  // exactly which admin viewed which plaintext account number, when.
  // We do NOT log the plaintext itself (would defeat the purpose).
  try {
    await walletModule.logAdminAction({
      admin_user_id: adminUserId,
      customer_id: (row as any).customer_id ?? null,
      action: "bank_account.reveal",
      before: null,
      after: { bank_account_id: id, last4: (row as any).account_number_last4 },
      note: "Operator revealed full bank account number",
    })
  } catch (err) {
    // Don't block on the audit log — but flag loudly so we can
    // backfill the trail if the audit-log service was down.
    logger.warn("bank-account reveal audit-log failed", {
      id,
      admin_user_id: adminUserId,
      error: (err as Error).message,
    })
  }

  return res.json({ id, account_number: plain })
}
