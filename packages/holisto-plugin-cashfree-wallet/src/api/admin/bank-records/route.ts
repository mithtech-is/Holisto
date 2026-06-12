import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import {
  CASHFREE_WALLET_MODULE,
  CashfreeWalletService,
} from "../../../modules/cashfree_wallet"

/**
 * GET /admin/bank-records
 *   ?q=                      — case-insensitive partial match on
 *                               bank_name / branch / city / IFSC /
 *                               name_at_bank / account-number-last4
 *   &orphans=1               — only rows with zero linked customers
 *   &limit=50&offset=0
 *
 * Global bank registry. Every bank account we've ever confirmed via
 * Cashfree BAV v2 (`/verification/bank-account/sync`,
 * x-api-version 2024-01-01). One row per unique (IFSC, account
 * number) pair, keyed by SHA-256(<IFSC>:<account_number>). Survives
 * customer deletion. Linked-customer counts join through
 * `bank_account.bank_hash`.
 *
 * Same SQL placeholder convention as pan-records / aadhaar-records:
 * knex/pg `?` positional bindings.
 */
export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const q = (req.query.q as string | undefined)?.trim() || ""
  const orphansOnly =
    String(req.query.orphans ?? "") === "1" ||
    String(req.query.orphans ?? "") === "true"
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

  if (q || orphansOnly) {
    const where: string[] = ["1=1"]
    const whereBindings: any[] = []
    if (q) {
      const like = `%${q}%`
      whereBindings.push(like, like, like, like, like, like)
      where.push(
        `(bank_name ILIKE ? OR branch ILIKE ? OR city ILIKE ? OR ifsc ILIKE ? OR name_at_bank ILIKE ? OR account_number_masked ILIKE ?)`,
      )
    }
    if (orphansOnly) {
      where.push(`NOT EXISTS (
        SELECT 1 FROM bank_account ba
        WHERE ba.bank_hash = bank_record.bank_hash
          AND ba.deleted_at IS NULL
      )`)
    }
    const whereClause = where.join(" AND ")

    const rowsQ = await pg.raw(
      `
      SELECT bank_record.*
      FROM bank_record
      WHERE ${whereClause}
      ORDER BY last_refreshed_at DESC NULLS LAST
      LIMIT ? OFFSET ?
      `,
      [...whereBindings, limit, offset],
    )
    const countQ = await pg.raw(
      `
      SELECT COUNT(*)::int AS c
      FROM bank_record
      WHERE ${whereClause}
      `,
      whereBindings,
    )
    const rows = rowsQ.rows ?? rowsQ
    const count = (countQ.rows?.[0]?.c ?? countQ[0]?.c) ?? 0
    const items = await attachLinkedCounts(pg, rows)
    return res.json({ count, limit, offset, items })
  }

  const [rows, count] = await walletModule.listAndCountBankRecords(
    {},
    { take: limit, skip: offset, order: { last_refreshed_at: "DESC" } as any },
  )
  const items = await attachLinkedCounts(pg, rows as any[])
  res.json({ count, limit, offset, items })
}

/** Counts linked customers per bank_hash in one round-trip. */
async function attachLinkedCounts(pg: any, rows: any[]): Promise<any[]> {
  if (!rows.length) return []
  const hashes = rows.map((r) => r.bank_hash)
  const q = await pg.raw(
    `
    SELECT bank_hash, COUNT(DISTINCT customer_id)::int AS n
    FROM bank_account
    WHERE bank_hash = ANY(?::text[])
      AND deleted_at IS NULL
    GROUP BY bank_hash
    `,
    [hashes],
  )
  const counts = new Map<string, number>()
  for (const r of q.rows ?? q) counts.set(r.bank_hash, Number(r.n))
  return rows.map((r) => {
    // Strip verbose response_raw + ifsc_details from list payload —
    // the detail endpoint returns them in full.
    const {
      response_raw: _omit1,
      ifsc_details: _omit2,
      ...rest
    } = r
    return {
      ...rest,
      linked_customer_count: counts.get(r.bank_hash) ?? 0,
    }
  })
}
