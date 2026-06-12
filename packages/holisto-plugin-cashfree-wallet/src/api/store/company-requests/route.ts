import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { z } from "zod"
import {
  CASHFREE_WALLET_MODULE,
  CashfreeWalletService,
} from "../../../modules/cashfree_wallet"
import { sendEventEmail } from "../../../lib/send-event-email"

const BodySchema = z.object({
  company_name: z.string().trim().min(1).max(200),
  isin: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z0-9]{12}$/, "ISIN must be 12 uppercase chars")
    .optional()
    .or(z.literal("")),
  customer_note: z.string().trim().max(1000).optional().nullable(),
})

/**
 * POST /store/company-requests
 *
 * Customer asks Polemarch to add a missing company to the marketplace.
 * Idempotent within a 5-minute window for the same customer + company name
 * to prevent accidental duplicate-clicks creating multiple rows.
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

  // Dedupe: same customer + same company name in last 5 minutes → return existing
  const fiveMinAgo = new Date(Date.now() - 5 * 60 * 1000)
  const recent = await walletModule.listCompanyRequests(
    {
      customer_id: customerId,
      company_name: parsed.data.company_name,
    },
    { take: 5, order: { created_at: "DESC" } as any }
  )
  const dupe = recent.find(
    (r) =>
      r.status === "pending" &&
      new Date(r.created_at as any).getTime() > fiveMinAgo.getTime()
  )
  if (dupe) {
    return res.json({ request: dupe, deduped: true })
  }
  const created = await walletModule.createCompanyRequests({
    customer_id: customerId,
    company_name: parsed.data.company_name,
    isin: parsed.data.isin || null,
    customer_note: parsed.data.customer_note ?? null,
    status: "pending",
  })

  // Heads-up for ops.
  await sendEventEmail(req.scope, "admin.new_company_request", {
    customer_id: customerId,
    company_name: parsed.data.company_name,
    isin: parsed.data.isin || "—",
    customer_note: parsed.data.customer_note ?? "",
    admin_review_url: `${process.env.MEDUSA_ADMIN_URL || ""}/app/company-requests`,
  })

  res.status(201).json({ request: created })
}

/**
 * GET /store/company-requests
 *
 * Customer's own request history.
 */
export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const customerId = (req as any).auth_context?.app_metadata?.customer_id as
    | string
    | undefined
  if (!customerId) return res.status(401).json({ message: "Not authenticated" })
  const walletModule = req.scope.resolve(
    CASHFREE_WALLET_MODULE
  ) as CashfreeWalletService
  const rows = await walletModule.listCompanyRequests(
    { customer_id: customerId },
    { take: 25, order: { created_at: "DESC" } as any }
  )
  res.json({ requests: rows })
}
