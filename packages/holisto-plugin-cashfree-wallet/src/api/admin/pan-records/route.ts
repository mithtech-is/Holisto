import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { z } from "zod"
import { createHash } from "node:crypto"
import {
  CASHFREE_WALLET_MODULE,
  CashfreeWalletService,
} from "../../../modules/cashfree_wallet"
import { maskPan } from "../../../modules/cashfree_wallet/cashfree/crypto"
import { logger } from "../../../utils/logger"

/**
 * GET /admin/pan-records
 *   ?q=                      — case-insensitive partial match on registered_name, name_pan_card, masked_pan
 *   &aadhaar_linked=true|false
 *   &pan_status=VALID|INVALID|...
 *   &orphans=1               — only rows with zero linked customers (no customer.metadata.pan_hash points to them)
 *   &limit=50&offset=0
 *
 * Global PAN registry — every PAN we've ever cached from Cashfree, regardless of
 * whether a customer is currently linked. Linked-customer counts join through
 * the customer table's JSONB metadata.
 *
 * The list endpoint omits `response_raw` for payload size; the detail endpoint
 * (/admin/pan-records/:hash) returns it.
 *
 * SQL placeholder convention: Medusa's `pg` connection is knex-backed, which
 * uses `?` for positional bindings (NOT pg-native `$N`). Each `?` consumes the
 * next binding from the array; reuse of the same value requires pushing it
 * multiple times. Avoid the `?` JSONB-existence operator in raw SQL — knex
 * grabs every `?` it sees, including operator ones, and the count mismatches.
 * Use `metadata->>'pan_hash' = X` form instead.
 */
export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const q = (req.query.q as string | undefined)?.trim() || ""
  const aadhaarLinked = req.query.aadhaar_linked as string | undefined
  const panStatus = req.query.pan_status as string | undefined
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

  const filters: Record<string, unknown> = {}
  if (panStatus) filters.pan_status = panStatus
  if (aadhaarLinked === "true") filters.aadhaar_linked = true
  else if (aadhaarLinked === "false") filters.aadhaar_linked = false

  // Free-text search — Medusa's listAndCount doesn't natively support
  // multi-field ILIKE OR. Drop down to raw SQL for the search/orphan
  // paths; use the auto-generated method for the simple case.
  if (q || orphansOnly) {
    // Build the WHERE clause first; collect bindings in declaration order.
    const where: string[] = ["1=1"]
    const whereBindings: any[] = []

    if (q) {
      const like = `%${q}%`
      const likeUpper = `%${q.toUpperCase()}%`
      // 4 reuses of `like` for the lowercase-name fields, 1 of `likeUpper`
      // for the masked PAN. Each `?` consumes one binding, so push 5.
      whereBindings.push(like, like, like, like, likeUpper)
      where.push(`(
        registered_name ILIKE ?
        OR COALESCE(name_pan_card, '') ILIKE ?
        OR COALESCE(first_name, '') ILIKE ?
        OR COALESCE(last_name, '') ILIKE ?
        OR pan_masked ILIKE ?
      )`)
    }
    if (panStatus) {
      whereBindings.push(panStatus)
      where.push(`pan_status = ?`)
    }
    if (aadhaarLinked === "true") where.push(`aadhaar_linked IS TRUE`)
    if (aadhaarLinked === "false") where.push(`aadhaar_linked IS FALSE`)

    if (orphansOnly) {
      where.push(`NOT EXISTS (
        SELECT 1 FROM customer c
        WHERE c.metadata->>'pan_hash' = pan_record.pan_hash
      )`)
    }

    const whereClause = where.join(" AND ")

    const rowsQ = await pg.raw(
      `
      SELECT pan_record.*
      FROM pan_record
      WHERE ${whereClause}
      ORDER BY last_refreshed_at DESC NULLS LAST
      LIMIT ? OFFSET ?
      `,
      [...whereBindings, limit, offset],
    )
    const countQ = await pg.raw(
      `
      SELECT COUNT(*)::int AS c
      FROM pan_record
      WHERE ${whereClause}
      `,
      whereBindings,
    )
    const rows = rowsQ.rows ?? rowsQ
    const count = (countQ.rows?.[0]?.c ?? countQ[0]?.c) ?? 0

    const items = await attachLinkedCounts(pg, rows)
    return res.json({ count, limit, offset, items })
  }

  const [rows, count] = await walletModule.listAndCountPanRecords(filters, {
    take: limit,
    skip: offset,
    order: { last_refreshed_at: "DESC" } as any,
  })
  const items = await attachLinkedCounts(pg, rows as any[])
  res.json({ count, limit, offset, items })
}

/**
 * One round-trip to the customer table to count how many customers
 * have `metadata.pan_hash` pointing to each PAN in the page. Avoids
 * an N+1 — single IN query for the whole page.
 */
async function attachLinkedCounts(pg: any, rows: any[]): Promise<any[]> {
  if (!rows.length) return []
  const hashes = rows.map((r) => r.pan_hash)
  const q = await pg.raw(
    `
    SELECT metadata->>'pan_hash' AS pan_hash, COUNT(*)::int AS n
    FROM customer
    WHERE metadata->>'pan_hash' = ANY(?::text[])
    GROUP BY 1
    `,
    [hashes],
  )
  const counts = new Map<string, number>()
  for (const r of q.rows ?? q) counts.set(r.pan_hash, Number(r.n))
  return rows.map((r) => {
    // Strip the verbose response_raw blob from list payload, but
    // pull out the unmasked PAN string before doing so — admins want
    // the full PAN visible in the registry table per compliance /
    // share-transfer ops requirements.
    const raw = (r as any).response_raw as Record<string, any> | null
    const { response_raw: _omit, ...rest } = r
    return {
      ...rest,
      pan_full: raw?.pan ?? null,
      linked_customer_count: counts.get(r.pan_hash) ?? 0,
    }
  })
}

/**
 * POST /admin/pan-records
 *
 * Manual PAN registry input — admin types data from an uploaded PAN
 * card (or any offline source) and we hash + upsert into the global
 * `pan_record` table. Idempotent on `pan_hash`: posting the same PAN
 * twice refreshes `last_refreshed_at` but doesn't blow away existing
 * fields when the new payload omits them.
 *
 * Mapping to a customer is a separate step — see
 *   POST /admin/customers/:customer_id/kyc/manual
 * which now accepts a `pan_full` field that does the create + link in
 * one shot, including the metadata anchor write + email + audit row.
 *
 * Body:
 *   {
 *     pan: "ABCDE1234F",
 *     registered_name: "MANOJ MITHAJAL BHAT",
 *     date_of_birth?: "1993-11-03",
 *     father_name?: "...",
 *     name_pan_card?: "...",       // exact name as printed (if different)
 *     pan_status?: "VALID" | ...,
 *     address?: { line1, line2, city, state, pincode, country }
 *   }
 */
const PostBodySchema = z.object({
  pan: z
    .string()
    .trim()
    .transform((s) => s.toUpperCase())
    .refine((s) => /^[A-Z]{5}[0-9]{4}[A-Z]$/.test(s), "Invalid PAN format"),
  registered_name: z.string().trim().min(2).max(200),
  date_of_birth: z.string().trim().optional().nullable(),
  father_name: z.string().trim().max(200).optional().nullable(),
  name_pan_card: z.string().trim().max(200).optional().nullable(),
  pan_status: z.string().trim().max(40).optional().nullable(),
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
    pan,
    registered_name,
    date_of_birth,
    father_name,
    name_pan_card,
    pan_status,
    address,
    reason,
  } = parsed.data

  const adminUserId =
    (req as any).auth_context?.actor_id ??
    (req as any).auth_context?.app_metadata?.user_id ??
    "unknown"

  const pan_hash = createHash("sha256").update(pan).digest("hex")
  const walletModule = req.scope.resolve(
    CASHFREE_WALLET_MODULE,
  ) as CashfreeWalletService

  try {
    // Pull existing-state preview so the response surfaces "created vs
    // refreshed" without a second round-trip.
    const before = await walletModule.lookupPanRecordByHash(pan_hash)
    const record = await walletModule.upsertPanRecord({
      pan_hash,
      pan_masked: maskPan(pan),
      pan_full: pan,
      registered_name,
      name_pan_card: name_pan_card ?? null,
      father_name: father_name ?? null,
      date_of_birth: date_of_birth ?? null,
      pan_status: pan_status ?? null,
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
      pan_record: record,
    })
  } catch (err: any) {
    logger.error("admin pan-records POST failed", {
      error: err?.message,
    })
    res.status(500).json({ message: err?.message ?? "create_failed" })
  }
}
