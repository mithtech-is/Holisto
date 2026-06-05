import { MedusaService } from "@medusajs/framework/utils"
import { CustomerClientId } from "./models/customer-client-id"
import { CustomerIdentityRegistry } from "./models/customer-identity-registry"
import { formatClientId, istIsoWeek } from "./iso-week"

const MAX_RETRIES = 8
const MAX_WEEKLY_SEQ = 9999

class CustomerIdentityService extends MedusaService({
  CustomerClientId,
  CustomerIdentityRegistry,
}) {
  /**
   * Idempotently assign a `client_id` to `customer_id`, computed from
   * `created_at` (defaults to now). Safe under concurrent signups: the
   * `(iso_year, iso_week, seq)` unique index makes racing inserts
   * cleanly fail, and we retry the next sequence number.
   */
  async assignClientId(
    customer_id: string,
    created_at: Date | string = new Date(),
  ) {
    const existing = await this.listCustomerClientIds(
      { customer_id },
      { take: 1 },
    )
    if (existing.length > 0) return existing[0]

    const { isoYear, isoWeek } = istIsoWeek(created_at)

    let lastErr: unknown = null
    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      const [latest] = await this.listCustomerClientIds(
        { iso_year: isoYear, iso_week: isoWeek },
        { take: 1, order: { seq: "DESC" } },
      )
      const nextSeq = (latest?.seq ?? 0) + 1
      if (nextSeq > MAX_WEEKLY_SEQ) {
        throw new Error(
          `client_id weekly sequence exhausted for ISO ${isoYear}-W${isoWeek}`,
        )
      }
      const client_id = formatClientId(nextSeq, isoYear, isoWeek)
      try {
        const [row] = await this.createCustomerClientIds([
          {
            customer_id,
            client_id,
            seq: nextSeq,
            iso_year: isoYear,
            iso_week: isoWeek,
          },
        ])
        return row
      } catch (e: any) {
        lastErr = e
        const msg = String(e?.message ?? e ?? "")
        // Postgres unique-violation surfaces as 23505. Either we lost
        // the (iso_year, iso_week, seq) race to another inserter, or
        // a concurrent assignment for the same customer beat us — in
        // the latter case the second iteration sees `existing` and
        // returns it.
        if (
          msg.includes("23505") ||
          msg.includes("duplicate key") ||
          msg.includes("unique constraint")
        ) {
          const [reExisting] = await this.listCustomerClientIds(
            { customer_id },
            { take: 1 },
          )
          if (reExisting) return reExisting
          continue
        }
        throw e
      }
    }
    throw new Error(
      `Failed to assign client_id for ${customer_id} after ${MAX_RETRIES} retries: ${String(
        lastErr,
      )}`,
    )
  }

  async getByCustomerId(customer_id: string) {
    const [row] = await this.listCustomerClientIds(
      { customer_id },
      { take: 1 },
    )
    return row ?? null
  }

  async getByClientId(client_id: string) {
    const [row] = await this.listCustomerClientIds(
      { client_id },
      { take: 1 },
    )
    return row ?? null
  }

  // ─── customer_identity_registry — PAN-anchored identity ─────────

  /**
   * Look up a registry row by PAN hash. Returns null if no row exists
   * (i.e., this is a brand-new PAN we haven't seen before).
   */
  async lookupRegistryByPanHash(pan_hash: string) {
    if (!pan_hash) return null
    const [row] = await this.listCustomerIdentityRegistries(
      { pan_hash },
      { take: 1 },
    )
    return row ?? null
  }

  /**
   * Look up a registry row by the customer currently attached to it.
   * Useful in flows that have a customer_id but not a pan_hash yet
   * (e.g., admin tools).
   */
  async lookupRegistryByCustomerId(customer_id: string) {
    if (!customer_id) return null
    const [row] = await this.listCustomerIdentityRegistries(
      { current_customer_id: customer_id },
      { take: 1 },
    )
    return row ?? null
  }

  /**
   * Claim or create the registry entry for (pan_hash, customer_id).
   *
   * Three cases:
   *   1. Registry row exists for this pan_hash AND its
   *      `current_customer_id` already equals this customer_id →
   *      no-op (idempotent re-call). Returns the row as-is.
   *   2. Registry row exists with a DIFFERENT or NULL
   *      current_customer_id → REATTACH path. The PAN is being
   *      reclaimed by a new customer (re-registration after a
   *      hard-delete, or admin-triggered identity stitch). Updates
   *      current_customer_id, bumps reattach_count, refreshes
   *      last_attached_at.
   *   3. No registry row exists → CREATE path. Caller must supply
   *      the freshly-issued client_id and (if known) VBA details.
   *      VBA fields can be omitted at this stage; subsequent calls
   *      to `attachVbaToRegistry` fill them in once the bank-verify
   *      path mints the VBA.
   *
   * Caller is responsible for the actual `customer_client_id` row
   * insert (with the registry's `client_id` value) and for the
   * `cashfree_virtual_account` row insert (with the registry's VBA
   * id) — this method only owns the registry row itself.
   */
  async claimForCustomer(input: {
    pan_hash: string
    pan_masked: string
    customer_id: string
    /** Required on the CREATE path; ignored on REATTACH. */
    client_id_for_create?: string
    /** Plaintext PAN — written on CREATE, and backfilled onto an
     *  existing row whose `pan_full` is still NULL (rows that predate
     *  the column). Never overwrites a non-null existing value. */
    pan_full?: string | null
    /** Optional VBA details; written on CREATE if present, otherwise
     *  filled in later via `attachVbaToRegistry`. */
    cashfree_virtual_account_id?: string
    virtual_account_number?: string
    ifsc?: string
    beneficiary_name?: string | null
    upi_id?: string | null
  }): Promise<{
    row: any
    is_new: boolean
    is_reattach: boolean
  }> {
    const existing = await this.lookupRegistryByPanHash(input.pan_hash)
    const now = new Date()

    if (existing) {
      // Backfill pan_full opportunistically: never overwrite an
      // existing value, but if the row predates the column and the
      // caller has the plaintext PAN in hand, fill it in now.
      const shouldBackfillPanFull =
        !(existing as any).pan_full &&
        typeof input.pan_full === "string" &&
        input.pan_full.length > 0

      // Idempotent: already attached to this customer → no-op (still
      // backfill pan_full if missing).
      if (existing.current_customer_id === input.customer_id) {
        if (shouldBackfillPanFull) {
          const updated = await this.updateCustomerIdentityRegistries({
            selector: { id: existing.id },
            data: { pan_full: input.pan_full },
          })
          return {
            row: Array.isArray(updated) ? updated[0] : updated,
            is_new: false,
            is_reattach: false,
          }
        }
        return { row: existing, is_new: false, is_reattach: false }
      }
      // Reattach: same PAN, new customer.
      const updated = await this.updateCustomerIdentityRegistries({
        selector: { id: existing.id },
        data: {
          current_customer_id: input.customer_id,
          last_attached_at: now,
          reattach_count: ((existing as any).reattach_count ?? 0) + 1,
          ...(shouldBackfillPanFull ? { pan_full: input.pan_full } : {}),
        },
      })
      return {
        row: Array.isArray(updated) ? updated[0] : updated,
        is_new: false,
        is_reattach: true,
      }
    }

    // CREATE path — must have client_id; VBA fields optional.
    if (!input.client_id_for_create) {
      throw new Error(
        "claimForCustomer: client_id_for_create is required on first claim of a new PAN",
      )
    }
    // VBA fields are nullable — populated either at create time
    // (when caller already has the VBA) or later via
    // `attachVbaToRegistry` (PAN-verify-first, bank-verify-later flow).
    const created = await this.createCustomerIdentityRegistries([
      {
        pan_hash: input.pan_hash,
        pan_masked: input.pan_masked,
        pan_full: input.pan_full ?? null,
        client_id: input.client_id_for_create,
        cashfree_virtual_account_id:
          input.cashfree_virtual_account_id ?? null,
        virtual_account_number: input.virtual_account_number ?? null,
        ifsc: input.ifsc ?? null,
        beneficiary_name: input.beneficiary_name ?? null,
        upi_id: input.upi_id ?? null,
        first_customer_id: input.customer_id,
        current_customer_id: input.customer_id,
        first_provisioned_at: now,
        last_attached_at: now,
        release_count: 0,
        reattach_count: 0,
      },
    ])
    return {
      row: Array.isArray(created) ? created[0] : created,
      is_new: true,
      is_reattach: false,
    }
  }

  /**
   * Fill in the VBA details on a registry row whose `claimForCustomer`
   * was called before the VBA was minted. Idempotent — if the VBA
   * fields are already populated and match, returns the row.
   */
  async attachVbaToRegistry(input: {
    pan_hash: string
    cashfree_virtual_account_id: string
    virtual_account_number: string
    ifsc: string
    beneficiary_name?: string | null
    upi_id?: string | null
  }): Promise<any | null> {
    const existing = await this.lookupRegistryByPanHash(input.pan_hash)
    if (!existing) return null
    // If already populated with the same values, idempotent.
    if (
      existing.cashfree_virtual_account_id ===
        input.cashfree_virtual_account_id &&
      existing.virtual_account_number === input.virtual_account_number
    ) {
      return existing
    }
    const updated = await this.updateCustomerIdentityRegistries({
      selector: { id: existing.id },
      data: {
        cashfree_virtual_account_id: input.cashfree_virtual_account_id,
        virtual_account_number: input.virtual_account_number,
        ifsc: input.ifsc,
        beneficiary_name: input.beneficiary_name ?? existing.beneficiary_name,
        upi_id: input.upi_id ?? existing.upi_id,
      },
    })
    return Array.isArray(updated) ? updated[0] : updated
  }

  /**
   * Mark the registry row as "currently unattached" — called by the
   * hard-delete pipeline BEFORE deleting `customer_client_id` and
   * `cashfree_virtual_account` rows. The registry row itself stays
   * (compliance retention); only `current_customer_id` is cleared.
   *
   * Returns the updated row (or null if no registry entry — e.g.,
   * customer never completed PAN verify).
   */
  async releaseFromCustomer(customer_id: string): Promise<any | null> {
    const existing = await this.lookupRegistryByCustomerId(customer_id)
    if (!existing) return null
    const updated = await this.updateCustomerIdentityRegistries({
      selector: { id: existing.id },
      data: {
        current_customer_id: null,
        last_attached_at: new Date(),
        release_count: ((existing as any).release_count ?? 0) + 1,
      },
    })
    return Array.isArray(updated) ? updated[0] : updated
  }
}

export default CustomerIdentityService
