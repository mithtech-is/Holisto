// @ts-nocheck
import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { COMMUNICATION_MODULE, CommunicationModuleService } from "../../../../modules/communication"

export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const mod = req.scope.resolve(COMMUNICATION_MODULE) as CommunicationModuleService
  const rows = await (mod as any).listCommunicationWebhookEvents({}, { take: 100, order: { created_at: "DESC" } })
  return res.json({ webhooks: rows, count: rows.length })
}

export const POST = async (req: MedusaRequest, res: MedusaResponse) => {
  const mod = req.scope.resolve(COMMUNICATION_MODULE) as CommunicationModuleService
  const row = await mod.recordWebhook(req.body as Record<string, unknown>)
  return res.json(row)
}
