import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { z } from "zod"
import {
  CASHFREE_WALLET_MODULE,
  CashfreeWalletService,
} from "../../../../modules/cashfree_wallet"
import { logger } from "../../../../utils/logger"

/**
 * PATCH /admin/bank-accounts/:id
 *
 * Edit non-financial fields on a bank account — account holder name,
 * bank name, proof file/type, verification_status (free-form for ops
 * override), is_primary. Amount-sensitive fields (account_number,
 * IFSC) require the customer to re-submit via `/store/bank-accounts`.
 */
const PatchSchema = z.object({
  account_holder_name: z.string().trim().min(1).max(200).optional(),
  bank_name: z.string().trim().min(1).max(200).optional(),
  bank_proof_file_url: z.string().trim().max(2000).nullable().optional(),
  bank_proof_type: z.enum(["cheque", "passbook", "statement"]).nullable().optional(),
  verification_status: z
    .enum(["pending", "verified", "failed", "name_mismatch"])
    .optional(),
  is_primary: z.boolean().optional(),
  reason: z.string().trim().min(4).max(500),
})

export const PATCH = async (req: MedusaRequest, res: MedusaResponse) => {
  const parsed = PatchSchema.safeParse(req.body)
  if (!parsed.success) {
    return res
      .status(400)
      .json({ message: "Invalid input", errors: parsed.error.flatten() })
  }
  const { reason, ...updates } = parsed.data
  const { id } = req.params
  const adminUserId =
    (req as any).auth_context?.actor_id ??
    (req as any).auth_context?.app_metadata?.user_id ??
    "unknown_admin"

  const walletModule = req.scope.resolve(
    CASHFREE_WALLET_MODULE
  ) as CashfreeWalletService

  const [before] = await walletModule.listBankAccounts({ id: id as string }, { take: 1 })
  if (!before) return res.status(404).json({ message: "Bank account not found" })

  const patch: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(updates)) {
    if (v !== undefined) patch[k] = v
  }

  const [after] = await walletModule.updateBankAccounts({
    selector: { id: id as string },
    data: patch,
  })

  await walletModule.logAdminAction({
    admin_user_id: adminUserId,
    customer_id: (before as any).customer_id ?? null,
    action: "bank_edit",
    target_id: id as string,
    before: before as unknown as Record<string, unknown>,
    after: after as unknown as Record<string, unknown>,
    note: reason,
  })

  // If verification_status flipped (verified ↔ anything else) the
  // customer's allowed-remitters list on Cashfree is now stale. PUT
  // the fresh list so the Cashfree dashboard tracks our DB. Also
  // re-syncs when admin edits IFSC or other identity-bearing fields
  // (rare — those usually require a re-add) but is cheap either way.
  // Best-effort.
  const beforeVerified =
    (before as any).verification_status === "verified"
  const afterVerified = (after as any).verification_status === "verified"
  if (beforeVerified !== afterVerified) {
    try {
      const customerModule: any = req.scope.resolve("customer")
      const cust = await customerModule
        .retrieveCustomer((after as any).customer_id)
        .catch(() => null)
      await walletModule.syncVbaAllowedRemitters({
        customer_id: (after as any).customer_id,
        customer_metadata: (cust?.metadata ?? null) as
          | Record<string, unknown>
          | null,
      })
    } catch (syncErr) {
      logger.warn("admin bank PATCH VBA sync failed (non-blocking)", {
        bank_account_id: id,
        error: (syncErr as Error).message,
      })
    }
  }

  return res.json({ ok: true, bank_account: after })
}

/**
 * DELETE /admin/bank-accounts/:id
 * Ops-side hard delete. Use with care — prefer setting
 * `verification_status: "failed"` via PATCH for reversible cases.
 *
 * Guardrail mirrors the storefront: refuse to delete a customer's
 * only verified bank because the PG-VBA TPV flow needs at least one
 * verified bank to credit deposits against. Admin can override with
 * `?force=true` for off-boarding / fraud-cleanup cases.
 */
export const DELETE = async (req: MedusaRequest, res: MedusaResponse) => {
  const { id } = req.params
  const force =
    String(req.query.force ?? "") === "1" ||
    String(req.query.force ?? "") === "true"
  const adminUserId =
    (req as any).auth_context?.actor_id ??
    (req as any).auth_context?.app_metadata?.user_id ??
    "unknown_admin"

  const walletModule = req.scope.resolve(
    CASHFREE_WALLET_MODULE
  ) as CashfreeWalletService

  const [before] = await walletModule.listBankAccounts({ id: id as string }, { take: 1 })
  if (!before) return res.status(404).json({ message: "Bank account not found" })

  if (!force && (before as any).verification_status === "verified") {
    const otherVerified = await walletModule.listBankAccounts({
      customer_id: (before as any).customer_id,
      verification_status: "verified",
    })
    const remainingAfter = otherVerified.filter((b) => b.id !== before.id)
    if (remainingAfter.length === 0) {
      return res.status(409).json({
        ok: false,
        code: "bank.last_verified",
        message:
          "This is the customer's only verified bank. Pass `?force=true` if you really need to delete it (off-boarding, fraud cleanup) — otherwise add another verified bank first so deposits can be credited.",
      })
    }
  }

  await walletModule.deleteBankAccounts(id as string)

  await walletModule.logAdminAction({
    admin_user_id: adminUserId,
    customer_id: (before as any).customer_id ?? null,
    action: "bank_delete",
    target_id: id as string,
    before: before as unknown as Record<string, unknown>,
    after: null,
  })

  // Push the now-shorter verified-bank list to Cashfree's
  // allowed_remitters. Only matters when the deleted row was verified
  // — others weren't in the lock list. Best-effort: log + swallow.
  if ((before as any).verification_status === "verified") {
    try {
      const customerModule: any = req.scope.resolve("customer")
      const cust = await customerModule
        .retrieveCustomer((before as any).customer_id)
        .catch(() => null)
      await walletModule.syncVbaAllowedRemitters({
        customer_id: (before as any).customer_id,
        customer_metadata: (cust?.metadata ?? null) as
          | Record<string, unknown>
          | null,
      })
    } catch (syncErr) {
      logger.warn("admin bank DELETE VBA sync failed (non-blocking)", {
        bank_account_id: id,
        error: (syncErr as Error).message,
      })
    }
  }

  return res.json({ ok: true })
}
