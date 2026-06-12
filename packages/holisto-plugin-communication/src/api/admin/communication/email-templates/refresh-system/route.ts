// @ts-nocheck
import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { COMMUNICATION_MODULE, CommunicationModuleService } from "../../../../../modules/communication"

export const POST = async (req: MedusaRequest, res: MedusaResponse) => {
  const mod = req.scope.resolve(COMMUNICATION_MODULE) as CommunicationModuleService
  const result = await (mod as any).refreshSystemEmailTemplates()
  return res.json(result)
}
