import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { CUSTOMER_IDENTITY_MODULE } from "../../../modules/customer_identity"

/**
 * GET /admin/identity-registry
 *   ?q=                — case-insensitive partial match on
 *                        pan_masked / client_id /
 *                        cashfree_virtual_account_id /
 *                        beneficiary_name / virtual_account_number
 *   &released=1        — only rows whose current_customer_id is NULL
 *                        (the prior holder was hard-deleted, PAN free
 *                        to be reclaimed)
 *   &reattached=1      — only rows where reattach_count > 0 (PAN has
 *                        churned at least once)
 *   &limit=50&offset=0
 *
 * Global PAN→client_id→VBA registry. One row per real human (per
 * PAN). Survives customer deletion. See
 * modules/customer_identity/models/customer-identity-registry.ts.
 */
export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const q = (req.query.q as string | undefined)?.trim() || ""
  const releasedOnly =
    String(req.query.released ?? "") === "1" ||
    String(req.query.released ?? "") === "true"
  const reattachedOnly =
    String(req.query.reattached ?? "") === "1" ||
    String(req.query.reattached ?? "") === "true"
  const limit = Math.min(
    Math.max(Number.parseInt(String(req.query.limit ?? "50"), 10) || 50, 1),
    200,
  )
  const offset = Math.max(
    Number.parseInt(String(req.query.offset ?? "0"), 10) || 0,
    0,
  )

  const pg: any = req.scope.resolve(ContainerRegistrationKeys.PG_CONNECTION)

  const where: string[] = ["1=1"]
  const whereBindings: any[] = []
  if (q) {
    const like = `%${q}%`
    whereBindings.push(like, like, like, like, like)
    where.push(
      `(pan_masked ILIKE ? OR client_id ILIKE ? OR cashfree_virtual_account_id ILIKE ? OR beneficiary_name ILIKE ? OR virtual_account_number ILIKE ?)`,
    )
  }
  if (releasedOnly) {
    where.push(`current_customer_id IS NULL`)
  }
  if (reattachedOnly) {
    where.push(`reattach_count > 0`)
  }
  const whereClause = where.join(" AND ")

  const rowsQ = await pg.raw(
    `
    SELECT *
    FROM customer_identity_registry
    WHERE ${whereClause}
    ORDER BY last_attached_at DESC NULLS LAST
    LIMIT ? OFFSET ?
    `,
    [...whereBindings, limit, offset],
  )
  const countQ = await pg.raw(
    `
    SELECT COUNT(*)::int AS c
    FROM customer_identity_registry
    WHERE ${whereClause}
    `,
    whereBindings,
  )
  const rows = rowsQ.rows ?? rowsQ
  const count = (countQ.rows?.[0]?.c ?? countQ[0]?.c) ?? 0
  // Identity rows already store everything compact; no payload trim
  // needed beyond the default.
  res.json({ count, limit, offset, items: rows })
  // The customer_identity module is unused in this raw-SQL path but
  // imported by the [id] detail route below.
  void CUSTOMER_IDENTITY_MODULE
}
