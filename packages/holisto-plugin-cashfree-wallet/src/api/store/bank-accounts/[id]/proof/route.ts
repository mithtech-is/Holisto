import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { z } from "zod"
import {
  CASHFREE_WALLET_MODULE,
  CashfreeWalletService,
} from "../../../../../modules/cashfree_wallet"

/**
 * PATCH /store/bank-accounts/:id/proof
 *
 * Attach (or replace) the optional bank-proof document on a bank account.
 * Accepts one of:
 *   - cancelled cheque
 *   - front page of passbook
 *   - last 6-month bank statement
 *
 * Storing this is completely optional — it does NOT gate any transaction
 * or verification flow. Admins use it for manual KYC review.
 *
 * Body:
 *   { bank_proof_file_url: string, bank_proof_type: "cheque"|"passbook"|"statement" }
 * Or to clear: both null.
 */
const BodySchema = z.object({
  bank_proof_file_url: z
    .string()
    .trim()
    .refine(
      (s) => s.startsWith("/static/") || /^https?:\/\//i.test(s),
      "Invalid document URL — must be /static/… or https://…"
    )
    .nullable(),
  bank_proof_type: z.enum(["cheque", "passbook", "statement"]).nullable(),
})

export const PATCH = async (req: MedusaRequest, res: MedusaResponse) => {
  const customerId = (req as any).auth_context?.app_metadata?.customer_id as
    | string
    | undefined
  if (!customerId) return res.status(401).json({ message: "Not authenticated" })
  const { id } = req.params
  if (!id) return res.status(400).json({ message: "Missing id" })

  const parsed = BodySchema.safeParse(req.body)
  if (!parsed.success) {
    return res
      .status(400)
      .json({ message: "Invalid input", errors: parsed.error.flatten() })
  }
  // Must set both or clear both — the type without a file makes no sense.
  const { bank_proof_file_url, bank_proof_type } = parsed.data
  if (
    (bank_proof_file_url === null) !== (bank_proof_type === null)
  ) {
    return res.status(400).json({
      message:
        "bank_proof_file_url and bank_proof_type must be set together or cleared together",
    })
  }

  const walletModule = req.scope.resolve(
    CASHFREE_WALLET_MODULE
  ) as CashfreeWalletService
  const bank = await walletModule.retrieveBankAccount(id as string).catch(() => null)
  if (!bank || bank.customer_id !== customerId) {
    return res.status(404).json({ message: "Not found" })
  }

  const updated = await walletModule.updateBankAccounts({
    selector: { id: bank.id },
    data: {
      bank_proof_file_url,
      bank_proof_type,
    },
  })
  const row = Array.isArray(updated) ? updated[0] : updated
  res.json({
    bank_account: {
      id: row.id,
      bank_proof_file_url: row.bank_proof_file_url,
      bank_proof_type: row.bank_proof_type,
    },
  })
}
