// @ts-nocheck
import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { z } from "zod"
import { COMMUNICATION_MODULE, CommunicationModuleService } from "../../../../modules/communication"

const BodySchema = z.object({
  phone: z.string().min(8).max(20),
  purpose: z.enum(["login", "verify"]).optional(),
  channel: z.enum(["sms", "whatsapp"]).optional(),
})

export const POST = async (req: MedusaRequest, res: MedusaResponse) => {
  const parsed = BodySchema.safeParse(req.body ?? {})
  if (!parsed.success) return res.status(400).json({ message: "Invalid payload", errors: parsed.error.flatten() })
  const mod = req.scope.resolve(COMMUNICATION_MODULE) as CommunicationModuleService
  const result = await mod.sendOtp(parsed.data)
  return res.status(result.ok ? 200 : 502).json(result)
}
