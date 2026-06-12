import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import {
  CASHFREE_WALLET_MODULE,
  CashfreeWalletService,
} from "../../../modules/cashfree_wallet"

/** GET /admin/deposit-proofs?status=&limit=&offset= */
export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const status =
    (req.query.status as string | undefined) === undefined
      ? "pending"
      : (req.query.status as string)
  const limit = Math.min(
    Math.max(Number.parseInt(String(req.query.limit ?? "50"), 10) || 50, 1),
    200
  )
  const offset = Math.max(
    Number.parseInt(String(req.query.offset ?? "0"), 10) || 0,
    0
  )
  const walletModule = req.scope.resolve(
    CASHFREE_WALLET_MODULE
  ) as CashfreeWalletService
  const [rows, count] = await walletModule.listAndCountDepositProofs(
    status === "all" ? {} : { status: status as any },
    { take: limit, skip: offset, order: { created_at: "DESC" } as any }
  )
  res.json({
    count,
    limit,
    offset,
    proofs: rows.map((p) => ({
      id: p.id,
      customer_id: p.customer_id,
      status: p.status,
      claimed_amount_inr: p.claimed_amount_inr,
      credited_amount_inr: p.credited_amount_inr,
      utr: p.utr,
      customer_note: p.customer_note,
      proof_file_url: p.proof_file_url,
      reviewer_notes: p.reviewer_notes,
      created_at: p.created_at,
      reviewed_at: p.reviewed_at,
    })),
  })
}
