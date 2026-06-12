import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { Modules } from "@medusajs/framework/utils"
import {
  CASHFREE_WALLET_MODULE,
  CashfreeWalletService,
} from "../../../modules/cashfree_wallet"
import { logger } from "../../../utils/logger"

/**
 * GET /admin/kyc-overview
 *
 * Single-call dashboard payload for the admin KYC inbox at
 * /app/kyc. Aggregates:
 *   - counts of pending / approved / rejected manual KYC requests
 *   - the actual pending manual requests (top N), each enriched
 *     with the customer's email + name for one-click resolution
 *   - counts of customers in each KYC state
 *   - list of customers with PARTIAL kyc (`pan_verified` or
 *     `aadhaar_verified` true but `overall != approved`) — the
 *     "stuck halfway" inbox
 *
 * Filters:
 *   ?status=pending|approved|rejected   (manual_requests filter)
 *   ?limit=20  (default 50, max 200)
 *
 * The stuck-halfway list reads aggregate state via the existing
 * `kyc_status` derivation per customer — already O(N) but bounded
 * by `limit`.
 */
export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const q = req.query as { status?: string; limit?: string }
  const status = q.status === "approved" || q.status === "rejected" ? q.status : "pending"
  const limit = Math.max(1, Math.min(200, Number(q.limit ?? 50)))

  const walletModule = req.scope.resolve(
    CASHFREE_WALLET_MODULE,
  ) as CashfreeWalletService
  const customerModule = req.scope.resolve(Modules.CUSTOMER) as any

  try {
    // ── Manual KYC requests (the inbox) ──────────────────────────
    const allRequests = await walletModule.listManualKycRequests({}, {
      take: 1000,
    })
    const requestCounts = {
      pending: allRequests.filter((r: any) => r.status === "pending").length,
      approved: allRequests.filter((r: any) => r.status === "approved").length,
      rejected: allRequests.filter((r: any) => r.status === "rejected").length,
      total: allRequests.length,
    }
    const filteredRequests = allRequests
      .filter((r: any) => r.status === status)
      .sort((a: any, b: any) =>
        String(b.created_at ?? "").localeCompare(String(a.created_at ?? "")),
      )
      .slice(0, limit)

    // Hydrate with customer email + name. Single batch — fetch all
    // unique customer ids in parallel.
    const customerIds = Array.from(
      new Set(filteredRequests.map((r: any) => r.customer_id)),
    ).filter(Boolean) as string[]
    const customers = await Promise.all(
      customerIds.map((id) =>
        customerModule.retrieveCustomer(id).catch(() => null),
      ),
    )
    const customerById = new Map<string, any>()
    for (const c of customers) if (c) customerById.set(c.id, c)

    const enrichedRequests = filteredRequests.map((r: any) => {
      const c = customerById.get(r.customer_id)
      return {
        id: r.id,
        customer_id: r.customer_id,
        email: c?.email ?? null,
        first_name: c?.first_name ?? null,
        last_name: c?.last_name ?? null,
        status: r.status,
        customer_note: r.customer_note ?? null,
        admin_note: r.admin_note ?? null,
        missing_documents: r.missing_documents ?? null,
        created_at: r.created_at,
      }
    })

    // ── Stuck-halfway inbox ──────────────────────────────────────
    //
    // Customers who started KYC but haven't finished. We query
    // secure_id_verification + bank_account + demat_account directly
    // through the existing service helpers and group by customer.
    // Bounded by `limit * 4` candidates (we re-rank afterward).
    const recentVerifs = await walletModule.listSecureIdVerifications(
      {},
      { take: Math.min(2000, limit * 20), order: { created_at: "DESC" } as any },
    )
    const partialCustomerIds = Array.from(
      new Set(recentVerifs.map((v: any) => v.customer_id).filter(Boolean)),
    ).slice(0, limit * 4) as string[]

    const partialDetails = await Promise.all(
      partialCustomerIds.map(async (id) => {
        try {
          const kyc = await walletModule.getKycStatus(id)
          if (kyc.overall === "approved") return null
          const c = await customerModule
            .retrieveCustomer(id)
            .catch(() => null)
          return {
            customer_id: id,
            email: c?.email ?? null,
            first_name: c?.first_name ?? null,
            last_name: c?.last_name ?? null,
            overall: kyc.overall,
            pan_verified: kyc.pan_verified,
            aadhaar_verified: kyc.aadhaar_verified,
            has_verified_bank: kyc.has_verified_bank,
            has_primary_demat: kyc.has_primary_demat,
            last_failure_reason: kyc.last_failure_reason ?? null,
          }
        } catch {
          return null
        }
      }),
    )
    const partial = partialDetails
      .filter(
        (
          p,
        ): p is NonNullable<(typeof partialDetails)[number]> => p !== null,
      )
      // Most-progressed first (more checkmarks → higher in inbox).
      .sort((a, b) => {
        const score = (p: typeof a) =>
          (p.pan_verified ? 1 : 0) +
          (p.aadhaar_verified ? 1 : 0) +
          (p.has_verified_bank ? 1 : 0) +
          (p.has_primary_demat ? 1 : 0)
        return score(b) - score(a)
      })
      .slice(0, limit)

    res.json({
      manual_requests: {
        counts: requestCounts,
        items: enrichedRequests,
        filter: { status, limit },
      },
      partial_kyc: {
        items: partial,
        total_in_window: partial.length,
      },
    })
  } catch (err: any) {
    logger.error("kyc-overview GET failed", { error: err?.message })
    res.status(500).json({ message: err?.message ?? "load_failed" })
  }
}
