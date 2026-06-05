import type { MedusaContainer } from "@medusajs/framework/types"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"

/**
 * Identity-uniqueness pre-checks. Run these BEFORE the corresponding
 * verify route writes the field, so the user gets a friendly "this is
 * already registered" message rather than the DB unique-constraint
 * error from PG (which Medusa would surface as a 500).
 *
 * Each helper returns the conflicting customer's id when the value is
 * taken by SOMEONE ELSE (not the current customer), or null when the
 * value is unused or already belongs to the same customer (re-verify
 * is a no-op, not a conflict).
 *
 * The DB-level partial unique indexes (customer_phone_unique,
 * customer_pan_hash_unique, customer_aadhaar_hash_unique) catch this
 * as the backstop. These app-level checks just give better error
 * copy to the user.
 */

async function findConflict(
  scope: MedusaContainer,
  sql: string,
  params: unknown[],
  selfCustomerId: string | null,
): Promise<string | null> {
  let pg: any
  try {
    pg = scope.resolve(ContainerRegistrationKeys.PG_CONNECTION)
  } catch {
    return null // PG not wired; skip — DB constraint will catch it
  }
  if (!pg || typeof pg.raw !== "function") return null
  const result = await pg.raw(sql, params).catch(() => null)
  const rows: Array<{ id: string }> = result?.rows ?? []
  if (!rows || rows.length === 0) return null
  const other = rows.find((r) => r.id !== selfCustomerId)
  return other?.id ?? null
}

export async function findConflictingPhoneCustomer(
  scope: MedusaContainer,
  phone_e164: string,
  selfCustomerId: string | null,
): Promise<string | null> {
  return findConflict(
    scope,
    `SELECT id FROM customer
     WHERE phone = ? AND deleted_at IS NULL
     LIMIT 2`,
    [phone_e164],
    selfCustomerId,
  )
}

export async function findConflictingPanHashCustomer(
  scope: MedusaContainer,
  pan_hash: string,
  selfCustomerId: string | null,
): Promise<string | null> {
  return findConflict(
    scope,
    `SELECT id FROM customer
     WHERE metadata->>'pan_hash' = ? AND deleted_at IS NULL
     LIMIT 2`,
    [pan_hash],
    selfCustomerId,
  )
}

export async function findConflictingAadhaarHashCustomer(
  scope: MedusaContainer,
  aadhaar_hash: string,
  selfCustomerId: string | null,
): Promise<string | null> {
  return findConflict(
    scope,
    `SELECT id FROM customer
     WHERE metadata->>'aadhaar_hash' = ? AND deleted_at IS NULL
     LIMIT 2`,
    [aadhaar_hash],
    selfCustomerId,
  )
}
