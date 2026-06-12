// @ts-nocheck
import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { z } from "zod"
import { COMMUNICATION_MODULE, CommunicationModuleService } from "../../../../../modules/communication"

const UpsertSchema = z.object({
  provider: z.enum(["smtp", "sendgrid", "resend", "aws_ses"]).optional(),
  enabled: z.boolean().optional(),
  host: z.string().optional().nullable(),
  port: z.union([z.string(), z.number()]).optional().nullable(),
  username: z.string().optional().nullable(),
  password: z.string().optional().nullable(),
  encryption: z.string().optional().nullable(),
  api_key: z.string().optional().nullable(),
  secret_access_key: z.string().optional().nullable(),
  region: z.string().optional().nullable(),
  from_email: z.string().optional().nullable(),
})

export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const mod = req.scope.resolve(COMMUNICATION_MODULE) as CommunicationModuleService
  const provider = String((req.query as any)?.provider || "smtp")
  return res.json(await mod.getEmailConfigView(provider))
}

export const PUT = async (req: MedusaRequest, res: MedusaResponse) => {
  const parsed = UpsertSchema.safeParse(req.body ?? {})
  if (!parsed.success) return res.status(400).json({ message: "Invalid payload", errors: parsed.error.flatten() })
  const input = { ...parsed.data }
  for (const key of ["password", "api_key", "secret_access_key"] as const) {
    if (input[key] === "") delete input[key]
  }
  const mod = req.scope.resolve(COMMUNICATION_MODULE) as CommunicationModuleService
  return res.json(await mod.upsertEmailConfig(input))
}
