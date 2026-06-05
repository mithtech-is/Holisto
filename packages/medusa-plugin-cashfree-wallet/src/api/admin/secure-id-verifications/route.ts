import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import {
  CASHFREE_WALLET_MODULE,
  CashfreeWalletService,
} from "../../../modules/cashfree_wallet"

/**
 * GET /admin/secure-id-verifications?customer_id=&kind=&limit=&offset=
 *
 * Admin audit of Secure ID verification attempts. PII is stored masked
 * (input_masked) and Cashfree responses are redacted before persist — safe
 * to display.
 */
export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const customer_id = req.query.customer_id as string | undefined
  const kind = req.query.kind as string | undefined
  const limit = Math.min(
    Math.max(Number.parseInt(String(req.query.limit ?? "50"), 10) || 50, 1),
    200
  )
  const offset = Math.max(
    Number.parseInt(String(req.query.offset ?? "0"), 10) || 0,
    0
  )

  const filters: Record<string, unknown> = {}
  if (customer_id) filters.customer_id = customer_id
  if (kind) filters.kind = kind

  const walletModule = req.scope.resolve(
    CASHFREE_WALLET_MODULE
  ) as CashfreeWalletService
  const [rows, count] = await walletModule.listAndCountSecureIdVerifications(
    filters,
    { take: limit, skip: offset, order: { created_at: "DESC" } as any }
  )
  res.json({
    count,
    limit,
    offset,
    verifications: rows.map((r) => ({
      id: r.id,
      customer_id: r.customer_id,
      kind: r.kind,
      status: r.status,
      reference_id: r.reference_id,
      input_masked: r.input_masked,
      expires_at: r.expires_at,
      created_at: r.created_at,
      // intentionally omit response_raw from the default list — fetch one
      // by id if the admin needs to drill in (redacted, but still verbose)
    })),
  })
}
