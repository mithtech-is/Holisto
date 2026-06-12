import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { z } from "zod"
import {
  CASHFREE_WALLET_MODULE,
  CashfreeWalletService,
} from "../../../../../modules/cashfree_wallet"
import {
  hitRateLimit,
  SECURE_ID_LIMITS,
} from "../../../../../modules/cashfree_wallet/rate-limit"

const ReplaceCmrSchema = z.object({
  cmr_file_url: z
    .string()
    .trim()
    .refine(
      (s) => s.startsWith("/static/") || s.startsWith("http"),
      "CMR file URL must be uploaded first"
    ),
})

/**
 * PATCH /store/demat-accounts/:id/cmr
 *
 * Replace the CMR for an existing demat. Re-runs CMR verification against
 * Cashfree Secure ID using the stored DP / client id / BOID and the new
 * file URL. The demat's `verification_status` is updated based on the
 * verification outcome. If verification fails, the old CMR URL is
 * overwritten anyway (so the user can upload a better scan and retry),
 * but `is_primary` is NOT changed — an unverified primary would break
 * the KYC gate.
 */
export const PATCH = async (req: MedusaRequest, res: MedusaResponse) => {
  const customerId = (req as any).auth_context?.app_metadata?.customer_id as
    | string
    | undefined
  if (!customerId) return res.status(401).json({ message: "Not authenticated" })
  const { id } = req.params

  const parsed = ReplaceCmrSchema.safeParse(req.body)
  if (!parsed.success) {
    return res
      .status(400)
      .json({ message: "Invalid input", errors: parsed.error.flatten() })
  }

  const walletModule = req.scope.resolve(
    CASHFREE_WALLET_MODULE
  ) as CashfreeWalletService

  const demat = await walletModule
    .retrieveDematAccount(id as string)
    .catch(() => null)
  if (!demat || demat.customer_id !== customerId) {
    return res.status(404).json({ message: "Not found" })
  }

  // CMR verification is now MANUAL — Cashfree's CMR endpoint is no
  // longer in our verification suite. Replacing the CMR file just
  // updates the row + queues it for an admin look. The primary flag
  // is dropped (an unverified primary would break the KYC gate) and
  // status reverts to `pending`.

  const rl = hitRateLimit(
    `cmr:${customerId}`,
    SECURE_ID_LIMITS.cmr.limit,
    SECURE_ID_LIMITS.cmr.windowMs
  )
  if (!rl.allowed) {
    return res
      .status(429)
      .json({ message: "CMR upload limit reached. Try again later." })
  }

  const updated = await walletModule.updateDematAccounts({
    selector: { id: demat.id },
    data: {
      cmr_file_url: parsed.data.cmr_file_url,
      verification_status: "pending",
      name_match_score: null,
      verification_raw: {
        manual_review: true,
        replaced_at: new Date().toISOString(),
        prior_status: demat.verification_status,
      },
      verified_at: null,
      is_primary: false,
    },
  })

  await walletModule.createSecureIdVerifications({
    customer_id: customerId,
    kind: "cmr",
    reference_id: null,
    status: "pending",
    input_masked:
      demat.boid ?? `${demat.dp_id ?? ""}-${demat.client_id ?? ""}`,
    response_raw: { manual_review: true, replaced: true },
    expires_at: null,
    attempt_no: 1,
  })

  const row = Array.isArray(updated) ? updated[0] : updated
  res.json({
    demat_account: {
      id: row.id,
      depository: row.depository,
      dp_name: row.dp_name,
      account_holder_name: row.account_holder_name,
      cmr_file_url: row.cmr_file_url,
      name_match_score: row.name_match_score,
      verification_status: row.verification_status,
      is_primary: row.is_primary,
    },
    pending_review: true,
    message:
      "New CMR uploaded — queued for manual review. You'll get an email when it's approved.",
  })
}
