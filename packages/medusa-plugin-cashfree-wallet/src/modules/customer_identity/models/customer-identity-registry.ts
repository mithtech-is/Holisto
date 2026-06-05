import { model } from "@medusajs/framework/utils"

/**
 * Per-PAN identity registry — outlives any single customer account.
 *
 * Why this table exists
 * ---------------------
 * A real human (one PAN) may delete and recreate their Polemarch
 * account multiple times. Without this registry, every fresh signup
 * would be issued a new `client_id` and a new Cashfree VBA — wasting
 * Cashfree quota AND making the system blind to the fact that
 * customer A and customer B are the same person under SEBI's KYC
 * lens.
 *
 * With this registry, the chain
 *   PAN  →  client_id  →  cashfree_virtual_account_id (VBA)
 * is anchored on the PAN and persists forever. On re-registration
 * with the same PAN we re-issue the original client_id and reattach
 * the original VBA — money sent to that VBA from a previous identity
 * still credits to whoever currently owns the PAN.
 *
 * Lifecycle
 * ---------
 *  - Created on first PAN-verify success (via the registry's
 *    `claimForCustomer` helper). VBA details are populated as soon
 *    as the bank-verify path mints a VBA.
 *  - On hard-delete: `current_customer_id` set to NULL,
 *    `release_count` incremented, `last_attached_at` updated. The
 *    row STAYS — `customer_client_id` and `cashfree_virtual_account`
 *    rows are deleted independently as part of the hard-delete
 *    pipeline.
 *  - On re-registration with same PAN: lookup by `pan_hash`,
 *    `current_customer_id` set to the new customer, `reattach_count`
 *    incremented, `last_attached_at` updated. NO Cashfree call;
 *    `customer_client_id` row recreated with the registry's stored
 *    `client_id`; `cashfree_virtual_account` row recreated with the
 *    registry's stored VBA fields.
 *
 * Why no `deleted_at`
 * -------------------
 * This table never soft-deletes. Compliance / SEBI retention
 * intentionally outlives the customer. The closest thing to a
 * "delete" is the release flow above (which preserves the row).
 *
 * PAN storage decision
 * --------------------
 *  - `pan_hash` is the canonical lookup key (SHA-256, deterministic,
 *    indexable, privacy-preserving). All matching uses this column.
 *  - `pan_masked` is for admin display ("ABCDE****F").
 *  - `pan_full` is duplicated from `pan_record.pan_full` so the
 *    registry stays self-sufficient even if a `pan_record` row is
 *    purged or fails to populate. Admin UI surfaces it behind a
 *    Reveal toggle (eye icon) — never returned by storefront APIs.
 *    Populated on every claim/reattach when the caller has the
 *    plaintext PAN in hand (PAN-verify flow always does). Older
 *    rows from before this column landed will be NULL until the
 *    next PAN re-verify or backfill run fills them in.
 */
export const CustomerIdentityRegistry = model.define(
  "customer_identity_registry",
  {
    id: model.id().primaryKey(),
    /** SHA-256 of trimmed-uppercase PAN. The lookup key — every flow
     *  that wants to find "is this person already in our system?"
     *  hits this column. */
    pan_hash: model.text().index(),
    /** Display-only mask: "ABCDE****F". Never used for matching. */
    pan_masked: model.text(),
    /** FULL 10-character PAN — duplicated from `pan_record.pan_full`
     *  so the registry stays self-sufficient even if a pan_record row
     *  is missing. Surfaced to admins via the "Reveal" toggle in the
     *  identity-registry admin UI; never returned by storefront APIs.
     *  Nullable — older rows from before this column landed will be
     *  NULL until the next PAN re-verify or backfill fills them in. */
    pan_full: model.text().nullable(),
    /** The 8-char `NNNNYYWW` identifier issued ONCE per real human
     *  (i.e. once per PAN). Reused on re-registration. Kept in sync
     *  with the active `customer_client_id.client_id`. */
    client_id: model.text().index(),
    /** Cashfree's VBA short handle ("00072619"). Reused on
     *  re-registration — Cashfree's VBA is NOT recreated. NULL until
     *  the bank-verify flow mints the VBA (PAN-verify creates the
     *  registry row first, VBA mint follows on first verified bank). */
    cashfree_virtual_account_id: model.text().nullable(),
    /** The routable bank account number ("9426156700072619") that
     *  customers paste into NEFT/IMPS forms. Cached so the wallet UI
     *  can render details without re-calling Cashfree. */
    virtual_account_number: model.text().nullable(),
    /** Cashfree's Axis sub-branch IFSC ("UTIB0CCH274"). Static. */
    ifsc: model.text().nullable(),
    /** Beneficiary name as it appears at the destination bank.
     *  Usually the customer's PAN-verified legal name. */
    beneficiary_name: model.text().nullable(),
    /** Cashfree-issued UPI handle bound to this VBA. Optional —
     *  some VBAs only accept NEFT/IMPS/RTGS. */
    upi_id: model.text().nullable(),
    /** First customer who triggered VBA mint for this PAN. Stays
     *  pinned for audit even after that customer is hard-deleted. */
    first_customer_id: model.text(),
    /** Currently-attached customer. NULL when the PAN's current
     *  account has been hard-deleted but no new account has claimed
     *  it yet. Set on every PAN-verify success. */
    current_customer_id: model.text().nullable(),
    /** When Cashfree first minted the VBA. Anchored to the original
     *  customer; never overwritten. */
    first_provisioned_at: model.dateTime(),
    /** Updated on every claim or release. Useful as a "last seen
     *  active" signal in admin views. */
    last_attached_at: model.dateTime(),
    /** Incremented every time a customer holding this PAN is
     *  hard-deleted. Tracks how many times the identity has churned. */
    release_count: model.number().default(0),
    /** Incremented every time a fresh customer claims this PAN
     *  (i.e., re-registration after a hard-delete). */
    reattach_count: model.number().default(0),
  },
)
