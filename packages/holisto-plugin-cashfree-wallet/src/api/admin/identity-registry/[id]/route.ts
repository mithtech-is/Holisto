import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { CUSTOMER_IDENTITY_MODULE } from "../../../../modules/customer_identity"

/**
 * GET /admin/identity-registry/:id
 *
 * Drill-down for a single customer_identity_registry row. Returns:
 *   - identity_registry — the full row
 *   - history           — every customer that has ever held this
 *                         registry row, derived from the related
 *                         customer_client_id + cashfree_virtual_account
 *                         tables. Lets ops trace re-registration
 *                         churn ("PAN held by cus_X, released, then
 *                         claimed by cus_Y after a hard-delete").
 *
 * `:id` is the registry-row ULID (id PK on customer_identity_registry).
 */
export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const id = (req.params.id as string | undefined)?.trim()
  if (!id) {
    return res.status(400).json({ message: "Missing id" })
  }

  const identityModule = req.scope.resolve(CUSTOMER_IDENTITY_MODULE) as any
  const pg: any = req.scope.resolve(ContainerRegistrationKeys.PG_CONNECTION)

  const rows = await identityModule
    .listCustomerIdentityRegistries({ id }, { take: 1 })
    .catch(() => [])
  const row = Array.isArray(rows) && rows.length > 0 ? rows[0] : null
  if (!row) {
    return res.status(404).json({ message: "Identity registry row not found" })
  }

  // Find every customer that has been attached to this PAN.
  // customer_client_id keeps a single live row per customer_id
  // (deleted on hard-delete), but we surface BOTH first_customer_id
  // and current_customer_id here. The history join below would also
  // include any legacy customer_client_id rows still extant.
  const historyQ = await pg.raw(
    `
    SELECT cci.id, cci.customer_id, cci.client_id, cci.created_at, cci.deleted_at,
           c.email, c.first_name, c.last_name, c.deleted_at AS customer_deleted_at
    FROM customer_client_id cci
    LEFT JOIN customer c ON c.id = cci.customer_id
    WHERE cci.client_id = ?
    ORDER BY cci.created_at ASC
    LIMIT 50
    `,
    [row.client_id],
  )
  const history = (historyQ.rows ?? historyQ).map((r: any) => ({
    id: r.id,
    customer_id: r.customer_id,
    client_id: r.client_id,
    email: r.email ?? null,
    first_name: r.first_name ?? null,
    last_name: r.last_name ?? null,
    created_at: r.created_at,
    deleted_at: r.deleted_at,
    customer_deleted_at: r.customer_deleted_at,
  }))

  res.json({ identity_registry: row, history })
}
