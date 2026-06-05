import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { z } from "zod"
import {
  CASHFREE_WALLET_MODULE,
  CashfreeWalletService,
} from "../../../../modules/cashfree_wallet"
import { sendEventEmail } from "../../../../lib/send-event-email"

const paiseToInrStr = (paise: number): string =>
  Math.round(paise / 100).toLocaleString("en-IN")

const BodySchema = z.object({
  claimed_amount_inr: z.number().int().positive(),
  proof_file_url: z
    .string()
    .trim()
    .refine(
      (s) => s.startsWith("/static/") || /^https?:\/\//i.test(s),
      "Invalid file URL"
    ),
  utr: z
    .string()
    .trim()
    .min(3)
    .max(64)
    .optional()
    .or(z.literal(""))
    .nullable(),
  customer_note: z.string().trim().max(1000).optional().nullable(),
})

/**
 * POST /store/wallet/deposit-proof
 *
 * Customer submits proof of an offline bank transfer to Polemarch's
 * operational account. Admin reviews in the "Deposit proofs" tab and
 * credits the wallet on approval.
 *
 * The proof image/PDF must be uploaded via `/store/upload` first — this
 * route takes only the URL.
 */
export const POST = async (req: MedusaRequest, res: MedusaResponse) => {
  const customerId = (req as any).auth_context?.app_metadata?.customer_id as
    | string
    | undefined
  if (!customerId) return res.status(401).json({ message: "Not authenticated" })

  const parsed = BodySchema.safeParse(req.body)
  if (!parsed.success) {
    return res
      .status(400)
      .json({ message: "Invalid input", errors: parsed.error.flatten() })
  }
  const walletModule = req.scope.resolve(
    CASHFREE_WALLET_MODULE
  ) as CashfreeWalletService

  const created = await walletModule.createDepositProofs({
    customer_id: customerId,
    claimed_amount_inr: parsed.data.claimed_amount_inr,
    credited_amount_inr: null,
    utr: parsed.data.utr || null,
    customer_note: parsed.data.customer_note ?? null,
    proof_file_url: parsed.data.proof_file_url,
    status: "pending",
  })
  // Heads-up for ops.
  await sendEventEmail(req.scope, "admin.new_deposit_proof", {
    customer_id: customerId,
    claimed_amount_inr: paiseToInrStr(parsed.data.claimed_amount_inr),
    utr: parsed.data.utr || "—",
    proof_file_url: parsed.data.proof_file_url,
    admin_review_url: `${process.env.MEDUSA_ADMIN_URL || ""}/app/deposit-proofs`,
  })

  res.status(201).json({
    proof: {
      id: created.id,
      status: created.status,
      claimed_amount_inr: created.claimed_amount_inr,
      created_at: created.created_at,
    },
  })
}

/**
 * GET /store/wallet/deposit-proof
 *
 * Customer's own deposit-proof history.
 */
export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const customerId = (req as any).auth_context?.app_metadata?.customer_id as
    | string
    | undefined
  if (!customerId) return res.status(401).json({ message: "Not authenticated" })
  const walletModule = req.scope.resolve(
    CASHFREE_WALLET_MODULE
  ) as CashfreeWalletService
  const rows = await walletModule.listDepositProofs(
    { customer_id: customerId },
    { take: 50, order: { created_at: "DESC" } as any }
  )
  res.json({
    proofs: rows.map((p) => ({
      id: p.id,
      status: p.status,
      claimed_amount_inr: p.claimed_amount_inr,
      credited_amount_inr: p.credited_amount_inr,
      utr: p.utr,
      customer_note: p.customer_note,
      reviewer_notes: p.reviewer_notes,
      proof_file_url: p.proof_file_url,
      created_at: p.created_at,
      reviewed_at: p.reviewed_at,
    })),
  })
}
