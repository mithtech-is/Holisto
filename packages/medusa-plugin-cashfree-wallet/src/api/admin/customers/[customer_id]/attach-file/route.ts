import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { z } from "zod"
import { Modules } from "@medusajs/framework/utils"
import {
  CASHFREE_WALLET_MODULE,
  CashfreeWalletService,
} from "../../../../../modules/cashfree_wallet"

/**
 * POST /admin/customers/:customer_id/attach-file
 *
 * After uploading a file via `POST /admin/upload`, ops calls this to
 * point the resulting URL at a specific entity — a KYC metadata field,
 * a bank account's proof field, or a demat account's CMR field.
 *
 * Body:
 *   {
 *     url: "/static/...",
 *     target: {
 *       entity: "customer_metadata" | "bank_account" | "demat_account",
 *       id: "<entity_id>",      // customer_id for metadata, bank/demat id otherwise
 *       field: "kyc_pan_file_url" | "kyc_cmr_file_url" | "bank_proof_file_url" | "cmr_file_url"
 *     }
 *   }
 */
const BodySchema = z.object({
  url: z.string().trim().min(1).max(2000),
  target: z.object({
    entity: z.enum(["customer_metadata", "bank_account", "demat_account"]),
    id: z.string().trim().min(1),
    field: z.string().trim().min(1).max(100),
  }),
  reason: z.string().trim().min(4).max(500).optional(),
})

/**
 * Admin admin-form `kyc_*` keys → storefront-read counterparts. When
 * ops attaches a file to a `kyc_*_file_url` slot via Customer-360, the
 * storefront's /dashboard/documents page would otherwise not see it
 * (it reads the unprefixed legacy keys). Mirror at write time so both
 * surfaces stay coherent. Same pattern in
 * /admin/customers/:id/kyc PATCH.
 */
const ADMIN_TO_STOREFRONT_MIRROR: Record<string, string> = {
  kyc_pan_file_url: "pan_card_file_url",
  kyc_aadhaar_card_file_url: "aadhaar_card_file_url",
}

export const POST = async (req: MedusaRequest, res: MedusaResponse) => {
  const parsed = BodySchema.safeParse(req.body)
  if (!parsed.success) {
    return res
      .status(400)
      .json({ message: "Invalid input", errors: parsed.error.flatten() })
  }
  const { url, target, reason } = parsed.data
  const { customer_id } = req.params
  const adminUserId =
    (req as any).auth_context?.actor_id ??
    (req as any).auth_context?.app_metadata?.user_id ??
    "unknown_admin"

  const walletModule = req.scope.resolve(
    CASHFREE_WALLET_MODULE
  ) as CashfreeWalletService
  const customerModule = req.scope.resolve(Modules.CUSTOMER) as any

  try {
    if (target.entity === "customer_metadata") {
      const before = await customerModule.retrieveCustomer(customer_id as string)
      const meta: Record<string, unknown> = {
        ...(before?.metadata ?? {}),
        [target.field]: url,
      }
      // Mirror admin `kyc_*_file_url` → storefront `*_card_file_url`.
      const mirroredKey = ADMIN_TO_STOREFRONT_MIRROR[target.field]
      if (mirroredKey) meta[mirroredKey] = url
      await customerModule.updateCustomers(
        { id: customer_id as string },
        { metadata: meta }
      )
      await walletModule.logAdminAction({
        admin_user_id: adminUserId,
        customer_id: customer_id as string,
        action: "document_upload",
        target_id: target.field,
        before: { [target.field]: before?.metadata?.[target.field] ?? null },
        after: { [target.field]: url },
        note: reason ?? `Attached to ${target.field}`,
      })
    } else if (target.entity === "bank_account") {
      const [before] = await walletModule.listBankAccounts({ id: target.id }, { take: 1 })
      if (!before) return res.status(404).json({ message: "Bank account not found" })
      await walletModule.updateBankAccounts({
        selector: { id: target.id },
        data: { [target.field]: url },
      })
      await walletModule.logAdminAction({
        admin_user_id: adminUserId,
        customer_id: customer_id as string,
        action: "document_upload",
        target_id: target.id,
        before: { [target.field]: (before as any)[target.field] ?? null },
        after: { [target.field]: url },
        note: reason ?? `Attached to bank_account.${target.field}`,
      })
    } else if (target.entity === "demat_account") {
      const [before] = await walletModule.listDematAccounts({ id: target.id }, { take: 1 })
      if (!before) return res.status(404).json({ message: "Demat account not found" })
      await walletModule.updateDematAccounts({
        selector: { id: target.id },
        data: { [target.field]: url },
      })
      await walletModule.logAdminAction({
        admin_user_id: adminUserId,
        customer_id: customer_id as string,
        action: "document_upload",
        target_id: target.id,
        before: { [target.field]: (before as any)[target.field] ?? null },
        after: { [target.field]: url },
        note: reason ?? `Attached to demat_account.${target.field}`,
      })
    }

    return res.json({ ok: true, url })
  } catch (err) {
    return res.status(500).json({ message: (err as Error).message })
  }
}

/**
 * DELETE /admin/customers/:customer_id/attach-file?entity=...&id=...&field=...
 *
 * Clears a file reference without deleting the file on disk (use
 * `DELETE /admin/upload?url=` for that).
 */
export const DELETE = async (req: MedusaRequest, res: MedusaResponse) => {
  const entity = req.query?.entity as string
  const id = req.query?.id as string
  const field = req.query?.field as string
  const { customer_id } = req.params

  if (!entity || !field) {
    return res.status(400).json({ message: "Missing entity or field" })
  }

  const adminUserId =
    (req as any).auth_context?.actor_id ??
    (req as any).auth_context?.app_metadata?.user_id ??
    "unknown_admin"

  const walletModule = req.scope.resolve(
    CASHFREE_WALLET_MODULE
  ) as CashfreeWalletService
  const customerModule = req.scope.resolve(Modules.CUSTOMER) as any

  try {
    if (entity === "customer_metadata") {
      const before = await customerModule.retrieveCustomer(customer_id as string)
      const meta: Record<string, unknown> = { ...(before?.metadata ?? {}) }
      const old = meta[field]
      meta[field] = null
      // Mirror clear → storefront key.
      const mirroredKey = ADMIN_TO_STOREFRONT_MIRROR[field]
      if (mirroredKey) meta[mirroredKey] = null
      await customerModule.updateCustomers(
        { id: customer_id as string },
        { metadata: meta }
      )
      await walletModule.logAdminAction({
        admin_user_id: adminUserId,
        customer_id: customer_id as string,
        action: "document_delete",
        target_id: field,
        before: { [field]: old ?? null },
        after: { [field]: null },
      })
    } else if (entity === "bank_account") {
      const [before] = await walletModule.listBankAccounts({ id }, { take: 1 })
      if (!before) return res.status(404).json({ message: "Bank account not found" })
      await walletModule.updateBankAccounts({
        selector: { id },
        data: { [field]: null },
      })
      await walletModule.logAdminAction({
        admin_user_id: adminUserId,
        customer_id: customer_id as string,
        action: "document_delete",
        target_id: id,
        before: { [field]: (before as any)[field] ?? null },
        after: { [field]: null },
      })
    } else if (entity === "demat_account") {
      const [before] = await walletModule.listDematAccounts({ id }, { take: 1 })
      if (!before) return res.status(404).json({ message: "Demat account not found" })
      await walletModule.updateDematAccounts({
        selector: { id },
        data: { [field]: null },
      })
      await walletModule.logAdminAction({
        admin_user_id: adminUserId,
        customer_id: customer_id as string,
        action: "document_delete",
        target_id: id,
        before: { [field]: (before as any)[field] ?? null },
        after: { [field]: null },
      })
    } else {
      return res.status(400).json({ message: "Unknown entity" })
    }

    return res.json({ ok: true })
  } catch (err) {
    return res.status(500).json({ message: (err as Error).message })
  }
}
