// @ts-nocheck
import { model } from "@medusajs/framework/utils"

export const CommunicationWebhookEvent = model.define("communication_webhook_event", {
  id: model.id().primaryKey(),
  tenant_key: model.text().default("default"),
  provider: model.text(),
  event_type: model.text().nullable(),
  signature: model.text().nullable(),
  replay_key: model.text().nullable(),
  payload: model.json().nullable(),
  status: model.text().default("received"),
  processing_result: model.json().nullable(),
  processed_at: model.dateTime().nullable(),
})
