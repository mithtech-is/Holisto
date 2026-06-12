// @ts-nocheck
import { model } from "@medusajs/framework/utils"

export const CommunicationEventRule = model.define("communication_event_rule", {
  id: model.id().primaryKey(),
  tenant_key: model.text().default("default"),
  event_name: model.text(),
  channel: model.enum(["email", "sms", "whatsapp"]),
  template_slug: model.text(),
  recipient_resolver: model.text().default("customer"),
  static_recipient: model.text().nullable(),
  enabled: model.boolean().default(true),
  delay_seconds: model.number().default(0),
  conditions: model.json().nullable(),
  retry_policy: model.json().nullable(),
})
