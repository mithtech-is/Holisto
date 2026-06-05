import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import {
  CASHFREE_WALLET_MODULE,
  CashfreeWalletService,
} from "../../../modules/cashfree_wallet"

/**
 * GET /admin/cmr-records
 *   ?q=                — case-insensitive partial match on
 *                        dp_name / account_holder_name / boid / dp_id /
 *                        client_id / cmr_masked
 *   &orphans=1         — only rows with zero linked customers (no
 *                        demat_account row references this cmr_hash)
 *   &depository=CDSL|NSDL — filter by depository
 *   &limit=50&offset=0
 *
 * Global CMR registry. One row per real demat account (CDSL BOID or
 * NSDL DP-ID + Client-ID). Survives customer deletion. Linked-customer
 * counts join through `demat_account.cmr_hash`.
 */
export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const q = (req.query.q as string | undefined)?.trim() || ""
  const orphansOnly =
    String(req.query.orphans ?? "") === "1" ||
    String(req.query.orphans ?? "") === "true"
  const depository = (req.query.depository as string | undefined)?.trim()
  const limit = Math.min(
    Math.max(Number.parseInt(String(req.query.limit ?? "50"), 10) || 50, 1),
    200,
  )
  const offset = Math.max(
    Number.parseInt(String(req.query.offset ?? "0"), 10) || 0,
    0,
  )

  const walletModule = req.scope.resolve(
    CASHFREE_WALLET_MODULE,
  ) as CashfreeWalletService
  const pg: any = req.scope.resolve(ContainerRegistrationKeys.PG_CONNECTION)

  if (q || orphansOnly || depository) {
    const where: string[] = ["cmr_record.deleted_at IS NULL"]
    const whereBindings: any[] = []
    if (q) {
      const like = `%${q}%`
      whereBindings.push(like, like, like, like, like, like)
      where.push(
        `(dp_name ILIKE ? OR account_holder_name ILIKE ? OR boid ILIKE ? OR dp_id ILIKE ? OR client_id ILIKE ? OR cmr_masked ILIKE ?)`,
      )
    }
    if (depository === "CDSL" || depository === "NSDL") {
      whereBindings.push(depository)
      where.push(`depository = ?`)
    }
    if (orphansOnly) {
      where.push(`NOT EXISTS (
        SELECT 1 FROM demat_account da
        WHERE da.cmr_hash = cmr_record.cmr_hash
          AND da.deleted_at IS NULL
      )`)
    }
    const whereClause = where.join(" AND ")

    const rowsQ = await pg.raw(
      `
      SELECT cmr_record.*
      FROM cmr_record
      WHERE ${whereClause}
      ORDER BY last_refreshed_at DESC NULLS LAST
      LIMIT ? OFFSET ?
      `,
      [...whereBindings, limit, offset],
    )
    const countQ = await pg.raw(
      `
      SELECT COUNT(*)::int AS c
      FROM cmr_record
      WHERE ${whereClause}
      `,
      whereBindings,
    )
    const rows = rowsQ.rows ?? rowsQ
    const count = (countQ.rows?.[0]?.c ?? countQ[0]?.c) ?? 0
    const items = await attachLinkedCounts(pg, rows)
    return res.json({ count, limit, offset, items })
  }

  const [rows, count] = await walletModule.listAndCountCmrRecords(
    {},
    { take: limit, skip: offset, order: { last_refreshed_at: "DESC" } as any },
  )
  const items = await attachLinkedCounts(pg, rows as any[])
  res.json({ count, limit, offset, items })
}

/** Counts linked customers per cmr_hash in one round-trip. */
async function attachLinkedCounts(pg: any, rows: any[]): Promise<any[]> {
  if (!rows.length) return []
  const hashes = rows.map((r) => r.cmr_hash)
  const q = await pg.raw(
    `
    SELECT cmr_hash, COUNT(DISTINCT customer_id)::int AS n
    FROM demat_account
    WHERE cmr_hash = ANY(?::text[])
      AND deleted_at IS NULL
    GROUP BY cmr_hash
    `,
    [hashes],
  )
  const counts = new Map<string, number>()
  for (const r of q.rows ?? q) counts.set(r.cmr_hash, Number(r.n))
  return rows.map((r) => {
    // Strip verbose verification_raw from list payload — drill-down
    // returns it in full.
    const { verification_raw: _omit, ...rest } = r
    return {
      ...rest,
      linked_customer_count: counts.get(r.cmr_hash) ?? 0,
    }
  })
}
