import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { z } from "zod"
import {
  CASHFREE_WALLET_MODULE,
  CashfreeWalletService,
} from "../../../../modules/cashfree_wallet"
import { logger } from "../../../../utils/logger"

/**
 * PATCH /store/bank-accounts/:id
 *
 * Customer-facing edit for non-financial fields:
 *
 *   - `bank_name` — a cosmetic label. Always editable: users often see
 *     the auto-detected bank-name come back wrong or missing from the
 *     penny-drop response and want to fix the label.
 *   - `account_holder_name` — editable only when the account is NOT
 *     yet verified (`pending` / `failed` / `name_mismatch`). Once
 *     penny-drop has succeeded, the holder name is locked to what the
 *     bank returned — letting a customer rename it would break the
 *     name-match audit trail. To correct a name on a verified account
 *     the customer must delete and re-add the account so a fresh
 *     penny-drop runs.
 *
 * Everything else (account number, IFSC, verification_status, is_primary,
 * proof file) has its own dedicated flow:
 *   - account_number/IFSC → delete + re-add (penny-drop must re-run)
 *   - is_primary / primary-swap → `/store/demat-accounts/:id/primary`
 *     (bank primary is auto-managed on first-verified + on delete)
 *   - bank_proof_file_url → `/store/bank-accounts/:id/proof`
 */
const PatchSchema = z
  .object({
    bank_name: z.string().trim().min(1).max(200).nullable().optional(),
    account_holder_name: z.string().trim().min(2).max(100).optional(),
  })
  .refine((v) => Object.keys(v).length > 0, {
    message: "No editable fields provided",
  })

export const PATCH = async (req: MedusaRequest, res: MedusaResponse) => {
  const customerId = (req as any).auth_context?.app_metadata?.customer_id as
    | string
    | undefined
  if (!customerId) return res.status(401).json({ message: "Not authenticated" })
  const { id } = req.params

  const parsed = PatchSchema.safeParse(req.body)
  if (!parsed.success) {
    return res
      .status(400)
      .json({ message: "Invalid input", errors: parsed.error.flatten() })
  }

  const walletModule = req.scope.resolve(
    CASHFREE_WALLET_MODULE
  ) as CashfreeWalletService
  const row = await walletModule
    .retrieveBankAccount(id as string)
    .catch(() => null)
  if (!row || row.customer_id !== customerId) {
    return res.status(404).json({ message: "Not found" })
  }

  const patch: Record<string, unknown> = {}
  if (parsed.data.bank_name !== undefined) patch.bank_name = parsed.data.bank_name
  if (parsed.data.account_holder_name !== undefined) {
    if (row.verification_status === "verified") {
      return res.status(409).json({
        message:
          "Account holder name is locked on verified accounts. Delete and re-add the account to change it (a fresh penny-drop will run).",
      })
    }
    patch.account_holder_name = parsed.data.account_holder_name
  }
  if (Object.keys(patch).length === 0) {
    return res.status(400).json({ message: "Nothing to update" })
  }

  const [updated] = await walletModule.updateBankAccounts({
    selector: { id: row.id },
    data: patch,
  })

  res.json({
    bank_account: {
      id: updated.id,
      account_holder_name: updated.account_holder_name,
      account_number_last4: updated.account_number_last4,
      ifsc: updated.ifsc,
      bank_name: updated.bank_name,
      verification_status: updated.verification_status,
      is_primary: updated.is_primary,
    },
  })
}

/**
 * DELETE /store/bank-accounts/:id
 *
 * Remove a bank account.
 *
 * Guardrail (added 2026-05-04): refuse the delete when the account is
 * the customer's *only* verified bank. The PG-VBA flow now does
 * remitter-validation (TPV) at webhook-receive time against the
 * customer's verified bank list — leaving them with zero verified
 * banks would silently TPV-fail every subsequent deposit and refund
 * it. Force the customer to add another bank first.
 *
 * Primary-rotation: if the deleted row was primary, the remaining
 * verified row (we know there's at least one because of the
 * guardrail) gets promoted.
 *
 * VBA sync: after a verified bank is removed we PUT the updated
 * `allowed_remitters` list to Cashfree (`syncVbaAllowedRemitters`)
 * so the Cashfree dashboard's lock list mirrors our DB. Best-effort
 * — a sync failure doesn't undo the delete (webhook TPV is the
 * authoritative gate at deposit time).
 */
export const DELETE = async (req: MedusaRequest, res: MedusaResponse) => {
  const customerId = (req as any).auth_context?.app_metadata?.customer_id as
    | string
    | undefined
  if (!customerId) return res.status(401).json({ message: "Not authenticated" })
  const { id } = req.params

  const walletModule = req.scope.resolve(
    CASHFREE_WALLET_MODULE
  ) as CashfreeWalletService
  const row = await walletModule
    .retrieveBankAccount(id as string)
    .catch(() => null)
  if (!row || row.customer_id !== customerId) {
    return res.status(404).json({ message: "Not found" })
  }

  // "At least one verified bank" guardrail. Only enforced when the
  // target row is verified — non-verified rows can always be removed
  // (they don't count toward TPV). Pending / failed banks dropping to
  // zero is fine; verified must stay ≥ 1.
  if (row.verification_status === "verified") {
    const otherVerified = await walletModule.listBankAccounts({
      customer_id: customerId,
      verification_status: "verified",
    })
    const remainingAfter = otherVerified.filter((b) => b.id !== row.id)
    if (remainingAfter.length === 0) {
      return res.status(409).json({
        ok: false,
        code: "bank.last_verified",
        message:
          "Add another verified bank before removing this one. Your wallet needs at least one verified bank for incoming deposits.",
      })
    }
  }

  await walletModule.deleteBankAccounts(row.id)

  // If we just deleted the primary, promote another verified account (if any).
  if (row.is_primary) {
    const remaining = await walletModule.listBankAccounts({
      customer_id: customerId,
      verification_status: "verified",
    })
    if (remaining.length > 0) {
      await walletModule.updateBankAccounts({
        selector: { id: remaining[0].id },
        data: { is_primary: true },
      })
    }
  }

  // Push the updated verified-bank list to Cashfree's VBA allowed-
  // remitters via PUT /pg/vba/{id}. Only matters when the deleted row
  // was a verified bank (others weren't in the lock list anyway), but
  // calling unconditionally is fine — `syncVbaAllowedRemitters` is a
  // noop when there's no active VBA, and the PUT is idempotent. Best-
  // effort: log + swallow on failure so the delete still succeeds.
  if (row.verification_status === "verified") {
    try {
      const customerModule: any = req.scope.resolve("customer")
      const cust = await customerModule
        .retrieveCustomer(customerId)
        .catch(() => null)
      await walletModule.syncVbaAllowedRemitters({
        customer_id: customerId,
        customer_metadata: (cust?.metadata ?? null) as
          | Record<string, unknown>
          | null,
      })
    } catch (syncErr) {
      logger.warn("VBA allowed-remitters sync after delete failed (non-blocking)", {
        customer_id: customerId,
        bank_account_id: row.id,
        error: (syncErr as Error).message,
      })
    }
  }

  res.json({ ok: true })
}
