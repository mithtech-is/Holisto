// @ts-nocheck
import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { COMMUNICATION_MODULE, CommunicationModuleService } from "../../../../modules/communication"

export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const mod = req.scope.resolve(COMMUNICATION_MODULE) as CommunicationModuleService
  const q = req.query as Record<string, string | undefined>
  const limit = Math.max(1, Math.min(500, Number(q.limit || 50)))
  const rows = await (mod as any).listCommunicationAuditLogs({}, { take: limit, order: { created_at: "DESC" } })
  return res.json({ logs: rows, count: rows.length })
}
