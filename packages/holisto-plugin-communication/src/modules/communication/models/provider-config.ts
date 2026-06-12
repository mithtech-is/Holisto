// @ts-nocheck
import { model } from "@medusajs/framework/utils"

export const CommunicationProviderConfig = model.define("communication_provider_config", {
  id: model.id().primaryKey(),
  tenant_key: model.text().default("default"),
  channel: model.enum(["email", "sms", "whatsapp"]),
  provider: model.text(),
  enabled: model.boolean().default(false),
  is_primary: model.boolean().default(true),
  is_fallback: model.boolean().default(false),
  settings: model.json().nullable(),
  secrets: model.json().nullable(),
  last_test_ok: model.boolean().nullable(),
  last_test_error: model.text().nullable(),
  last_test_at: model.dateTime().nullable(),
})
