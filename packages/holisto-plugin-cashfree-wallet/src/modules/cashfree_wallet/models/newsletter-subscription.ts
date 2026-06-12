import { model } from "@medusajs/framework/utils"

/**
 * Newsletter subscribers.
 *
 * Written from `POST /store/newsletter`. Unique on email so duplicate
 * submissions are idempotent (we upsert + track last-seen timestamp).
 * A dedicated `unsubscribed_at` column lets us honor unsub requests
 * without deleting the row — some customers unsub then re-sub; preserving
 * history helps with double-opt-in audits.
 */
export const NewsletterSubscription = model.define("newsletter_subscription", {
    id: model.id().primaryKey(),
    email: model.text().unique(),
    source: model.text().nullable(),
    source_ip: model.text().nullable(),
    /** Set when the user clicks the unsubscribe link in an email; when
     *  non-null, downstream mail providers should exclude this address. */
    unsubscribed_at: model.dateTime().nullable(),
    /** First signup timestamp. Stays pinned even if the user re-subscribes. */
    first_seen_at: model.dateTime().nullable(),
    /** Updated each time the same email re-submits the form. */
    last_seen_at: model.dateTime().nullable(),
})
