// @ts-nocheck
import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { COMMUNICATION_MODULE, CommunicationModuleService } from "../../../../../../modules/communication"

export const POST = async (req: MedusaRequest, res: MedusaResponse) => {
  const mod = req.scope.resolve(COMMUNICATION_MODULE) as CommunicationModuleService
  const row = await mod.replayWebhook(req.params.id as string)
  return res.json(row)
}
