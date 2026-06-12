import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import {
  CASHFREE_WALLET_MODULE,
  CashfreeWalletService,
} from "../../../modules/cashfree_wallet"

/**
 * GET /admin/webhook-events?channel=&status=&limit=&offset=
 *
 * Inbound webhook audit log. Useful for debugging "the VBA credit didn't
 * land" issues (does the event exist? what's the processing status?).
 */
export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const channel = req.query.channel as string | undefined
  const status = req.query.status as string | undefined
  const limit = Math.min(
    Math.max(Number.parseInt(String(req.query.limit ?? "50"), 10) || 50, 1),
    200
  )
  const offset = Math.max(
    Number.parseInt(String(req.query.offset ?? "0"), 10) || 0,
    0
  )

  const filters: Record<string, unknown> = {}
  if (channel) filters.channel = channel
  if (status) filters.processing_status = status

  const walletModule = req.scope.resolve(
    CASHFREE_WALLET_MODULE
  ) as CashfreeWalletService
  const [rows, count] = await walletModule.listAndCountWebhookEvents(filters, {
    take: limit,
    skip: offset,
    order: { created_at: "DESC" } as any,
  })
  res.json({
    count,
    limit,
    offset,
    events: rows.map((r) => ({
      id: r.id,
      channel: r.channel,
      event_id: r.event_id,
      event_type: r.event_type,
      processing_status: r.processing_status,
      processing_error: r.processing_error,
      processed_at: r.processed_at,
      created_at: r.created_at,
    })),
  })
}
