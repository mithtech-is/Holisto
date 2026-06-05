import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { Modules } from "@medusajs/framework/utils"
import {
  CASHFREE_WALLET_MODULE,
  CashfreeWalletService,
} from "../../../modules/cashfree_wallet"

/**
 * GET /admin/manual-kyc-requests?status=&limit=&offset=
 *
 * Each row carries a `pending_steps` array listing every KYC step
 * still outstanding for that customer (PAN / Aadhaar / Bank / Demat).
 * Empty when the customer has all four green — typical for an
 * approved or cancelled row that's only on the list because of the
 * status filter. Computed against the customer's CURRENT state, not
 * the state at request creation, so the queue reflects what an
 * admin would have to act on right now.
 */
type PendingStep = "PAN" | "Aadhaar" | "Bank" | "Demat / CMR"

export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const status =
    (req.query.status as string | undefined) === undefined
      ? "pending"
      : (req.query.status as string)
  const limit = Math.min(
    Math.max(Number.parseInt(String(req.query.limit ?? "50"), 10) || 50, 1),
    200
  )
  const offset = Math.max(
    Number.parseInt(String(req.query.offset ?? "0"), 10) || 0,
    0
  )
  const walletModule = req.scope.resolve(
    CASHFREE_WALLET_MODULE
  ) as CashfreeWalletService
  const customerModule = req.scope.resolve(Modules.CUSTOMER) as any

  const [rows, count] = await walletModule.listAndCountManualKycRequests(
    status === "all" ? {} : { status: status as any },
    { take: limit, skip: offset, order: { created_at: "DESC" } as any }
  )

  // Hydrate pending_steps + pending_kinds in one batched pass per customer.
  //
  //   pending_steps  — what the customer hasn't COMPLETED (used by the
  //                    review-queue cards to show outstanding work).
  //                    A fresh customer with no KYC at all has all four
  //                    here; useful for "what's left", not for "what
  //                    needs admin attention".
  //
  //   pending_kinds  — kinds that have at least one pending
  //                    secure_id_verifications audit row for the
  //                    customer. This is the SPECIFIC set of identity
  //                    verifications that landed in the partial-match
  //                    band and need a human to review. PAN / Aadhaar
  //                    tabs on /app/manual-kyc filter by this — a
  //                    customer who hasn't even attempted PAN doesn't
  //                    belong in the "PAN review" queue; one who's
  //                    sitting in the 0.60–0.80 score band does.
  const customerIds = Array.from(new Set(rows.map((r) => r.customer_id)))
  const stepsByCustomer = new Map<string, PendingStep[]>()
  const kindsByCustomer = new Map<string, Array<"pan" | "aadhaar">>()
  await Promise.all(
    customerIds.map(async (cid) => {
      const [steps, kinds] = await Promise.all([
        computePendingSteps(cid, customerModule, walletModule),
        computePendingAuditKinds(cid, walletModule),
      ])
      stepsByCustomer.set(cid, steps)
      kindsByCustomer.set(cid, kinds)
    }),
  )

  res.json({
    count,
    limit,
    offset,
    requests: rows.map((r) => ({
      id: r.id,
      customer_id: r.customer_id,
      status: r.status,
      customer_note: r.customer_note,
      reviewer_notes: r.reviewer_notes,
      reviewed_at: r.reviewed_at,
      created_at: r.created_at,
      pending_steps: stepsByCustomer.get(r.customer_id) ?? [],
      pending_kinds: kindsByCustomer.get(r.customer_id) ?? [],
    })),
  })
}

/**
 * Return the set of identity-verification kinds (`pan` and/or
 * `aadhaar`) that have at least one secure_id_verifications row with
 * status='pending' for the customer. Drives the PAN/Aadhaar review
 * tabs on /app/manual-kyc — a row only appears in the PAN tab if the
 * customer has an actual pending PAN audit attempt waiting on admin
 * review (typically a partial-match in the 0.60–0.80 band, or a
 * loose-pass via initial-expansion).
 *
 * Bank and demat are handled separately (their pending state lives on
 * bank_account / demat_account rows, not on secure_id_verifications)
 * so this helper only covers pan + aadhaar.
 */
async function computePendingAuditKinds(
  customerId: string,
  walletModule: CashfreeWalletService,
): Promise<Array<"pan" | "aadhaar">> {
  const kinds: Array<"pan" | "aadhaar"> = []
  try {
    const audits = (await walletModule.listSecureIdVerifications(
      { customer_id: customerId, status: "pending" } as any,
      { take: 50 } as any,
    )) as Array<{ kind?: string }>
    const seen = new Set<string>()
    for (const a of audits ?? []) {
      const k = String(a?.kind ?? "")
      if (k === "pan" && !seen.has("pan")) {
        kinds.push("pan")
        seen.add("pan")
      } else if (
        (k === "aadhaar_otp_send" || k === "aadhaar_otp_verify") &&
        !seen.has("aadhaar")
      ) {
        kinds.push("aadhaar")
        seen.add("aadhaar")
      }
    }
  } catch {
    /* non-fatal — empty list falls through */
  }
  return kinds
}

/**
 * Walk the canonical KYC signals and return an ordered list of
 * outstanding steps:
 *   PAN          — customer.metadata.pan_hash unset OR kyc_status not
 *                  beyond "pan_verified"
 *   Aadhaar      — metadata.aadhaar_hash unset OR kyc_status not
 *                  beyond "aadhaar_verified"
 *   Bank         — no bank_account row with verification_status='verified'
 *                  AND is_primary=true
 *   Demat / CMR  — no demat_account row with verification_status='verified'
 *                  AND is_primary=true
 *
 * Order matches the storefront flow (PAN → Aadhaar → Bank → Demat),
 * so the first entry is the first thing the customer is blocked on.
 *
 * If the customer no longer exists (hard-deleted out from under a
 * stale manual_kyc_request), returns an empty list.
 */
async function computePendingSteps(
  customerId: string,
  customerModule: any,
  walletModule: CashfreeWalletService,
): Promise<PendingStep[]> {
  const steps: PendingStep[] = []
  const customer = await customerModule
    .retrieveCustomer(customerId)
    .catch(() => null)
  if (!customer) return steps

  const meta = (customer.metadata ?? {}) as Record<string, unknown>
  const panHash =
    typeof meta.pan_hash === "string" ? (meta.pan_hash as string) : null
  const aadhaarHash =
    typeof meta.aadhaar_hash === "string"
      ? (meta.aadhaar_hash as string)
      : null

  if (!panHash) steps.push("PAN")
  if (!aadhaarHash) steps.push("Aadhaar")

  // Bank — at least one verified+primary row.
  const banks = (await walletModule
    .listBankAccounts({ customer_id: customerId } as any, { take: 50 } as any)
    .catch(() => [])) as any[]
  const bankOk = banks.some(
    (b) => b.verification_status === "verified" && b.is_primary,
  )
  if (!bankOk) steps.push("Bank")

  // Demat — at least one verified+primary row.
  const demats = (await walletModule
    .listDematAccounts({ customer_id: customerId } as any, { take: 50 } as any)
    .catch(() => [])) as any[]
  const dematOk = demats.some(
    (d) => d.verification_status === "verified" && d.is_primary,
  )
  if (!dematOk) steps.push("Demat / CMR")

  return steps
}
