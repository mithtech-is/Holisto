import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { z } from "zod"
import {
  CASHFREE_WALLET_MODULE,
  CashfreeWalletService,
} from "../../../../modules/cashfree_wallet"

/**
 * PATCH /store/demat-accounts/:id
 *
 * Customer-facing edit — same philosophy as `/store/bank-accounts/:id`:
 *
 *   - `dp_name` — cosmetic label, always editable.
 *   - `account_holder_name` — only when the account is NOT yet
 *     verified. Once CMR verification has succeeded, the holder name is
 *     locked; to change it the customer must delete and re-add (fresh
 *     CMR verification will run).
 *
 * Material identifiers (depository, dp_id, client_id, boid, cmr_file_url)
 * are NOT editable here — they bind the record to a specific demat
 * account at a specific depository. Changing them effectively creates a
 * different account, so we route that through delete + re-add (or the
 * dedicated `/cmr` / `/primary` sub-routes for file swap / primary).
 */
const PatchSchema = z
  .object({
    dp_name: z.string().trim().min(1).max(200).optional(),
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
    .retrieveDematAccount(id as string)
    .catch(() => null)
  if (!row || row.customer_id !== customerId) {
    return res.status(404).json({ message: "Not found" })
  }

  const patch: Record<string, unknown> = {}
  if (parsed.data.dp_name !== undefined) patch.dp_name = parsed.data.dp_name
  if (parsed.data.account_holder_name !== undefined) {
    if (row.verification_status === "verified") {
      return res.status(409).json({
        message:
          "Account holder name is locked on verified demat accounts. Delete and re-add the account to change it (a fresh CMR check will run).",
      })
    }
    patch.account_holder_name = parsed.data.account_holder_name
  }
  if (Object.keys(patch).length === 0) {
    return res.status(400).json({ message: "Nothing to update" })
  }

  const [updated] = await walletModule.updateDematAccounts({
    selector: { id: row.id },
    data: patch,
  })

  res.json({
    demat_account: {
      id: updated.id,
      depository: updated.depository,
      dp_id: updated.dp_id,
      client_id: updated.client_id,
      boid: updated.boid,
      dp_name: updated.dp_name,
      account_holder_name: updated.account_holder_name,
      verification_status: updated.verification_status,
      is_primary: updated.is_primary,
    },
  })
}

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
    .retrieveDematAccount(id as string)
    .catch(() => null)
  if (!row || row.customer_id !== customerId) {
    return res.status(404).json({ message: "Not found" })
  }

  const siblings = await walletModule.listDematAccounts({
    customer_id: customerId,
    verification_status: "verified",
  })

  if (row.is_primary && siblings.length > 1) {
    return res.status(400).json({
      message:
        "Set another demat as primary before deleting this one, or delete others first.",
    })
  }

  await walletModule.deleteDematAccounts(row.id)
  res.json({ ok: true })
}
