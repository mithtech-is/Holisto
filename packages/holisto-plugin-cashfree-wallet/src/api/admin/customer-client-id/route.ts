import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import {
  CUSTOMER_IDENTITY_MODULE,
  CustomerIdentityService,
  isClientIdShape,
} from "../../../modules/customer_identity"

/**
 * GET /admin/customer-client-id?customer_id=cus_…
 *   → { client_id: string|null }
 *
 * GET /admin/customer-client-id?client_id=00012619
 *   → { customer_id: string|null }
 *
 * Two query patterns share the route to keep the admin surface small.
 * Used by the Customer 360 overview (forward) and the customer search
 * box (reverse — when an admin pastes a client_id).
 */
export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const identity = req.scope.resolve(
    CUSTOMER_IDENTITY_MODULE,
  ) as CustomerIdentityService

  const customerId =
    typeof req.query.customer_id === "string" ? req.query.customer_id : null
  const clientId =
    typeof req.query.client_id === "string" ? req.query.client_id : null

  if (customerId) {
    const row = await identity.getByCustomerId(customerId)
    return res.json({ client_id: row?.client_id ?? null })
  }
  if (clientId) {
    if (!isClientIdShape(clientId)) {
      return res.json({ customer_id: null })
    }
    const row = await identity.getByClientId(clientId)
    return res.json({ customer_id: row?.customer_id ?? null })
  }
  return res
    .status(400)
    .json({ message: "Pass either customer_id or client_id." })
}
