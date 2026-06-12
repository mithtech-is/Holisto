// @ts-nocheck
import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { COMMUNICATION_MODULE, CommunicationModuleService } from "../../../../modules/communication"

export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const mod = req.scope.resolve(COMMUNICATION_MODULE) as CommunicationModuleService
  const q = req.query as Record<string, string | undefined>
  const limit = Math.max(1, Math.min(500, Number.parseInt(q.limit || "50", 10) || 50))
  const filters: any = { channel: "email" }
  if (q.status) filters.status = q.status
  const [logs, count] = await (mod as any).listAndCountCommunicationMessageLogs(filters, {
    take: limit,
    order: { created_at: "DESC" },
  })
  return res.json({ logs, count, limit })
}
