import { model } from "@medusajs/framework/utils"

/**
 * Tracks a Medusa Order that was created despite insufficient wallet funds.
 * The order sits with `payment_status=awaiting` until VBA credits arrive;
 * the `capture-held-orders` workflow scans these FIFO per customer on every
 * VBA credit and auto-debits+captures.
 */
export const HeldOrder = model.define("held_order", {
  id: model.id().primaryKey(),
  order_id: model.text().unique().index(),
  customer_id: model.text().index(),
  required_total_inr: model.number(),
  shortfall_inr_at_creation: model.number(),
  status: model
    .enum(["awaiting_funds", "capturing", "captured", "cancelled"])
    .default("awaiting_funds"),
  created_from_payment_attempt_id: model.text().nullable(),
  captured_at: model.dateTime().nullable(),
  cancelled_at: model.dateTime().nullable(),
  cancellation_reason: model.text().nullable(),
})
