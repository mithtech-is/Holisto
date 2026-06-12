import { model } from "@medusajs/framework/utils"

/**
 * Audit + idempotency ledger for inbound webhooks. `event_id` is unique so
 * duplicate deliveries (Cashfree retries on non-2xx) are no-ops. The raw
 * payload + signature are stored for investigation of disputed events.
 */
export const WebhookEvent = model.define("cashfree_webhook_event", {
  id: model.id().primaryKey(),
  provider: model.text().default("cashfree"),
  channel: model.enum(["vba", "verification", "payouts"]),
  event_id: model.text().unique(),
  event_type: model.text().nullable(),
  signature: model.text().nullable(),
  payload_raw: model.json(),
  processing_status: model
    .enum(["received", "processing", "processed", "failed"])
    .default("received"),
  processing_error: model.text().nullable(),
  processed_at: model.dateTime().nullable(),
})
