import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { z } from "zod"
import {
  CASHFREE_WALLET_MODULE,
  CashfreeWalletService,
} from "../../../modules/cashfree_wallet"
import {
  encryptString,
  last4,
} from "../../../modules/cashfree_wallet/cashfree/crypto"

/**
 * GET /admin/bank-accounts
 *
 * Lists bank accounts. Filters by `?customer_id=` when provided,
 * otherwise returns the most recent 100 across all customers (for
 * admin triage views). Ordered by created_at DESC.
 */
export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const customerId = (req.query?.customer_id as string) || undefined
  const limit = Math.min(Number(req.query?.limit ?? 100), 500)

  const walletModule = req.scope.resolve(
    CASHFREE_WALLET_MODULE
  ) as CashfreeWalletService

  const selector: Record<string, unknown> = {}
  if (customerId) selector.customer_id = customerId

  const rows = await walletModule
    .listBankAccounts(selector, {
      take: limit,
      order: { created_at: "DESC" },
    })
    .catch(() => [])

  return res.json({ bank_accounts: rows, count: rows.length })
}

/**
 * POST /admin/bank-accounts
 *
 * Admin-side manual creation. Intended for ops flows where a customer
 * can't self-serve — e.g. they called in with their account details,
 * they have a failing penny-drop loop, or we're migrating legacy data.
 *
 * Unlike the store-side create, this route does NOT run penny-drop:
 * the admin picks the `verification_status` themselves. Supply the
 * full account number; we still encrypt it at rest and expose only
 * `account_number_last4`.
 *
 * If the same (customer, last4, ifsc) combo already exists, we 409 —
 * ops should Edit the existing row instead of creating a duplicate.
 */
const CreateSchema = z.object({
  customer_id: z.string().trim().min(1),
  account_number: z
    .string()
    .trim()
    .transform((s) => s.replace(/\s+/g, ""))
    .refine((s) => /^\d{6,20}$/.test(s), "account number must be 6-20 digits"),
  ifsc: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z]{4}0[A-Z0-9]{6}$/, "invalid IFSC"),
  account_holder_name: z.string().trim().min(2).max(100),
  bank_name: z.string().trim().min(1).max(200).nullable().optional(),
  verification_status: z
    .enum(["pending", "verified", "failed", "name_mismatch"])
    .default("pending"),
  is_primary: z.boolean().optional(),
  reason: z.string().trim().min(4).max(500),
})

export const POST = async (req: MedusaRequest, res: MedusaResponse) => {
  const parsed = CreateSchema.safeParse(req.body)
  if (!parsed.success) {
    return res
      .status(400)
      .json({ message: "Invalid input", errors: parsed.error.flatten() })
  }
  const {
    customer_id,
    account_number,
    ifsc,
    account_holder_name,
    bank_name,
    verification_status,
    is_primary,
    reason,
  } = parsed.data

  const adminUserId =
    (req as any).auth_context?.actor_id ??
    (req as any).auth_context?.app_metadata?.user_id ??
    "unknown_admin"

  const walletModule = req.scope.resolve(
    CASHFREE_WALLET_MODULE
  ) as CashfreeWalletService

  // Duplicate guard — same (customer, last4, ifsc) would surface as a
  // second copy of the same bank which is almost always a mistake.
  const dupes = await walletModule.listBankAccounts({
    customer_id,
    account_number_last4: last4(account_number),
    ifsc,
  })
  if (dupes.length > 0) {
    return res.status(409).json({
      message: "This customer already has a bank account with this last-4 and IFSC.",
    })
  }

  // is_primary=true must be unique — if the admin requested primary
  // but another primary exists, demote the other one first so the
  // partial-unique index is satisfied.
  const wantsPrimary = !!is_primary
  if (wantsPrimary) {
    const existingPrimary = await walletModule.listBankAccounts({
      customer_id,
      is_primary: true,
    })
    for (const p of existingPrimary) {
      await walletModule.updateBankAccounts({
        selector: { id: p.id },
        data: { is_primary: false },
      })
    }
  }

  const row = await walletModule.createBankAccounts({
    customer_id,
    account_holder_name,
    account_number_encrypted: encryptString(account_number),
    account_number_last4: last4(account_number),
    ifsc,
    bank_name: bank_name ?? null,
    name_match_score: null,
    verification_status,
    cashfree_reference_id: null,
    verification_raw: null,
    verified_at: verification_status === "verified" ? new Date() : null,
    is_primary: wantsPrimary,
  })

  await walletModule.logAdminAction({
    admin_user_id: adminUserId,
    customer_id,
    action: "bank_create",
    target_id: row.id,
    before: null,
    after: row as unknown as Record<string, unknown>,
    note: reason,
  })

  return res.status(201).json({ ok: true, bank_account: row })
}
