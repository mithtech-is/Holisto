import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import {
  CASHFREE_WALLET_MODULE,
  CashfreeWalletService,
} from "../../../../modules/cashfree_wallet"

/**
 * GET /admin/pan-records/:hash
 *
 * Drill-down detail for one pan_record. Returns:
 *   - pan_record         : the full row (incl. response_raw)
 *   - linked_customers   : every customer whose metadata.pan_hash points here
 *                          (could be zero — orphan, e.g. customer was purged)
 *   - verifications      : recent secure_id_verification rows for kind=pan
 *                          tied to any of the linked customers (last 50)
 *
 * The :hash path param is the SHA-256 hex of the uppercase PAN —
 * same value that's stored on customer.metadata.pan_hash.
 */
export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const hash = (req.params.hash as string | undefined)?.trim()
  if (!hash || !/^[a-f0-9]{64}$/i.test(hash)) {
    return res.status(400).json({ message: "Invalid pan_hash" })
  }

  const walletModule = req.scope.resolve(
    CASHFREE_WALLET_MODULE,
  ) as CashfreeWalletService
  const pg: any = req.scope.resolve(ContainerRegistrationKeys.PG_CONNECTION)

  const record = await walletModule.lookupPanRecordByHash(hash)
  if (!record) return res.status(404).json({ message: "PAN record not found" })

  // Surface unmasked fields that Cashfree returned but we don't promote
  // to typed columns. The full PAN is echoed in `response_raw.pan`;
  // `response_raw.name_provided` is the name the customer typed at
  // verify time (useful when grading "Bob's PAN, Alice's name" cases).
  // Email/phone in response_raw are ALREADY masked by Cashfree itself
  // (e.g. `sj****58@gmail.com`, `99XXXXXX99`) — UIDAI / Cashfree policy
  // means the unmasked forms never reach us.
  const raw = (record as any).response_raw as Record<string, any> | null
  const enriched = {
    ...record,
    pan_full: raw?.pan ?? null,
    name_provided: raw?.name_provided ?? null,
    mobile_number: raw?.mobile_number ?? null,
  }

  // Knex/pg in Medusa uses `?` for positional bindings — NOT `$N`.
  const customersQ = await pg.raw(
    `
    SELECT id, email, first_name, last_name, created_at, deleted_at,
           metadata->>'pan_registered_name' AS pan_registered_name
    FROM customer
    WHERE metadata->>'pan_hash' = ?
    ORDER BY created_at DESC
    LIMIT 100
    `,
    [hash],
  )
  const linked_customers = (customersQ.rows ?? customersQ).map((r: any) => ({
    id: r.id,
    email: r.email,
    first_name: r.first_name,
    last_name: r.last_name,
    created_at: r.created_at,
    deleted_at: r.deleted_at,
    pan_registered_name: r.pan_registered_name,
  }))

  let verifications: any[] = []
  if (linked_customers.length) {
    const ids = linked_customers.map((c: any) => c.id)
    const vq = await pg.raw(
      `
      SELECT id, customer_id, kind, status, reference_id, input_masked,
             expires_at, attempt_no, created_at, updated_at
      FROM secure_id_verification
      WHERE kind = 'pan'
        AND customer_id = ANY(?::text[])
      ORDER BY created_at DESC
      LIMIT 50
      `,
      [ids],
    )
    verifications = vq.rows ?? vq
  }

  res.json({ pan_record: enriched, linked_customers, verifications })
}
