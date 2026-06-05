import { model } from "@medusajs/framework/utils"

/**
 * Customer-submitted "please add this company to the marketplace" request.
 *
 * Created from the Holdings page when a user types a company that doesn't
 * exist in our product catalog. Admin reviews; once they actually add the
 * company as a Medusa product (manually, in the Medusa admin), they hit
 * "Approve" on this row, which fires a `Notification` to the customer
 * ("CompanyName is now on Polemarch — add it to your holdings").
 *
 * The request itself doesn't create the product — that's still a manual
 * admin step. This row is just the inbox + notification trigger.
 */
export const CompanyRequest = model.define("company_request", {
  id: model.id().primaryKey(),
  customer_id: model.text().index(),
  company_name: model.text(),
  isin: model.text().nullable(),
  customer_note: model.text().nullable(),
  status: model
    .enum(["pending", "approved", "rejected"])
    .default("pending"),
  reviewer_user_id: model.text().nullable(),
  reviewer_notes: model.text().nullable(),
  reviewed_at: model.dateTime().nullable(),
})
