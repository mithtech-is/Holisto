import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { z } from "zod"
import {
  CASHFREE_WALLET_MODULE,
  CashfreeWalletService,
} from "../../../../modules/cashfree_wallet"

/**
 * PATCH /admin/demat-accounts/:id
 *
 * Edit demat account fields — DP name, DP ID, client ID, BOID,
 * account holder name, CMR file URL, is_primary, verification_status.
 */
const PatchSchema = z.object({
  depository: z.enum(["NSDL", "CDSL"]).optional(),
  dp_name: z.string().trim().min(1).max(200).optional(),
  dp_id: z.string().trim().min(1).max(20).nullable().optional(),
  client_id: z.string().trim().min(1).max(20).nullable().optional(),
  boid: z.string().trim().min(1).max(20).nullable().optional(),
  account_holder_name: z.string().trim().min(1).max(200).optional(),
  cmr_file_url: z.string().trim().max(2000).nullable().optional(),
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

  const [before] = await walletModule.listDematAccounts({ id: id as string }, { take: 1 })
  if (!before) return res.status(404).json({ message: "Demat account not found" })

  const patch: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(updates)) {
    if (v !== undefined) patch[k] = v
  }

  const [after] = await walletModule.updateDematAccounts({
    selector: { id: id as string },
    data: patch,
  })

  await walletModule.logAdminAction({
    admin_user_id: adminUserId,
    customer_id: (before as any).customer_id ?? null,
    action: "demat_edit",
    target_id: id as string,
    before: before as unknown as Record<string, unknown>,
    after: after as unknown as Record<string, unknown>,
    note: reason,
  })

  return res.json({ ok: true, demat_account: after })
}

export const DELETE = async (req: MedusaRequest, res: MedusaResponse) => {
  const { id } = req.params
  const adminUserId =
    (req as any).auth_context?.actor_id ??
    (req as any).auth_context?.app_metadata?.user_id ??
    "unknown_admin"

  const walletModule = req.scope.resolve(
    CASHFREE_WALLET_MODULE
  ) as CashfreeWalletService

  const [before] = await walletModule.listDematAccounts({ id: id as string }, { take: 1 })
  if (!before) return res.status(404).json({ message: "Demat account not found" })

  await walletModule.deleteDematAccounts(id as string)

  await walletModule.logAdminAction({
    admin_user_id: adminUserId,
    customer_id: (before as any).customer_id ?? null,
    action: "demat_delete",
    target_id: id as string,
    before: before as unknown as Record<string, unknown>,
    after: null,
  })

  return res.json({ ok: true })
}
