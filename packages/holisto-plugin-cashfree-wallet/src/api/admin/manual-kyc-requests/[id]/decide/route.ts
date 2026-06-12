import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { z } from "zod"
import {
  CASHFREE_WALLET_MODULE,
  CashfreeWalletService,
} from "../../../../../modules/cashfree_wallet"
import { sendEventEmail } from "../../../../../lib/send-event-email"

/**
 * POST /admin/manual-kyc-requests/:id/decide
 *
 * Close a manual KYC request. This does NOT flip individual KYC flags —
 * that's done through the Customer wallet tab's manual-verify buttons.
 * This route just records the decision on the request row so the queue
 * clears. Typical flow: admin opens the Customer wallet tab for the
 * customer, uses the PAN / Aadhaar / bank / demat verify buttons there,
 * then comes back here and marks the request approved/rejected.
 */
const BodySchema = z.object({
  decision: z.enum(["approved", "rejected", "cancelled"]),
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
    .retrieveManualKycRequest(id as string)
    .catch(() => null)
  if (!row) return res.status(404).json({ message: "Not found" })
  if (row.status !== "pending") {
    return res
      .status(400)
      .json({ message: `Cannot decide a request already in status ${row.status}` })
  }
  const adminUserId =
    (req as any).auth_context?.actor_id ??
    (req as any).auth_context?.app_metadata?.user_id ??
    null
  const updated = await walletModule.updateManualKycRequests({
    selector: { id: row.id },
    data: {
      status: parsed.data.decision,
      reviewer_user_id: adminUserId,
      reviewer_notes: parsed.data.notes ?? null,
      reviewed_at: new Date(),
    },
  })
  const r = Array.isArray(updated) ? updated[0] : updated

  if (parsed.data.decision === "approved" || parsed.data.decision === "rejected") {
    await sendEventEmail(
      req.scope,
      parsed.data.decision === "approved"
        ? "kyc.manual_approved"
        : "kyc.manual_rejected",
      {
        customer_id: row.customer_id,
        reason: parsed.data.notes ?? "",
      },
    )
  }

  res.json({ request: r })
}
