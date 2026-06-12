import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import {
  CASHFREE_WALLET_MODULE,
  CashfreeWalletService,
} from "../../../../modules/cashfree_wallet"

/**
 * GET /store/wallet/transactions?limit=&offset=
 *
 * Paginated wallet ledger for the authenticated customer. Returns rows
 * sorted newest-first.
 */
export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const customerId = (req as any).auth_context?.app_metadata?.customer_id as
    | string
    | undefined
  if (!customerId) return res.status(401).json({ message: "Not authenticated" })

  const limit = Math.min(
    Math.max(Number.parseInt(String(req.query.limit ?? "20"), 10) || 20, 1),
    100
  )
  const offset = Math.max(
    Number.parseInt(String(req.query.offset ?? "0"), 10) || 0,
    0
  )

  const walletModule = req.scope.resolve(
    CASHFREE_WALLET_MODULE
  ) as CashfreeWalletService

  const [rows, count] = await walletModule.listAndCountWalletTransactions(
    { customer_id: customerId },
    {
      take: limit,
      skip: offset,
      order: { created_at: "DESC" } as any,
    }
  )

  res.json({
    count,
    limit,
    offset,
    transactions: rows.map((t) => ({
      id: t.id,
      direction: t.direction,
      amount_inr: t.amount_inr,
      balance_after: t.balance_after,
      kind: t.kind,
      // Bucket = which sub-balance this row mutated ("main" | "promo").
      // The storefront uses it to label promo rows AND to pair the two
      // ledger writes produced by a split debit into one activity row.
      bucket: t.bucket,
      reference_type: t.reference_type,
      reference_id: t.reference_id,
      note: t.note,
      created_at: t.created_at,
    })),
  })
}
