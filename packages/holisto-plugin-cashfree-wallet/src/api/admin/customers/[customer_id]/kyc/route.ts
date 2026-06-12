import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { z } from "zod"
import { Modules } from "@medusajs/framework/utils"
import {
  CASHFREE_WALLET_MODULE,
  CashfreeWalletService,
} from "../../../../../modules/cashfree_wallet"
import { logger } from "../../../../../utils/logger"

/**
 * GET /admin/customers/:customer_id/kyc
 *
 * Returns the full KYC state: derived status + editable metadata
 * fields (PAN, Aadhaar, DP name, demat number, file URLs), plus the
 * manual-KYC request history.
 */
export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const { customer_id } = req.params
  const walletModule = req.scope.resolve(
    CASHFREE_WALLET_MODULE
  ) as CashfreeWalletService
  const customerModule = req.scope.resolve(Modules.CUSTOMER) as any

  const [customer, kycStatus, manualRequests] = await Promise.all([
    customerModule.retrieveCustomer(customer_id as string),
    walletModule.getKycStatus(customer_id as string).catch(() => null),
    walletModule
      .listManualKycRequests({ customer_id: customer_id as string }, {
        take: 20,
        order: { created_at: "DESC" },
      })
      .catch(() => []),
  ])

  return res.json({
    customer_id,
    metadata: customer?.metadata ?? {},
    kyc: kycStatus,
    manual_requests: manualRequests,
  })
}

/**
 * PATCH /admin/customers/:customer_id/kyc
 *
 * Full-edit KYC endpoint: overwrites PAN, Aadhaar, DP name, demat
 * number, CMR file URL, PAN file URL on customer metadata. Writes an
 * AdminAuditLog with before/after so the edit is auditable.
 */
const PatchBodySchema = z.object({
  kyc_pan_number: z.string().trim().min(1).max(50).optional(),
  kyc_aadhaar_number: z.string().trim().min(1).max(50).optional(),
  kyc_full_name: z.string().trim().min(1).max(200).optional(),
  kyc_dp_name: z.string().trim().min(1).max(100).optional(),
  kyc_demat_number: z.string().trim().min(1).max(50).optional(),
  kyc_pan_file_url: z.string().trim().max(2000).nullable().optional(),
  kyc_cmr_file_url: z.string().trim().max(2000).nullable().optional(),
  kyc_review_notes: z.string().trim().max(500).optional(),
  reason: z.string().trim().min(4).max(500),
})

export const PATCH = async (req: MedusaRequest, res: MedusaResponse) => {
  const parsed = PatchBodySchema.safeParse(req.body)
  if (!parsed.success) {
    return res
      .status(400)
      .json({ message: "Invalid input", errors: parsed.error.flatten() })
  }
  const { reason, ...updates } = parsed.data
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
    const before = await customerModule.retrieveCustomer(customer_id as string)
    const beforeMetadata = (before?.metadata as Record<string, unknown>) ?? {}

    const nextMetadata: Record<string, unknown> = { ...beforeMetadata }
    for (const [key, value] of Object.entries(updates)) {
      if (value === undefined) continue
      nextMetadata[key] = value
    }

    // Keep the admin's `kyc_`-prefixed keys in sync with the
    // storefront-read keys for the same concept. Without this, an
    // admin editing "Full name (as per PAN)" or uploading a PAN /
    // Aadhaar file via Customer-360 wouldn't propagate to the
    // customer's storefront pages (dashboard greeting, /dashboard/
    // documents, etc.) — historically those pages read `full_name`,
    // `pan_card_file_url`, `aadhaar_card_file_url` while the form
    // wrote the prefixed variants. We mirror at write time so neither
    // side has to know about the other's key shape.
    //
    // Mirror direction is admin → storefront only (the storefront
    // writes its own keys via /store/me/metadata or
    // /store/kyc/pan/verify directly). If the admin ever clears the
    // `kyc_*` value (sends `null`), we mirror the clear too.
    const ADMIN_TO_STOREFRONT_MIRROR: Record<string, string> = {
      kyc_full_name: "full_name",
      kyc_pan_file_url: "pan_card_file_url",
      // Aadhaar card file URL — admin form uses `kyc_aadhaar_card_file_url`
      // (note the `_card_` infix), storefront reads `aadhaar_card_file_url`.
      // Even though this PATCH schema doesn't currently expose
      // `kyc_aadhaar_card_file_url` (it's only written via the
      // attach-file route at admin/customers/[id]/attach-file), we
      // mirror anyway in case it lands here later.
      kyc_aadhaar_card_file_url: "aadhaar_card_file_url",
    }
    for (const [adminKey, storefrontKey] of Object.entries(
      ADMIN_TO_STOREFRONT_MIRROR,
    )) {
      if (adminKey in updates) {
        nextMetadata[storefrontKey] = (updates as Record<string, unknown>)[
          adminKey
        ]
      }
    }

    const after = await customerModule.updateCustomers(
      { id: customer_id as string },
      { metadata: nextMetadata }
    )

    await walletModule.logAdminAction({
      admin_user_id: adminUserId,
      customer_id: customer_id as string,
      action: "kyc_edit",
      before: beforeMetadata,
      after: nextMetadata,
      note: reason,
    })

    return res.json({ ok: true, customer: after })
  } catch (err) {
    logger.error("kyc edit failed", { customer_id, err })
    return res.status(500).json({ message: (err as Error).message })
  }
}
