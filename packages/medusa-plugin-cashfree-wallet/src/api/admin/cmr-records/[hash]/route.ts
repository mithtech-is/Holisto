import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import {
  CASHFREE_WALLET_MODULE,
  CashfreeWalletService,
} from "../../../../modules/cashfree_wallet"

/**
 * GET /admin/cmr-records/:hash
 *
 * Drill-down for a single cmr_record. Returns:
 *   - cmr_record       — full row (incl. verification_raw)
 *   - linked_customers — every demat_account whose `cmr_hash` ==
 *                         this hash, joined to the customer table
 *   - verifications    — secure_id_verification rows with kind='cmr'
 *                         for the linked customers
 *
 * `:hash` is the SHA-256 hex of the depository fingerprint
 * (`cdsl|<boid>` or `nsdl|<dp_id>|<client_id>`).
 */
export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const hash = (req.params.hash as string | undefined)?.trim()
  if (!hash || !/^[a-f0-9]{64}$/i.test(hash)) {
    return res.status(400).json({ message: "Invalid cmr_hash" })
  }

  const walletModule = req.scope.resolve(
    CASHFREE_WALLET_MODULE,
  ) as CashfreeWalletService
  const pg: any = req.scope.resolve(ContainerRegistrationKeys.PG_CONNECTION)

  const record = await walletModule.lookupCmrRecordByHash(hash)
  if (!record) return res.status(404).json({ message: "CMR record not found" })

  const customersQ = await pg.raw(
    `
    SELECT da.id AS demat_account_id, da.customer_id, da.is_primary,
           da.verification_status, da.account_holder_name, da.depository,
           da.boid, da.dp_id, da.client_id, da.cmr_file_url, da.created_at,
           da.deleted_at AS demat_account_deleted_at,
           c.email, c.first_name, c.last_name,
           c.deleted_at AS customer_deleted_at
    FROM demat_account da
    LEFT JOIN customer c ON c.id = da.customer_id
    WHERE da.cmr_hash = ?
    ORDER BY da.created_at DESC
    LIMIT 100
    `,
    [hash],
  )
  const linked_customers = (customersQ.rows ?? customersQ).map((r: any) => ({
    demat_account_id: r.demat_account_id,
    customer_id: r.customer_id,
    is_primary: r.is_primary,
    verification_status: r.verification_status,
    account_holder_name: r.account_holder_name,
    depository: r.depository,
    boid: r.boid,
    dp_id: r.dp_id,
    client_id: r.client_id,
    cmr_file_url: r.cmr_file_url,
    email: r.email ?? null,
    first_name: r.first_name ?? null,
    last_name: r.last_name ?? null,
    created_at: r.created_at,
    demat_account_deleted_at: r.demat_account_deleted_at,
    customer_deleted_at: r.customer_deleted_at,
  }))

  let verifications: any[] = []
  if (linked_customers.length) {
    const ids = Array.from(
      new Set(linked_customers.map((c: any) => c.customer_id)),
    )
    const vq = await pg.raw(
      `
      SELECT id, customer_id, kind, status, reference_id, input_masked,
             expires_at, attempt_no, created_at, updated_at
      FROM secure_id_verification
      WHERE kind = 'cmr'
        AND customer_id = ANY(?::text[])
      ORDER BY created_at DESC
      LIMIT 50
      `,
      [ids],
    )
    verifications = vq.rows ?? vq
  }

  res.json({ cmr_record: record, linked_customers, verifications })
}
