import { model } from "@medusajs/framework/utils"

/**
 * Customer-facing client id, format `NNNNYYWW`:
 *   NNNN — zero-padded weekly signup sequence (resets each ISO week)
 *   YY   — last two digits of the ISO-week year
 *   WW   — ISO 8601 week number (1..53)
 *
 * Computed from the customer's `created_at` in Asia/Kolkata. ISO week
 * year is used (not calendar year) so the year+week pair always names
 * a unique week — Jan 1 may belong to W52/W53 of the previous ISO year.
 *
 * Stored fields:
 *   - client_id  — the displayed string ("00012619" etc.)
 *   - seq        — the NNNN component as int (1..9999), useful for
 *                  reasoning + admin
 *   - iso_year   — full 4-digit ISO year (2026), not the YY suffix
 *   - iso_week   — 1..53
 *
 * Uniqueness is enforced at three levels (see migration):
 *   - one row per customer (customer_id unique)
 *   - one client_id globally (client_id unique)
 *   - one (iso_year, iso_week, seq) triple (so concurrent inserts
 *     racing for the same NNNN cleanly fail and retry)
 */
export const CustomerClientId = model.define("customer_client_id", {
  id: model.id().primaryKey(),
  customer_id: model.text().index(),
  client_id: model.text().index(),
  seq: model.number(),
  iso_year: model.number(),
  iso_week: model.number(),
})
