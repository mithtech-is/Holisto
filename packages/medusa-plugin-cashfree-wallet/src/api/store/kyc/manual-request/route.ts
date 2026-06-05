import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { z } from "zod"
import { Modules } from "@medusajs/framework/utils"
import {
  CASHFREE_WALLET_MODULE,
  CashfreeWalletService,
} from "../../../../modules/cashfree_wallet"
import { sendEventEmail } from "../../../../lib/send-event-email"

const BodySchema = z.object({
  customer_note: z.string().trim().max(1000).optional().nullable(),
})

/**
 * Required documents for a manual KYC review. Ops needs the full packet
 * before they'll override the automated Secure ID flow, so the storefront
 * gate won't accept a manual request until every slot below is filled.
 *
 *  - PAN card:     `customer.metadata.kyc_pan_file_url`
 *  - Aadhaar card: `customer.metadata.kyc_aadhaar_card_file_url`
 *  - Bank proof:   at least one `bank_account` with `bank_proof_file_url`
 *  - CMR:          at least one `demat_account` with `cmr_file_url`
 *  - Selfie (opt): `customer.metadata.kyc_selfie_file_url` — required only
 *                   when the `KYC_REQUIRE_SELFIE` env flag is truthy.
 *
 * The gate is applied on POST. GET also returns `missing_documents` so
 * the storefront can render a live checklist before the user clicks
 * submit.
 */
type DocSlot = "pan" | "aadhaar" | "bank_proof" | "cmr" | "selfie"

function selfieRequired(): boolean {
  const v = process.env.KYC_REQUIRE_SELFIE
  return v === "1" || v === "true"
}

async function computeMissingDocuments(
  req: MedusaRequest,
  customerId: string,
): Promise<DocSlot[]> {
  const walletModule = req.scope.resolve(
    CASHFREE_WALLET_MODULE
  ) as CashfreeWalletService
  const customerModule = req.scope.resolve(Modules.CUSTOMER) as any

  const [customer, banks, demats] = await Promise.all([
    customerModule.retrieveCustomer(customerId).catch(() => null),
    walletModule.listBankAccounts({ customer_id: customerId }).catch(() => []),
    walletModule.listDematAccounts({ customer_id: customerId }).catch(() => []),
  ])

  const md = (customer?.metadata ?? {}) as Record<string, unknown>
  const truthy = (v: unknown) =>
    typeof v === "string" && v.trim().length > 0

  const missing: DocSlot[] = []
  if (!truthy(md.kyc_pan_file_url)) missing.push("pan")
  if (!truthy(md.kyc_aadhaar_card_file_url)) missing.push("aadhaar")
  if (!banks.some((b: any) => truthy(b.bank_proof_file_url))) {
    missing.push("bank_proof")
  }
  if (!demats.some((d: any) => truthy(d.cmr_file_url))) missing.push("cmr")
  if (selfieRequired() && !truthy(md.kyc_selfie_file_url)) {
    missing.push("selfie")
  }
  return missing
}

/**
 * POST /store/kyc/manual-request
 *
 * Customer asks ops to review their uploaded documents and approve KYC
 * manually (used when Cashfree Secure ID fails or isn't available).
 *
 * No documents are uploaded here — the customer uploads them on the
 * /dashboard/documents page first; this route just puts a pending entry
 * in the ops queue.
 *
 * If there's already an open pending request, we return that one
 * (idempotent — no duplicate inbox rows).
 */
export const POST = async (req: MedusaRequest, res: MedusaResponse) => {
  const customerId = (req as any).auth_context?.app_metadata?.customer_id as
    | string
    | undefined
  if (!customerId) return res.status(401).json({ message: "Not authenticated" })

  const parsed = BodySchema.safeParse(req.body ?? {})
  if (!parsed.success) {
    return res
      .status(400)
      .json({ message: "Invalid input", errors: parsed.error.flatten() })
  }
  const walletModule = req.scope.resolve(
    CASHFREE_WALLET_MODULE
  ) as CashfreeWalletService

  const [existing] = await walletModule.listManualKycRequests(
    { customer_id: customerId, status: "pending" },
    { take: 1 }
  )
  if (existing) {
    // Existing pending requests predate the document gate; we don't
    // retroactively block them. Return as-is so the storefront can
    // render the "Submitted · awaiting review" state.
    return res.json({
      request: {
        id: existing.id,
        status: existing.status,
        created_at: existing.created_at,
      },
      note: "You already have a pending request — ops will review it soon.",
    })
  }

  // Gate: ops can only review a request if every required document is
  // uploaded. Without this, customers slip through with a half-empty
  // manual queue and ops either bounce it back or spend time chasing
  // missing uploads. Fail closed with a machine-readable list the
  // storefront can render as a checklist.
  const missing = await computeMissingDocuments(req, customerId)
  if (missing.length > 0) {
    return res.status(400).json({
      message:
        "Upload the missing documents before requesting a manual review.",
      missing_documents: missing,
    })
  }

  const created = await walletModule.createManualKycRequests({
    customer_id: customerId,
    customer_note: parsed.data.customer_note ?? null,
    status: "pending",
  })

  await sendEventEmail(req.scope, "admin.new_manual_kyc_request", {
    customer_id: customerId,
    customer_note: parsed.data.customer_note ?? "",
    admin_review_url: `${process.env.MEDUSA_ADMIN_URL || ""}/app/manual-kyc`,
  })

  res.status(201).json({
    request: {
      id: created.id,
      status: created.status,
      created_at: created.created_at,
    },
  })
}

/**
 * GET /store/kyc/manual-request
 *
 * Returns the customer's most recent manual KYC request (for showing
 * "Submitted • awaiting review" state on the storefront).
 */
export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const customerId = (req as any).auth_context?.app_metadata?.customer_id as
    | string
    | undefined
  if (!customerId) return res.status(401).json({ message: "Not authenticated" })
  const walletModule = req.scope.resolve(
    CASHFREE_WALLET_MODULE
  ) as CashfreeWalletService
  const [latest] = await walletModule.listManualKycRequests(
    { customer_id: customerId },
    { take: 1, order: { created_at: "DESC" } as any }
  )
  const missing = await computeMissingDocuments(req, customerId)
  res.json({
    request: latest
      ? {
          id: latest.id,
          status: latest.status,
          customer_note: latest.customer_note,
          reviewer_notes: latest.reviewer_notes,
          reviewed_at: latest.reviewed_at,
          created_at: latest.created_at,
        }
      : null,
    // Same list the POST handler uses as the gate. Renders as a
    // checklist on the storefront so customers know exactly which
    // uploads are still needed before they can submit.
    missing_documents: missing,
    selfie_required: selfieRequired(),
  })
}
