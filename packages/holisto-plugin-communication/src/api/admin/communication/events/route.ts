// @ts-nocheck
import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { z } from "zod"
import { COMMUNICATION_MODULE, CommunicationModuleService } from "../../../../modules/communication"

const UpsertSchema = z.object({
  event_name: z.string().min(1),
  channel: z.enum(["email", "sms", "whatsapp"]),
  template_slug: z.string().min(1),
  recipient_resolver: z.string().optional(),
  static_recipient: z.string().nullable().optional(),
  enabled: z.boolean().optional(),
  delay_seconds: z.number().optional(),
  conditions: z.any().optional(),
  retry_policy: z.any().optional(),
})

export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const mod = req.scope.resolve(COMMUNICATION_MODULE) as CommunicationModuleService
  const channel = (req.query as any)?.channel
  const rows = await mod.listEventRulesView(channel)
  return res.json({ rules: rows, count: rows.length })
}

export const PUT = async (req: MedusaRequest, res: MedusaResponse) => {
  const parsed = UpsertSchema.safeParse(req.body ?? {})
  if (!parsed.success) return res.status(400).json({ message: "Invalid payload", errors: parsed.error.flatten() })
  const mod = req.scope.resolve(COMMUNICATION_MODULE) as CommunicationModuleService
  const row = await (mod as any).upsertEventRule(parsed.data)
  return res.json(row)
}
