// @ts-nocheck
import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { z } from "zod"
import { COMMUNICATION_MODULE, CommunicationModuleService } from "../../../../modules/communication"

const UpsertSchema = z.object({
  slug: z.string().min(1).optional(),
  name: z.string().optional(),
  label: z.string().optional(),
  subject: z.string().optional(),
  body: z.string().nullable().optional(),
  html: z.string().nullable().optional(),
  category: z.string().optional(),
  language: z.string().optional(),
  enabled: z.boolean().optional(),
})

export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const mod = req.scope.resolve(COMMUNICATION_MODULE) as CommunicationModuleService
  const q = req.query as Record<string, string | undefined>
  const filters: any = { channel: "email" }
  if (q.search) filters.label = { $like: `%${q.search}%` }
  if (q.status) filters.enabled = q.status === "enabled" ? true : q.status === "disabled" ? false : undefined
  const limit = Math.max(1, Math.min(500, Number.parseInt(q.limit || "50", 10) || 50))
  const [templates, count] = await (mod as any).listAndCountCommunicationTemplates
    ? await (mod as any).listAndCountCommunicationTemplates(filters, { take: limit, order: { created_at: "DESC" } })
    : [await (mod as any).listCommunicationTemplates(filters, { take: limit, order: { created_at: "DESC" } }), 0]
  return res.json({ templates, count: count || templates.length, limit })
}

export const POST = async (req: MedusaRequest, res: MedusaResponse) => {
  const parsed = UpsertSchema.safeParse(req.body ?? {})
  if (!parsed.success) return res.status(400).json({ message: "Invalid payload", errors: parsed.error.flatten() })
  const mod = req.scope.resolve(COMMUNICATION_MODULE) as CommunicationModuleService
  const row = await (mod as any).upsertTemplate("email", parsed.data)
  return res.json(row)
}
