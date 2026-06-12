// @ts-nocheck
import { model } from "@medusajs/framework/utils"

export const CommunicationMessageLog = model.define("communication_message_log", {
  id: model.id().primaryKey(),
  tenant_key: model.text().default("default"),
  channel: model.enum(["email", "sms", "whatsapp"]),
  event_name: model.text().nullable(),
  template_slug: model.text().nullable(),
  recipient: model.text(),
  to_phone: model.text().nullable(),
  to_email: model.text().nullable(),
  subject: model.text().nullable(),
  body: model.text().nullable(),
  provider: model.text().nullable(),
  provider_message_id: model.text().nullable(),
  status: model.text().default("queued"),
  error: model.text().nullable(),
  metadata: model.json().nullable(),
  opened_at: model.dateTime().nullable(),
  clicked_at: model.dateTime().nullable(),
  delivered_at: model.dateTime().nullable(),
  read_at: model.dateTime().nullable(),
})
