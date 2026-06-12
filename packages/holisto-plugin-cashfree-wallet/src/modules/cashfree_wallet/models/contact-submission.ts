import { model } from "@medusajs/framework/utils"

/**
 * Public contact-form submissions.
 *
 * Written from `POST /store/contact` (no auth — guards are rate-limit
 * + Zod). Ops / support review them via an admin list route.
 *
 * We store minimal PII (name + email + optional phone) and hash nothing
 * because the whole point of the row is that a human can reply. If we
 * later bolt on DPDP data-subject requests, this row + any downstream
 * emails get purged together.
 */
export const ContactSubmission = model.define("contact_submission", {
    id: model.id().primaryKey(),
    name: model.text(),
    email: model.text(),
    phone: model.text().nullable(),
    subject: model.text(),
    message: model.text(),
    /** Stored from X-Forwarded-For / req.ip at submission time for abuse
     *  tracing. Trimmed to the first IP in the list. */
    source_ip: model.text().nullable(),
    /** Customer id when a logged-in user submits (the form works for both
     *  guests and logged-in users). Helps match the message to an
     *  existing account. */
    customer_id: model.text().nullable(),
    /** Ops workflow — starts "new", flips to "in_review" / "resolved"
     *  as the team handles it. */
    status: model
        .enum(["new", "in_review", "resolved", "spam"])
        .default("new"),
    /** Free text from whoever picks it up — closure note / follow-up ref. */
    reviewer_notes: model.text().nullable(),
    reviewer_user_id: model.text().nullable(),
    reviewed_at: model.dateTime().nullable(),
})
