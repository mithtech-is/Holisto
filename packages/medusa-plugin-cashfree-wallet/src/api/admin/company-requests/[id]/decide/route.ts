import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { z } from "zod"
import {
  CASHFREE_WALLET_MODULE,
  CashfreeWalletService,
} from "../../../../../modules/cashfree_wallet"
import { logger } from "../../../../../utils/logger"
import { sendEventEmail } from "../../../../../lib/send-event-email"

/**
 * POST /admin/company-requests/:id/decide
 *
 * Approve = the company has now been added to the marketplace as a Medusa
 * product (admin does that manually). Marks the request approved + fires
 * an in-app notification to the customer so they know it's available.
 *
 * Reject = mark with reason; customer sees rejection in their request list.
 */
const BodySchema = z.object({
  decision: z.enum(["approved", "rejected"]),
  notes: z.string().trim().max(1000).optional().nullable(),
})

export const POST = async (req: MedusaRequest, res: MedusaResponse) => {
  const parsed = BodySchema.safeParse(req.body)
  if (!parsed.success) {
    return res
      .status(400)
      .json({ message: "Invalid input", errors: parsed.error.flatten() })
  }
  const { id } = req.params
  if (!id) return res.status(400).json({ message: "Missing id" })

  const walletModule = req.scope.resolve(
    CASHFREE_WALLET_MODULE
  ) as CashfreeWalletService
  const row = await walletModule
    .retrieveCompanyRequest(id as string)
    .catch(() => null)
  if (!row) return res.status(404).json({ message: "Not found" })
  if (row.status !== "pending") {
    return res
      .status(400)
      .json({ message: `Already ${row.status}` })
  }
  const adminUserId =
    (req as any).auth_context?.actor_id ??
    (req as any).auth_context?.app_metadata?.user_id ??
    null
  const updated = await walletModule.updateCompanyRequests({
    selector: { id: row.id },
    data: {
      status: parsed.data.decision,
      reviewer_user_id: adminUserId,
      reviewer_notes: parsed.data.notes ?? null,
      reviewed_at: new Date(),
    },
  })

  // Notify the customer via the Event Bus (the email/notification event
  // is emitted by sendEventEmail below; installers subscribe to deliver it).
  await sendEventEmail(
    req.scope,
    parsed.data.decision === "approved"
      ? "company_request.approved"
      : "company_request.rejected",
    {
      customer_id: row.customer_id,
      company_name: row.company_name,
      isin: row.isin || "",
      notes: parsed.data.notes ?? "",
      product_url: `${process.env.STOREFRONT_URL || "https://polemarch.in"}/invest`,
    },
  )

  res.json({ request: Array.isArray(updated) ? updated[0] : updated })
}
