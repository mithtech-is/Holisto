import { model } from "@medusajs/framework/utils"

/**
 * DPDP Act 2023 data-subject requests.
 *
 * The DPDP Act gives customers ("Data Principals") the right to a
 * machine-readable copy of their personal data and the right to have
 * it erased. Both flows are gated behind ops review:
 *
 * - "export" — ops compiles a JSON bundle of every customer-owned row
 *   (KYC, bank, demat, wallet ledger, orders, watchlist, referrals,
 *   audit log) and emails the customer a download link.
 * - "delete" — ops verifies the customer has no live obligations
 *   (open orders, undisbursed wallet balance, pending KYC) and then
 *   either purges or tombstones the rows according to the retention
 *   schedule documented in `/privacy`.
 *
 * The 30-day SLA in `/privacy` is enforced by an ops dashboard query
 * that surfaces requests with `created_at` older than 23 days.
 *
 * Storefront sees a per-customer view via `GET /store/account/<kind>`
 * so the UI can show the in-progress state and prevent spam (one open
 * request per kind at a time — see DB unique partial index).
 */
export const AccountRequest = model.define("account_request", {
    id: model.id().primaryKey(),
    customer_id: model.text(),
    customer_email: model.text(),
    kind: model.enum(["export", "delete"]),
    /**
     * Lifecycle:
     *   pending     — submitted by customer, awaiting ops pickup
     *   in_review   — ops has acknowledged, currently working on it
     *   completed   — exported (file_url set) / data erased (note set)
     *   rejected    — ops cannot fulfill (e.g. live obligations); reason in note
     *   cancelled   — customer withdrew the request
     */
    status: model
        .enum(["pending", "in_review", "completed", "rejected", "cancelled"])
        .default("pending"),
    /** Optional free-text from the customer (e.g. reason for deletion). */
    customer_note: model.text().nullable(),
    /** For exports: signed download URL we email out. Cleared after expiry. */
    export_file_url: model.text().nullable(),
    /** For exports: when the URL stops being valid. Customer is told to
     *  re-request after this. */
    export_expires_at: model.dateTime().nullable(),
    /** Free text from whoever closed the ticket — closure note, deletion
     *  scope, or rejection reason. */
    reviewer_notes: model.text().nullable(),
    reviewer_user_id: model.text().nullable(),
    reviewed_at: model.dateTime().nullable(),
    /** Caller IP at submission time for abuse tracing. Same convention as
     *  contact_submission. */
    source_ip: model.text().nullable(),
})
