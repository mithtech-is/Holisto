// @ts-nocheck
import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { COMMUNICATION_MODULE, CommunicationModuleService } from "../../../../../modules/communication"

export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const mod = req.scope.resolve(COMMUNICATION_MODULE) as CommunicationModuleService
  const slug = req.params.slug
  const rows = await (mod as any).listCommunicationTemplates(
    { channel: "email", slug, tenant_key: "default" },
    { take: 1 },
  )
  if (!rows[0]) return res.status(404).json({ message: "Email template not found" })
  return res.json(rows[0])
}

export const PUT = async (req: MedusaRequest, res: MedusaResponse) => {
  const mod = req.scope.resolve(COMMUNICATION_MODULE) as CommunicationModuleService
  const slug = req.params.slug
  const row = await (mod as any).upsertTemplate("email", { ...req.body, slug })
  return res.json(row)
}

export const DELETE = async (req: MedusaRequest, res: MedusaResponse) => {
  const mod = req.scope.resolve(COMMUNICATION_MODULE) as CommunicationModuleService
  const slug = req.params.slug
  const rows = await (mod as any).listCommunicationTemplates(
    { channel: "email", slug, tenant_key: "default" },
    { take: 1 },
  )
  if (!rows[0]) return res.status(404).json({ message: "Email template not found" })
  if (rows[0].is_system) return res.status(409).json({ message: "System templates cannot be deleted" })
  await (mod as any).deleteCommunicationTemplates(rows[0].id)
  return res.status(200).json({ ok: true })
}
