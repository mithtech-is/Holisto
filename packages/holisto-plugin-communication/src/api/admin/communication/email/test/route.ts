// @ts-nocheck
import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { z } from "zod"
import { COMMUNICATION_MODULE, CommunicationModuleService } from "../../../../../modules/communication"

const BodySchema = z.object({
  to: z.string().email(),
  provider: z.string().optional(),
})

export const POST = async (req: MedusaRequest, res: MedusaResponse) => {
  const parsed = BodySchema.safeParse(req.body ?? {})
  if (!parsed.success) return res.status(400).json({ ok: false, message: "Invalid payload" })
  const mod = req.scope.resolve(COMMUNICATION_MODULE) as CommunicationModuleService
  const result = await mod.sendEmail({
    to: parsed.data.to,
    provider: parsed.data.provider || "smtp",
    subject: "Communication Hub test email",
    text: "If you received this, the email provider is configured.",
  })
  await mod.recordEmailTestResult(parsed.data.provider || "smtp", result.ok, result.ok ? null : (result as any).reason)
  return res.status(result.ok ? 200 : 502).json(result)
}
