import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { z } from "zod"
import {
  CASHFREE_WALLET_MODULE,
  CashfreeWalletService,
} from "../../../modules/cashfree_wallet"

/**
 * GET /admin/demat-accounts
 *
 * Lists demat accounts. Filters by `?customer_id=` when provided,
 * otherwise returns the most recent 100 across all customers.
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
    .listDematAccounts(selector, {
      take: limit,
      order: { created_at: "DESC" },
    })
    .catch(() => [])

  return res.json({ demat_accounts: rows, count: rows.length })
}

/**
 * POST /admin/demat-accounts
 *
 * Admin-side manual creation — mirrors `POST /admin/bank-accounts`:
 * no CMR verification call to Cashfree, the admin picks the
 * `verification_status`. Useful when ops is unblocking a customer who
 * can't get CMR verification to pass, or when migrating legacy records.
 *
 * `cmr_file_url` is optional at create time (the model column is
 * non-null so we persist an empty string when not provided). Ops can
 * attach the real CMR afterwards via the Documents tab, which updates
 * this column through the attach-file flow.
 *
 * The depository/BOID/DP-ID guard mirrors the store schema: CDSL
 * records need a 16-digit BOID; NSDL records need DP ID + Client ID.
 */
const CreateSchema = z
  .object({
    customer_id: z.string().trim().min(1),
    depository: z.enum(["NSDL", "CDSL"]),
    dp_name: z.string().trim().min(2).max(100),
    dp_id: z.string().trim().regex(/^IN\d{6}$/).optional(),
    client_id: z.string().trim().regex(/^\d{8}$/).optional(),
    boid: z.string().trim().regex(/^\d{16}$/).optional(),
    account_holder_name: z.string().trim().min(2).max(100),
    cmr_file_url: z.string().trim().max(2000).optional(),
    verification_status: z
      .enum(["pending", "verified", "failed", "name_mismatch"])
      .default("pending"),
    is_primary: z.boolean().optional(),
    reason: z.string().trim().min(4).max(500),
  })
  .superRefine((v, ctx) => {
    if (v.depository === "NSDL") {
      if (!v.dp_id || !v.client_id) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message:
            "NSDL accounts require dp_id (IN + 6 digits) and client_id (8 digits)",
          path: ["dp_id"],
        })
      }
    } else if (v.depository === "CDSL") {
      if (!v.boid) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "CDSL accounts require a 16-digit BO ID",
          path: ["boid"],
        })
      }
    }
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
    depository,
    dp_name,
    dp_id,
    client_id,
    boid,
    account_holder_name,
    cmr_file_url,
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

  // Duplicate guard — same depository-scoped identifiers should not
  // repeat for the same customer.
  const dedupe = await walletModule.listDematAccounts({
    customer_id,
    ...(boid ? { boid } : { dp_id, client_id }),
  })
  if (dedupe.length > 0) {
    return res.status(409).json({
      message: "This customer already has a demat account with these identifiers.",
    })
  }

  const wantsPrimary = !!is_primary
  if (wantsPrimary) {
    const existingPrimary = await walletModule.listDematAccounts({
      customer_id,
      is_primary: true,
    })
    for (const p of existingPrimary) {
      await walletModule.updateDematAccounts({
        selector: { id: p.id },
        data: { is_primary: false },
      })
    }
  }

  const row = await walletModule.createDematAccounts({
    customer_id,
    depository,
    dp_id: dp_id ?? null,
    client_id: client_id ?? null,
    boid: boid ?? null,
    dp_name,
    account_holder_name,
    // Column is non-null; empty string is our "not yet uploaded"
    // sentinel and the Documents tab overwrites it when ops attaches
    // the real CMR.
    cmr_file_url: cmr_file_url ?? "",
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
    action: "demat_create",
    target_id: row.id,
    before: null,
    after: row as unknown as Record<string, unknown>,
    note: reason,
  })

  return res.status(201).json({ ok: true, demat_account: row })
}
