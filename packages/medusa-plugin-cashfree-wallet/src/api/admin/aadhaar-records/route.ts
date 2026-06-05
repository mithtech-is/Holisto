import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { z } from "zod"
import { createHash } from "node:crypto"
import {
  CASHFREE_WALLET_MODULE,
  CashfreeWalletService,
} from "../../../modules/cashfree_wallet"
import { maskAadhaar } from "../../../modules/cashfree_wallet/cashfree/crypto"
import { logger } from "../../../utils/logger"

/**
 * GET /admin/aadhaar-records
 *   ?q=                      — case-insensitive partial match on name + masked aadhaar
 *   &orphans=1               — only rows with zero linked customers
 *   &limit=50&offset=0
 *
 * Global Aadhaar registry — every Aadhaar we've ever cached from
 * Cashfree's offline-Aadhaar OTP-verify endpoint, regardless of
 * whether a customer is currently linked. Linked-customer counts
 * join through customer table's JSONB metadata (`aadhaar_hash`).
 *
 * UIDAI compliance: the raw 12-digit Aadhaar number is NOT stored
 * anywhere — only the SHA-256 hash + last-4 masked form. Cashfree
 * echoes only the masked form in its response, so even
 * `response_raw` doesn't leak it.
 *
 * Same SQL placeholder convention as pan-records: knex/pg uses `?`
 * positional bindings, NOT `$N`.
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
      whereBindings.push(like, like)
      where.push(`(name ILIKE ? OR aadhaar_masked ILIKE ?)`)
    }
    if (orphansOnly) {
      where.push(`NOT EXISTS (
        SELECT 1 FROM customer c
        WHERE c.metadata->>'aadhaar_hash' = aadhaar_record.aadhaar_hash
      )`)
    }
    const whereClause = where.join(" AND ")

    const rowsQ = await pg.raw(
      `
      SELECT aadhaar_record.*
      FROM aadhaar_record
      WHERE ${whereClause}
      ORDER BY last_refreshed_at DESC NULLS LAST
      LIMIT ? OFFSET ?
      `,
      [...whereBindings, limit, offset],
    )
    const countQ = await pg.raw(
      `
      SELECT COUNT(*)::int AS c
      FROM aadhaar_record
      WHERE ${whereClause}
      `,
      whereBindings,
    )
    const rows = rowsQ.rows ?? rowsQ
    const count = (countQ.rows?.[0]?.c ?? countQ[0]?.c) ?? 0
    const items = await attachLinkedCounts(pg, rows)
    return res.json({ count, limit, offset, items })
  }

  const [rows, count] = await walletModule.listAndCountAadhaarRecords(
    {},
    { take: limit, skip: offset, order: { last_refreshed_at: "DESC" } as any },
  )
  const items = await attachLinkedCounts(pg, rows as any[])
  res.json({ count, limit, offset, items })
}

/**
 * One round-trip to count customers linked to each Aadhaar in the
 * page. Avoids N+1.
 */
async function attachLinkedCounts(pg: any, rows: any[]): Promise<any[]> {
  if (!rows.length) return []
  const hashes = rows.map((r) => r.aadhaar_hash)
  const q = await pg.raw(
    `
    SELECT metadata->>'aadhaar_hash' AS aadhaar_hash, COUNT(*)::int AS n
    FROM customer
    WHERE metadata->>'aadhaar_hash' = ANY(?::text[])
    GROUP BY 1
    `,
    [hashes],
  )
  const counts = new Map<string, number>()
  for (const r of q.rows ?? q) counts.set(r.aadhaar_hash, Number(r.n))
  return rows.map((r) => {
    // Strip verbose response_raw from list payload. Keep
    // `aadhaar_full` as-is — the admin UI's RevealableValue
    // controls when it's actually shown to the operator
    // (default-masked, toggle to reveal).
    const { response_raw: _omit, ...rest } = r
    return {
      ...rest,
      linked_customer_count: counts.get(r.aadhaar_hash) ?? 0,
    }
  })
}

/**
 * POST /admin/aadhaar-records
 *
 * Manual Aadhaar registry input — admin types data from an uploaded
 * Aadhaar card and we hash + upsert into the global `aadhaar_record`
 * table. Idempotent on `aadhaar_hash`. Mapping to a customer is a
 * separate step via POST /admin/customers/:customer_id/kyc/manual
 * (extended to accept `aadhaar_full`).
 *
 * Body:
 *   {
 *     aadhaar: "123412341234",      // 12 digits, no spaces
 *     name: "MANOJ MITHAJAL BHAT",
 *     date_of_birth?: "1993-11-03",
 *     gender?: "M" | "F" | "T",
 *     father_name?: "...",
 *     address?: { ... }
 *   }
 */
const PostBodySchema = z.object({
  aadhaar: z
    .string()
    .trim()
    .transform((s) => s.replace(/\s+/g, ""))
    .refine((s) => /^\d{12}$/.test(s), "Aadhaar must be 12 digits"),
  name: z.string().trim().min(2).max(200),
  date_of_birth: z.string().trim().optional().nullable(),
  gender: z.string().trim().max(20).optional().nullable(),
  father_name: z.string().trim().max(200).optional().nullable(),
  address: z.record(z.string(), z.unknown()).optional().nullable(),
  reason: z.string().trim().min(4).max(500).optional(),
})

export const POST = async (req: MedusaRequest, res: MedusaResponse) => {
  const parsed = PostBodySchema.safeParse(req.body)
  if (!parsed.success) {
    return res
      .status(400)
      .json({ message: "Invalid input", errors: parsed.error.flatten() })
  }
  const {
    aadhaar,
    name,
    date_of_birth,
    gender,
    father_name,
    address,
    reason,
  } = parsed.data

  const adminUserId =
    (req as any).auth_context?.actor_id ??
    (req as any).auth_context?.app_metadata?.user_id ??
    "unknown"

  const aadhaar_hash = createHash("sha256").update(aadhaar).digest("hex")
  const walletModule = req.scope.resolve(
    CASHFREE_WALLET_MODULE,
  ) as CashfreeWalletService

  try {
    const before = await walletModule.lookupAadhaarRecordByHash(aadhaar_hash)
    const record = await walletModule.upsertAadhaarRecord({
      aadhaar_hash,
      aadhaar_masked: maskAadhaar(aadhaar),
      aadhaar_full: aadhaar,
      name,
      date_of_birth: date_of_birth ?? null,
      gender: gender ?? null,
      father_name: father_name ?? null,
      address: (address as Record<string, unknown> | null) ?? null,
      response_raw: {
        manual_input: true,
        admin_user_id: adminUserId,
        ...(reason ? { reason } : {}),
        ...(before?.response_raw && typeof before.response_raw === "object"
          ? (before.response_raw as Record<string, unknown>)
          : {}),
      },
    })

    res.json({
      ok: true,
      created: !before,
      aadhaar_record: record,
    })
  } catch (err: any) {
    logger.error("admin aadhaar-records POST failed", {
      error: err?.message,
    })
    res.status(500).json({ message: err?.message ?? "create_failed" })
  }
}
