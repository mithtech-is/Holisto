/**
 * Shared DTOs for the cashfree_wallet module. Kept tiny and framework-agnostic
 * so API routes, the payment provider, subscribers, and tests all speak the
 * same shape.
 */

export type WalletSummary = {
  customer_id: string
  balance_inr: number
  /** Non-withdrawable bucket. Funded by referrals + points conversion;
   *  spendable on orders subject to the admin-configured per-tx cap.
   *  Refunds for promo-paid splits route back here, never to bank. */
  promo_balance_inr: number
  status: "active" | "frozen"
  virtual_account?: {
    virtual_account_number: string
    ifsc: string
    upi_id?: string | null
    beneficiary_name?: string | null
  } | null
}

export type WalletLedgerRow = {
  id: string
  direction: "credit" | "debit"
  amount_inr: number
  balance_after: number
  kind: string
  /** Which sub-balance the row mutated. "main" or "promo". Always
   *  populated on rows written after promo-balance shipped; older
   *  rows surface as "main" via the column default. */
  bucket: "main" | "promo"
  reference_type: string | null
  reference_id: string | null
  note: string | null
  created_at: string
}

export type DebitResult =
  | { ok: true; balance_after: number; transaction_id: string }
  | { ok: false; reason: "insufficient_funds"; shortfall: number; balance: number }
  | { ok: false; reason: "wallet_frozen" }

/**
 * Result of a split-bucket order debit. Promo balance drains first
 * (capped by `max(promo_max_pct_of_subtotal × cart_subtotal, promo_max_flat_inr)`)
 * then main balance covers the rest. On insufficient combined funds,
 * the whole operation is a no-op (NEITHER bucket is touched) and the
 * caller decides whether to create a HeldOrder.
 *
 * On `ok: true`, exactly one of (`promo_amount_inr`, `main_amount_inr`)
 * may be zero — the customer might have no promo balance, or the cap
 * might be zero, in which case the entire debit hits main. Both
 * transaction ids are returned (or null) so the caller can wire
 * reversals.
 */
export type DebitSplitResult =
  | {
      ok: true
      promo_amount_inr: number
      main_amount_inr: number
      promo_balance_after: number
      main_balance_after: number
      promo_transaction_id: string | null
      main_transaction_id: string | null
    }
  | {
      ok: false
      reason: "insufficient_funds"
      shortfall: number
      balance: number /** = main + promo combined */
      promo_balance: number
      main_balance: number
    }
  | { ok: false; reason: "wallet_frozen" }

// KYC types — used by both storefront and medusa-backend admin UI.
// Phase 2 of the architecture refactor briefly hosted these in
// @polemarch/types, but the package extraction was rolled back because
// the file: deps + Docker + Turbopack combination kept failing the
// production build. Same shape lives at apps/storefront/src/app/
// dashboard/kyc/page.tsx — keep both in sync until we have a build
// step for the @polemarch/* packages that survives Docker layer
// isolation.
//
// `SecureIdKindGroup` (from when only the Cashfree SecureID provider
// implemented the four KYC kinds) is kept as a type alias of the
// canonical `KycKind` for back-compat with older callers within this
// module.
export type KycKind = "pan" | "aadhaar" | "bank" | "cmr"

export type SecureIdKindGroup = KycKind

export type KycChecklistItem = {
  key: KycKind
  label: string
  status: "done" | "pending" | "disabled"
}

export type KycStatus = {
  overall: "not_started" | "in_progress" | "approved" | "rejected"
  pan_verified: boolean
  aadhaar_verified: boolean
  has_verified_bank: boolean
  has_primary_demat: boolean
  /** True when an open `manual_kyc_request` row (status = "pending")
   *  exists for this customer. Server-derived so the "Under review"
   *  state survives page reloads. */
  identity_under_review: boolean
  last_failure_reason?: string | null
  /** Per-kind enable flags mirrored from the admin-controlled
   *  cashfree_setting row. When false, the storefront hides that step
   *  and the corresponding /store/kyc/* route rejects with 403. */
  enabled_kinds: Record<KycKind, boolean>
  /** Server-derived UI checklist. Each item is either "done" (the
   *  customer has completed it), "pending" (still required), or
   *  "disabled" (admin turned the kind off — the customer is neither
   *  blocked nor prompted). */
  checklist: KycChecklistItem[]
}

export type SecureIdKind =
  | "pan"
  | "aadhaar_otp_send"
  | "aadhaar_otp_verify"
  | "bank_penny"
  | "cmr"
