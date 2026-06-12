import { MedusaService, Modules } from "@medusajs/framework/utils"
import { Wallet } from "./models/wallet"
import { WalletTransaction } from "./models/wallet-transaction"
import { BankAccount } from "./models/bank-account"
import { DematAccount } from "./models/demat-account"
import { CashfreeVirtualAccount } from "./models/virtual-account"
import { SecureIdVerification } from "./models/secure-id-verification"
import { PaymentAttempt } from "./models/payment-attempt"
import { HeldOrder } from "./models/held-order"
import { WebhookEvent } from "./models/webhook-event"
import { CashfreeSetting } from "./models/cashfree-setting"
import { ManualKycRequest } from "./models/manual-kyc-request"
import { DepositProof } from "./models/deposit-proof"
import { CompanyRequest } from "./models/company-request"
import { ContactSubmission } from "./models/contact-submission"
import { NewsletterSubscription } from "./models/newsletter-subscription"
import { Referral } from "./models/referral"
import { AdminAuditLog } from "./models/admin-audit-log"
import { AccountRequest } from "./models/account-request"
import { PanRecord } from "./models/pan-record"
import { AadhaarRecord } from "./models/aadhaar-record"
import { BankRecord } from "./models/bank-record"
import { CmrRecord } from "./models/cmr-record"
import type {
  DebitResult,
  DebitSplitResult,
  KycStatus,
  KycChecklistItem,
  SecureIdKindGroup,
} from "./types"
import { randomUUID } from "crypto"
import {
  CashfreeClient,
  type CashfreeAudience,
  type CashfreeEnv,
} from "./cashfree/client"
import { encryptString, decryptString } from "./cashfree/crypto"
import {
  verifyPan,
  sendAadhaarOtp,
  verifyAadhaarOtp,
  pennyDropBank,
} from "./cashfree/secure-id"
import {
  createVirtualAccount,
  fetchVirtualAccount,
  listVirtualAccountTransactions,
  type CreateVbaArgs,
} from "./cashfree/virtual-accounts"
import {
  createVba,
  getVba,
  updateVba,
  listVbaPayments,
} from "./cashfree/auto-collect"

/** Supported Cashfree products. Each maps to its own credential set in
 *  the DB and (usually) its own webhook signing secret. */
export type CashfreeProduct =
  | "payment_gateway"
  | "payouts"
  | "subscriptions"
  | "cross_border"
  | "verification_suite"

/** Per-product settings shape sent by the admin UI. Empty strings mean
 *  "leave as-is"; null means "explicitly clear". */
export type CashfreeProductSettingsInput = {
  product: CashfreeProduct
  /** Which env the fields below apply to. Ignored for `verification_suite`
   *  (always production). If omitted, defaults to the product's current
   *  active env. */
  env?: CashfreeEnv
  /** Flip the active env pointer after saving creds. For `verification_suite`
   *  this is always "production". */
  active_env?: CashfreeEnv
  enabled?: boolean
  client_id?: string | null
  client_secret?: string | null
  webhook_secret?: string | null
  /** PG-only: default beneficiary name on remitter transfer screens
   *  (and Cashfree dashboard "Account Holder Name"). Per-customer
   *  VBAs override with the customer's PAN-verified name. Renamed
   *  from `vba_prefix` on 2026-05-04. Ignored for other products. */
  beneficiary_name?: string | null
  /** PG-only: name of the Cashfree Auto-Collect notification group to
   *  attach to every provisioned VBA. Must match a group created in
   *  Cashfree dashboard → Auto-Collect → Notifications. */
  pg_notification_group?: string | null
  /** Verification-Suite-only. Partial map — only the kinds the admin
   *  actually flipped are written. Unknown keys are ignored by the
   *  save route. */
  verification_kinds?: Partial<Record<SecureIdKindGroup, boolean>>
  updated_by_user_id?: string | null
}

/** Per-product view the admin UI reads. Secrets are masked. */
export type CashfreeProductSettingsView = {
  product: CashfreeProduct
  enabled: boolean
  active_env: CashfreeEnv
  production_only: boolean
  /** Configured-status per env. Each env exposes the client_id in the
   *  clear (the admin needs it to cross-check against the dashboard) but
   *  secrets are strictly masked. */
  envs: Record<
    CashfreeEnv,
    {
      client_id: string | null
      client_secret_set: boolean
      client_secret_masked: string | null
      webhook_secret_set: boolean
      webhook_secret_masked: string | null
    }
  >
  /** PG-only meta — included on every response for schema stability but
   *  only meaningful when product === "payment_gateway". */
  beneficiary_name: string | null
  pg_notification_group: string | null
  /** Verification-Suite-only per-kind toggles. Null for every other
   *  product so the admin UI doesn't need to branch on product type to
   *  know whether to render the section. */
  verification_kinds: Record<SecureIdKindGroup, boolean> | null
  updated_at: string | Date | null
}

/** What the admin UI sends to save settings. Secrets are plain text in transit
 *  (HTTPS) and only encrypted before persist. Empty strings mean "leave as-is";
 *  null means "explicitly clear". */
export type CashfreeSettingsInput = {
  env?: CashfreeEnv
  client_id?: string | null
  client_secret?: string | null
  payouts_client_id?: string | null
  payouts_client_secret?: string | null
  webhook_secret?: string | null
  verify_webhook_secret?: string | null
  beneficiary_name?: string | null
  updated_by_user_id?: string | null
}

/** What the admin UI receives back. Secrets are masked — never echoed in
 *  full so a casual screenshot of the page can't leak a key. The booleans
 *  let the form show "configured" indicators. */
export type CashfreeSettingsView = {
  env: CashfreeEnv
  client_id: string | null
  client_secret_set: boolean
  client_secret_masked: string | null
  payouts_client_id: string | null
  payouts_client_secret_set: boolean
  payouts_client_secret_masked: string | null
  webhook_secret_set: boolean
  webhook_secret_masked: string | null
  verify_webhook_secret_set: boolean
  verify_webhook_secret_masked: string | null
  beneficiary_name: string | null
  updated_at: string | Date | null
  /** True iff the env-var fallback would supply at least one value the DB
   *  doesn't. Helps the UI tell ops "your env vars are still in play". */
  env_fallback_active: {
    client_id: boolean
    client_secret: boolean
    payouts_client_id: boolean
    payouts_client_secret: boolean
    webhook_secret: boolean
    verify_webhook_secret: boolean
  }
}

const MAX_OPTIMISTIC_RETRIES = 3

class CashfreeWalletService extends MedusaService({
  Wallet,
  WalletTransaction,
  BankAccount,
  DematAccount,
  CashfreeVirtualAccount,
  SecureIdVerification,
  PaymentAttempt,
  HeldOrder,
  WebhookEvent,
  CashfreeSetting,
  ManualKycRequest,
  DepositProof,
  CompanyRequest,
  ContactSubmission,
  NewsletterSubscription,
  Referral,
  AdminAuditLog,
  AccountRequest,
  PanRecord,
  AadhaarRecord,
  BankRecord,
  CmrRecord,
}) {
  /**
   * Return the existing wallet for a customer, or create one at zero balance.
   * Race-safe: if two concurrent calls both see "not found", the second
   * insert will violate the unique constraint on `customer_id` and we retry
   * the lookup.
   */
  async ensureWallet(customer_id: string) {
    const [existing] = await this.listWallets({ customer_id }, { take: 1 })
    if (existing) return existing
    try {
      return await this.createWallets({
        customer_id,
        balance_inr: 0,
        promo_balance_inr: 0,
        version: 0,
        status: "active",
      })
    } catch (e) {
      const [w] = await this.listWallets({ customer_id }, { take: 1 })
      if (w) return w
      throw e
    }
  }

  /**
   * Append a credit to the wallet. Uses optimistic concurrency on `version`.
   * `idempotency_key` MUST be unique per logical event (e.g. the Cashfree
   * VBA settlement id) — duplicate calls with the same key are no-ops and
   * return the existing transaction.
   */
  async credit(params: {
    customer_id: string
    amount_inr: number
    kind: "vba_credit" | "refund" | "manual_adjust" | "referral_credit"
    reference_type?: "vba_event" | "order" | "refund" | "manual" | null
    reference_id?: string | null
    cashfree_event_id?: string | null
    idempotency_key: string
    note?: string | null
    metadata?: Record<string, unknown> | null
  }) {
    if (params.amount_inr <= 0) {
      throw new Error("credit amount must be positive")
    }

    // Idempotency short-circuit
    const [existing] = await this.listWalletTransactions(
      { idempotency_key: params.idempotency_key },
      { take: 1 }
    )
    if (existing) return existing

    for (let attempt = 0; attempt < MAX_OPTIMISTIC_RETRIES; attempt++) {
      const wallet = await this.ensureWallet(params.customer_id)
      if (wallet.status === "frozen") {
        throw new Error("wallet_frozen")
      }
      // Coerce — Postgres NUMERIC columns can surface as string via the
      // node-postgres driver, which would silently JS-string-concat on
      // the + below (e.g. "0" + 100 = "0100") and crash Mikro-ORM's
      // type validation on write. Force to Number so arithmetic stays
      // arithmetic.
      const currentBalance = Number(wallet.balance_inr)
      const currentVersion = Number(wallet.version)
      const newBalance = currentBalance + params.amount_inr
      const nextVersion = currentVersion + 1
      const updated = await this.updateWallets({
        selector: { id: wallet.id, version: currentVersion },
        data: { balance_inr: newBalance, version: nextVersion },
      })
      if (!updated || (Array.isArray(updated) && updated.length === 0)) {
        continue // lost CAS, retry
      }
      const tx = await this.createWalletTransactions({
        wallet_id: wallet.id,
        customer_id: params.customer_id,
        direction: "credit",
        amount_inr: params.amount_inr,
        balance_after: newBalance,
        kind: params.kind,
        bucket: "main",
        reference_type: params.reference_type ?? null,
        reference_id: params.reference_id ?? null,
        cashfree_event_id: params.cashfree_event_id ?? null,
        idempotency_key: params.idempotency_key,
        note: params.note ?? null,
        metadata: params.metadata ?? null,
      })
      return tx
    }
    throw new Error("wallet_credit_conflict")
  }

  /**
   * Append a credit to the **promo** sub-balance. Same CAS pattern as
   * `credit`, but mutates `promo_balance_inr` and stamps `bucket: 'promo'`
   * on the ledger row.
   *
   * Promo balance is non-withdrawable. Only callable from:
   *   - referral subscriber (kind: 'referral_credit') when the operator
   *     has set referrer/referee credit bucket to 'promo'
   *   - points-conversion endpoint (kind: 'points_conversion')
   *   - refund pipeline reversing a debit whose source was promo
   *     (kind: 'refund')
   *   - admin manual adjustment routed to promo (kind: 'manual_adjust')
   */
  async creditPromo(params: {
    customer_id: string
    amount_inr: number
    kind: "referral_credit" | "points_conversion" | "refund" | "manual_adjust"
    reference_type?: "order" | "refund" | "manual" | null
    reference_id?: string | null
    idempotency_key: string
    note?: string | null
    metadata?: Record<string, unknown> | null
  }) {
    if (params.amount_inr <= 0) {
      throw new Error("creditPromo amount must be positive")
    }
    const [existing] = await this.listWalletTransactions(
      { idempotency_key: params.idempotency_key },
      { take: 1 }
    )
    if (existing) return existing

    for (let attempt = 0; attempt < MAX_OPTIMISTIC_RETRIES; attempt++) {
      const wallet = await this.ensureWallet(params.customer_id)
      if (wallet.status === "frozen") {
        throw new Error("wallet_frozen")
      }
      const currentPromo = Number(wallet.promo_balance_inr)
      const currentVersion = Number(wallet.version)
      const newPromo = currentPromo + params.amount_inr
      const nextVersion = currentVersion + 1
      const updated = await this.updateWallets({
        selector: { id: wallet.id, version: currentVersion },
        data: { promo_balance_inr: newPromo, version: nextVersion },
      })
      if (!updated || (Array.isArray(updated) && updated.length === 0)) {
        continue // lost CAS, retry
      }
      const tx = await this.createWalletTransactions({
        wallet_id: wallet.id,
        customer_id: params.customer_id,
        direction: "credit",
        amount_inr: params.amount_inr,
        balance_after: newPromo,
        kind: params.kind,
        bucket: "promo",
        reference_type: params.reference_type ?? null,
        reference_id: params.reference_id ?? null,
        cashfree_event_id: null,
        idempotency_key: params.idempotency_key,
        note: params.note ?? null,
        metadata: params.metadata ?? null,
      })
      return tx
    }
    throw new Error("wallet_credit_conflict")
  }

  /**
   * Compute the per-transaction promo utilisation cap from settings.
   * Returns the cap in paise. Reads `promo_max_pct_of_subtotal` and
   * `promo_max_flat_inr` from the singleton settings row; takes the
   * MAX of (pct × subtotal, flat). Honours the `promo_payment_enabled`
   * master switch — disabled returns 0.
   *
   * `cart_subtotal_inr` is the line-item investment value BEFORE
   * processing/low-qty fees. Caller is responsible for passing the
   * correct subtotal — the service has no opinion on what "subtotal"
   * means.
   */
  async getPromoCapForCart(cart_subtotal_inr: number): Promise<number> {
    const row = await this.loadSettingRow()
    if (!row) {
      // Fall back to defaults if no row exists yet.
      return Math.max(Math.floor(0.02 * Math.max(0, cart_subtotal_inr)), 500)
    }
    if (!row.promo_payment_enabled) return 0
    const pct = Number(row.promo_max_pct_of_subtotal ?? 0.02)
    const flat = Math.floor(Number(row.promo_max_flat_inr ?? 500))
    const pctCap = Math.floor(pct * Math.max(0, cart_subtotal_inr))
    return Math.max(pctCap, flat)
  }

  /**
   * Split-bucket order debit. Drains promo first (capped per-tx by
   * `getPromoCapForCart(cart_subtotal_inr)`) then main for the
   * remainder. Both bucket mutations happen under the same CAS retry
   * loop so a concurrent credit cannot interleave between the two
   * writes.
   *
   * Idempotency: the caller passes a single `idempotency_key` (e.g.
   * `order_<order_id>`). We synthesise per-bucket sub-keys:
   *   - main:  `<idempotency_key>`           (so existing reverseDebit
   *                                           tooling keyed on the
   *                                           order id keeps working)
   *   - promo: `<idempotency_key>:promo`
   *
   * On replay, we look up BOTH keys and reconstruct the prior result
   * without touching the wallet.
   *
   * On insufficient combined funds, NEITHER bucket is touched and the
   * caller decides whether to hold the order or reject. Returning early
   * here (vs. partial debit) is critical — partial debits are very
   * hard to reason about.
   */
  async debitForOrder(params: {
    customer_id: string
    amount_inr: number
    cart_subtotal_inr: number
    reference_type?: "order" | "cart" | null
    reference_id?: string | null
    /** Single key per logical order. Both ledger rows derive from this. */
    idempotency_key: string
    note?: string | null
    metadata?: Record<string, unknown> | null
    /**
     * Customer's chosen promo bucket spend (paise) for this debit. When
     * provided, we use it INSTEAD of the drain-max default — clamped
     * server-side to `[0, min(amount, current_promo, cap)]` so the
     * customer can't exceed their entitlement even if the storefront
     * sends a stale or tampered value.
     *
     * When `null`/`undefined`, we fall back to historic behavior:
     * promo = min(amount, current_promo, cap). UI default is also
     * drain-max, so existing flows are unaffected.
     */
    promo_override_inr?: number | null
  }): Promise<DebitSplitResult> {
    if (params.amount_inr <= 0) {
      throw new Error("debit amount must be positive")
    }
    const mainKey = params.idempotency_key
    const promoKey = `${params.idempotency_key}:promo`

    // Idempotency replay — if either side already wrote, both must
    // exist (we always write atomically below) so reconstruct the
    // result from whichever rows are present.
    const [mainExisting] = await this.listWalletTransactions(
      { idempotency_key: mainKey },
      { take: 1 }
    )
    const [promoExisting] = await this.listWalletTransactions(
      { idempotency_key: promoKey },
      { take: 1 }
    )
    if (mainExisting || promoExisting) {
      return {
        ok: true,
        promo_amount_inr: Number(promoExisting?.amount_inr ?? 0),
        main_amount_inr: Number(mainExisting?.amount_inr ?? 0),
        promo_balance_after: Number(promoExisting?.balance_after ?? 0),
        main_balance_after: Number(mainExisting?.balance_after ?? 0),
        promo_transaction_id: promoExisting?.id ?? null,
        main_transaction_id: mainExisting?.id ?? null,
      }
    }

    const promoCap = await this.getPromoCapForCart(params.cart_subtotal_inr)

    for (let attempt = 0; attempt < MAX_OPTIMISTIC_RETRIES; attempt++) {
      const wallet = await this.ensureWallet(params.customer_id)
      if (wallet.status === "frozen") {
        return { ok: false, reason: "wallet_frozen" }
      }
      const currentMain = Number(wallet.balance_inr)
      const currentPromo = Number(wallet.promo_balance_inr)
      const currentVersion = Number(wallet.version)

      // Promo bucket math:
      //   maxPromo = min(amount, current_promo, cap)
      //   - override null  → drain max (legacy behavior)
      //   - override set   → clamp to [0, maxPromo]
      // The clamp is the only trust line; the storefront can lie about
      // override but can never exceed entitlement.
      const maxPromo = Math.min(params.amount_inr, currentPromo, promoCap)
      const promoDebit =
        params.promo_override_inr == null
          ? maxPromo
          : Math.max(0, Math.min(maxPromo, Math.floor(Number(params.promo_override_inr))))
      const mainDebit = params.amount_inr - promoDebit

      // Insufficient combined funds — even after promo cap, main can't cover.
      if (currentMain < mainDebit) {
        const totalAvail = currentMain + currentPromo
        return {
          ok: false,
          reason: "insufficient_funds",
          shortfall: params.amount_inr - totalAvail,
          balance: totalAvail,
          promo_balance: currentPromo,
          main_balance: currentMain,
        }
      }

      const newMain = currentMain - mainDebit
      const newPromo = currentPromo - promoDebit
      const nextVersion = currentVersion + 1
      const updated = await this.updateWallets({
        selector: { id: wallet.id, version: currentVersion },
        data: {
          balance_inr: newMain,
          promo_balance_inr: newPromo,
          version: nextVersion,
        },
      })
      if (!updated || (Array.isArray(updated) && updated.length === 0)) {
        continue // lost CAS, retry
      }

      // Write ledger rows. Order: promo first, then main — purely
      // cosmetic (transactions list orders newest-first by created_at,
      // and the main row is the "primary" one referenced by reversals).
      let promoTxId: string | null = null
      let mainTxId: string | null = null
      if (promoDebit > 0) {
        const ptx = await this.createWalletTransactions({
          wallet_id: wallet.id,
          customer_id: params.customer_id,
          direction: "debit",
          amount_inr: promoDebit,
          balance_after: newPromo,
          kind: "order_debit",
          bucket: "promo",
          reference_type: params.reference_type ?? null,
          reference_id: params.reference_id ?? null,
          cashfree_event_id: null,
          idempotency_key: promoKey,
          note: params.note ?? null,
          metadata: { ...(params.metadata ?? {}), split_of: mainKey },
        })
        promoTxId = ptx.id
      }
      if (mainDebit > 0) {
        const mtx = await this.createWalletTransactions({
          wallet_id: wallet.id,
          customer_id: params.customer_id,
          direction: "debit",
          amount_inr: mainDebit,
          balance_after: newMain,
          kind: "order_debit",
          bucket: "main",
          reference_type: params.reference_type ?? null,
          reference_id: params.reference_id ?? null,
          cashfree_event_id: null,
          idempotency_key: mainKey,
          note: params.note ?? null,
          metadata: params.metadata ?? null,
        })
        mainTxId = mtx.id
      } else {
        // Edge case: entire debit covered by promo. We still write a
        // zero-amount main row so reverseDebit by order id works
        // uniformly. Skip — the replay path handles "no main row" by
        // surfacing 0; reversals iterate by reference_id which catches
        // both rows. Don't fabricate a zero row.
      }

      return {
        ok: true,
        promo_amount_inr: promoDebit,
        main_amount_inr: mainDebit,
        promo_balance_after: newPromo,
        main_balance_after: newMain,
        promo_transaction_id: promoTxId,
        main_transaction_id: mainTxId,
      }
    }
    throw new Error("wallet_debit_conflict")
  }

  /**
   * Attempt to debit the wallet atomically. Returns a typed result: on
   * `insufficient_funds` the caller decides whether to create a HeldOrder.
   *
   * The debit is idempotent via `idempotency_key`; re-invocations of the
   * same debit (e.g. payment provider retry) return the same result.
   */
  async debit(params: {
    customer_id: string
    amount_inr: number
    kind: "order_debit" | "manual_adjust"
    reference_type?: "order" | "cart" | "manual" | null
    reference_id?: string | null
    idempotency_key: string
    note?: string | null
    metadata?: Record<string, unknown> | null
  }): Promise<DebitResult> {
    if (params.amount_inr <= 0) {
      throw new Error("debit amount must be positive")
    }

    const [existing] = await this.listWalletTransactions(
      { idempotency_key: params.idempotency_key },
      { take: 1 }
    )
    if (existing) {
      return {
        ok: true,
        balance_after: existing.balance_after,
        transaction_id: existing.id,
      }
    }

    for (let attempt = 0; attempt < MAX_OPTIMISTIC_RETRIES; attempt++) {
      const wallet = await this.ensureWallet(params.customer_id)
      // Coerce — see comment in credit() above. Postgres NUMERIC →
      // string surfaces break arithmetic + Mikro-ORM type validation.
      const currentBalance = Number(wallet.balance_inr)
      const currentVersion = Number(wallet.version)
      if (wallet.status === "frozen") return { ok: false, reason: "wallet_frozen" }
      if (currentBalance < params.amount_inr) {
        return {
          ok: false,
          reason: "insufficient_funds",
          shortfall: params.amount_inr - currentBalance,
          balance: currentBalance,
        }
      }
      const newBalance = currentBalance - params.amount_inr
      const nextVersion = currentVersion + 1
      const updated = await this.updateWallets({
        selector: { id: wallet.id, version: currentVersion },
        data: { balance_inr: newBalance, version: nextVersion },
      })
      if (!updated || (Array.isArray(updated) && updated.length === 0)) {
        continue
      }
      const tx = await this.createWalletTransactions({
        wallet_id: wallet.id,
        customer_id: params.customer_id,
        direction: "debit",
        amount_inr: params.amount_inr,
        balance_after: newBalance,
        kind: params.kind,
        bucket: "main",
        reference_type: params.reference_type ?? null,
        reference_id: params.reference_id ?? null,
        cashfree_event_id: null,
        idempotency_key: params.idempotency_key,
        note: params.note ?? null,
        metadata: params.metadata ?? null,
      })
      return { ok: true, balance_after: newBalance, transaction_id: tx.id }
    }
    throw new Error("wallet_debit_conflict")
  }

  /**
   * Reverse a prior debit (wallet credit that references the original
   * debit row). Used by `cancelPayment` and explicit refunds.
   * Idempotent via reversal-keyed id.
   *
   * Routes the credit back to the SOURCE bucket: a debit from promo
   * reverses to promo, a debit from main reverses to main. Promo can
   * never become bank-money, so a refund of a promo-paid split must
   * not silently land in the withdrawable bucket.
   */
  async reverseDebit(params: {
    original_transaction_id: string
    reason: "order_cancelled" | "refund" | "admin_reversal"
  }) {
    const original = await this.retrieveWalletTransaction(
      params.original_transaction_id
    ).catch(() => null)
    if (!original || original.direction !== "debit") {
      throw new Error("reverseDebit: original debit not found")
    }
    // "cart" isn't a valid credit reference_type (credits always land against
    // an order, refund, or manual entry) — normalise to "order" for reversals
    // of cart-referenced debits. The original cart_id is still recoverable via
    // metadata.reverses → original.reference_id.
    const creditRefType: "order" | "refund" | "manual" | null =
      original.reference_type === "cart" || original.reference_type === "order"
        ? "order"
        : original.reference_type === "refund"
        ? "refund"
        : original.reference_type === "manual"
        ? "manual"
        : null
    const kind: "refund" | "manual_adjust" =
      params.reason === "refund" ? "refund" : "manual_adjust"

    if (original.bucket === "promo") {
      return await this.creditPromo({
        customer_id: original.customer_id,
        amount_inr: Number(original.amount_inr),
        kind,
        reference_type: creditRefType,
        reference_id: original.reference_id,
        idempotency_key: `reversal_${original.id}`,
        note: `reversal:${params.reason}`,
        metadata: { reverses: original.id, bucket: "promo" },
      })
    }
    return await this.credit({
      customer_id: original.customer_id,
      amount_inr: Number(original.amount_inr),
      kind,
      reference_type: creditRefType,
      reference_id: original.reference_id,
      idempotency_key: `reversal_${original.id}`,
      note: `reversal:${params.reason}`,
      metadata: { reverses: original.id, bucket: "main" },
    })
  }

  /**
   * Reverse ALL debit ledger rows tied to a single order (both the
   * main and promo splits, when present). Used by the order-cancel /
   * full-refund pipelines.
   *
   * Looks up debit rows by `reference_id` (the order id) — this is
   * more reliable than parsing idempotency_key suffixes because the
   * caller doesn't have to know whether a promo split happened.
   *
   * Returns the list of reversal credit transactions (one per
   * original debit row). Idempotent — replaying calls
   * `reverseDebit(original_transaction_id)` per row, which is itself
   * idempotency-keyed by `reversal_<id>`.
   */
  async reverseOrderDebits(params: {
    reference_id: string
    reason: "order_cancelled" | "refund" | "admin_reversal"
  }) {
    const debits = await this.listWalletTransactions(
      {
        reference_id: params.reference_id,
        direction: "debit",
        kind: "order_debit",
      } as any,
      { take: 100 }
    )
    const reversals = []
    for (const d of debits) {
      const r = await this.reverseDebit({
        original_transaction_id: d.id,
        reason: params.reason,
      })
      reversals.push(r)
    }
    return reversals
  }

  /**
   * Derive the customer's overall KYC status from the Secure ID history and
   * account tables. This replaces reads of `customer.metadata.kyc_status`.
   * A customer is `approved` iff they have a successful PAN verify, a
   * successful Aadhaar OTP verify, at least one verified bank, and exactly
   * one verified primary demat.
   */
  async getKycStatus(customer_id: string): Promise<KycStatus> {
    const verifications = await this.listSecureIdVerifications({
      customer_id,
    })
    const panOk = verifications.some(
      (v) => v.kind === "pan" && v.status === "success"
    )
    const aadhaarOk = verifications.some(
      (v) => v.kind === "aadhaar_otp_verify" && v.status === "success"
    )
    const banks = await this.listBankAccounts({
      customer_id,
      verification_status: "verified",
    })
    const primaryDemats = await this.listDematAccounts({
      customer_id,
      is_primary: true,
      verification_status: "verified",
    })
    // Pending admin review for identity (PAN / Aadhaar). The presence of
    // an open `manual_kyc_request` row means a verify call landed in the
    // loose-match / name-mismatch / no-PAN-anchor path and the customer
    // is waiting for an admin verdict. Surfacing this on the server is
    // load-bearing: the per-component banner used to disappear on page
    // reload because it lived in React state.
    const pendingReviews = await this.listManualKycRequests(
      { customer_id, status: "pending" } as any,
      { take: 1 },
    )
    const identityUnderReview = pendingReviews.length > 0
    // Find the latest FAILED attempt across all kinds, but only if
    // it's more recent than any SUCCESS of the same kind. A stale
    // failure that's been superseded by a later success shouldn't
    // surface as the customer-facing "last verification attempt
    // failed" banner — the success makes that failure historical.
    const sortedDesc = [...verifications].sort((a, b) =>
      String(b.created_at ?? "").localeCompare(String(a.created_at ?? ""))
    )
    const latestSuccessByKind = new Map<string, string>()
    for (const v of sortedDesc) {
      if (v.status === "success" && !latestSuccessByKind.has(v.kind)) {
        latestSuccessByKind.set(v.kind, String(v.created_at ?? ""))
      }
    }
    const latestFailure = sortedDesc.find((v) => {
      if (v.status !== "failed") return false
      const latestSuccessAt = latestSuccessByKind.get(v.kind)
      // Surface the failure only when it's the most recent attempt of
      // its kind (no later success exists).
      return !latestSuccessAt || latestSuccessAt < String(v.created_at ?? "")
    })

    // Hydrate per-kind enable flags from the singleton settings row so the
    // storefront can hide/skip steps the admin has turned off without the
    // client having to hit /admin/cashfree-products (which is admin-only).
    const enabledKinds = await this.getVerificationKindsEnabledMap()

    // Checklist semantics: if an admin has flipped a kind off, we surface
    // it as "disabled" — the customer is neither gated on it nor shown a
    // form for it. A "done" item is one the customer has already completed
    // (and we never re-run Secure ID for it — see the store routes'
    // idempotency guards). "pending" is the remaining work.
    const stepDone: Record<SecureIdKindGroup, boolean> = {
      pan: panOk,
      aadhaar: aadhaarOk,
      bank: banks.length > 0,
      cmr: primaryDemats.length > 0,
    }
    const stepLabel: Record<SecureIdKindGroup, string> = {
      pan: "PAN verified",
      aadhaar: "Aadhaar verified",
      bank: "Bank account",
      // Renamed — Cashfree CMR is no longer in the path; the customer
      // uploads a CMR PDF that an admin reviews manually. The internal
      // kind key stays "cmr" for audit-trail compatibility.
      cmr: "Primary demat",
    }
    const kindsOrder: SecureIdKindGroup[] = ["pan", "aadhaar", "bank", "cmr"]
    // Demat / CMR is now ALWAYS required — Cashfree's CMR path is gone,
    // but the manual review path means demat verification is still a
    // real KYC step regardless of any toggle. We override the
    // enabled-kinds map so the checklist never strikes through "Primary
    // demat" with a `disabled` styling. The other three kinds still
    // honour the admin's per-kind toggles.
    const effectiveEnabled: Record<SecureIdKindGroup, boolean> = {
      ...enabledKinds,
      cmr: true,
    }
    const checklist: KycChecklistItem[] = kindsOrder.map((key) => {
      if (!effectiveEnabled[key]) {
        return { key, label: stepLabel[key], status: "disabled" }
      }
      return {
        key,
        label: stepLabel[key],
        status: stepDone[key] ? "done" : "pending",
      }
    })

    // `overall` now respects disabled kinds — a kind that's disabled in
    // settings does not count toward the "in progress" / "approved"
    // computation, otherwise we'd never approve when the admin intentionally
    // turned e.g. PAN or Aadhaar off. CMR is always required (see comment
    // above) so it always counts.
    const activeKinds = kindsOrder.filter((k) => effectiveEnabled[k])
    const allOk =
      activeKinds.length > 0 && activeKinds.every((k) => stepDone[k])
    const anyOk = activeKinds.some((k) => stepDone[k])

    return {
      overall: allOk
        ? "approved"
        : anyOk
        ? "in_progress"
        : "not_started",
      pan_verified: panOk,
      aadhaar_verified: aadhaarOk,
      has_verified_bank: banks.length > 0,
      has_primary_demat: primaryDemats.length > 0,
      identity_under_review: identityUnderReview,
      last_failure_reason:
        latestFailure?.response_raw &&
        typeof (latestFailure.response_raw as Record<string, unknown>)
          ?.message === "string"
          ? String(
              (latestFailure.response_raw as Record<string, unknown>).message
            )
          : null,
      enabled_kinds: effectiveEnabled,
      checklist,
    }
  }

  /**
   * Resolve the effective "this kind of Secure ID call is live" flags.
   *
   * A kind is live iff:
   *   1. The umbrella Verification Suite product is enabled
   *      (`verification_enabled = true`), AND
   *   2. The per-kind column (`<kind>_verification_enabled`) is true.
   *
   * Pre-migration rows lack the per-kind columns → coerced to TRUE to
   * preserve legacy behavior. Rows that don't exist at all (fresh install
   * with no admin save yet) → everything off.
   */
  async getVerificationKindsEnabledMap(): Promise<
    Record<SecureIdKindGroup, boolean>
  > {
    const row = (await this.loadSettingRow()) as any
    const masterOn = !!row?.verification_enabled
    if (!masterOn) {
      return { pan: false, aadhaar: false, bank: false, cmr: false }
    }
    return {
      pan: row?.pan_verification_enabled ?? true,
      aadhaar: row?.aadhaar_verification_enabled ?? true,
      bank: row?.bank_verification_enabled ?? true,
      cmr: row?.cmr_verification_enabled ?? true,
    }
  }

  /** Quick single-kind check used by the store routes to refuse calls for
   *  kinds the admin has turned off. Returns { enabled, reason } so the
   *  caller can produce a specific error message. */
  async isSecureIdKindEnabled(
    kind: SecureIdKindGroup
  ): Promise<{ enabled: boolean; reason: "master_off" | "kind_off" | null }> {
    const row = (await this.loadSettingRow()) as any
    if (!row?.verification_enabled) {
      return { enabled: false, reason: "master_off" }
    }
    const col = `${kind}_verification_enabled` as const
    const flag = row?.[col]
    if (flag === false) return { enabled: false, reason: "kind_off" }
    return { enabled: true, reason: null }
  }

  /**
   * Atomically set `demat_id` as the primary demat for `customer_id`. Flips
   * `is_primary` off on all siblings and on for the chosen row.
   */
  async setPrimaryDemat(customer_id: string, demat_id: string) {
    const demats = await this.listDematAccounts({ customer_id })
    const target = demats.find((d) => d.id === demat_id)
    if (!target) throw new Error("demat not found for customer")
    if (target.verification_status !== "verified") {
      throw new Error("cannot mark an unverified demat as primary")
    }
    for (const d of demats) {
      const shouldBePrimary = d.id === demat_id
      if (d.is_primary !== shouldBePrimary) {
        await this.updateDematAccounts({
          selector: { id: d.id },
          data: { is_primary: shouldBePrimary },
        })
      }
    }
    return await this.retrieveDematAccount(demat_id)
  }

  /**
   * Utility: generate a UUID-backed idempotency key for callers that don't
   * have a natural one (admin manual adjust, etc.).
   */
  newIdempotencyKey(prefix = "idem"): string {
    return `${prefix}_${randomUUID()}`
  }

  // ------------------------------------------------------------------
  // Cashfree settings — DB-backed credentials read by the admin UI and
  // by the live API client factories below. DB row wins over env vars
  // for any populated field; env stays as a fallback so existing
  // process-level config keeps working.
  // ------------------------------------------------------------------

  private static readonly SINGLETON_KEY = "default"

  private async loadSettingRow() {
    const [row] = await this.listCashfreeSettings(
      { singleton_key: CashfreeWalletService.SINGLETON_KEY },
      { take: 1 }
    )
    return row ?? null
  }

  private maskSecret(plaintext: string | null): string | null {
    if (!plaintext) return null
    if (plaintext.length <= 8) return "********"
    return `${plaintext.slice(0, 3)}…${plaintext.slice(-3)}`
  }

  private decryptOrNull(ciphertext: string | null): string | null {
    if (!ciphertext) return null
    try {
      return decryptString(ciphertext)
    } catch {
      // Likely AT_REST_ENCRYPTION_KEY rotated without re-encrypting. Don't
      // throw — surface as "not configured" so the UI can show the issue.
      return null
    }
  }

  /**
   * Pick the credential set for the given env from a row. Prefers the per-env
   * column; falls back to the legacy flat column if the per-env column is
   * still NULL (rows created before Migration20260422190517's backfill).
   */
  private pickEnvCreds(row: any, env: CashfreeEnv) {
    const prefix = env // "sandbox" or "production"
    const pe = (suffix: string) =>
      row?.[`${prefix}_${suffix}`] ?? row?.[suffix] ?? null
    return {
      client_id: pe("client_id") as string | null,
      client_secret_encrypted: pe("client_secret_encrypted") as string | null,
      payouts_client_id: pe("payouts_client_id") as string | null,
      payouts_client_secret_encrypted: pe(
        "payouts_client_secret_encrypted"
      ) as string | null,
      webhook_secret_encrypted: pe("webhook_secret_encrypted") as string | null,
      verify_webhook_secret_encrypted: pe(
        "verify_webhook_secret_encrypted"
      ) as string | null,
    }
  }

  /**
   * Resolve the live credential set, merging DB row + env fallback.
   * Returns plaintext secrets — only callable inside the service.
   */
  private async resolveLiveCredentials() {
    const row = await this.loadSettingRow()
    const env = (row?.env ??
      (process.env.CASHFREE_ENV as CashfreeEnv | undefined) ??
      "sandbox") as CashfreeEnv
    const creds = this.pickEnvCreds(row, env)
    return {
      env,
      client_id: creds.client_id ?? process.env.CASHFREE_CLIENT_ID ?? null,
      client_secret:
        this.decryptOrNull(creds.client_secret_encrypted) ??
        process.env.CASHFREE_CLIENT_SECRET ??
        null,
      payouts_client_id:
        creds.payouts_client_id ??
        process.env.CASHFREE_PAYOUTS_CLIENT_ID ??
        null,
      payouts_client_secret:
        this.decryptOrNull(creds.payouts_client_secret_encrypted) ??
        process.env.CASHFREE_PAYOUTS_CLIENT_SECRET ??
        null,
      webhook_secret:
        this.decryptOrNull(creds.webhook_secret_encrypted) ??
        process.env.CASHFREE_WEBHOOK_SECRET ??
        null,
      verify_webhook_secret:
        this.decryptOrNull(creds.verify_webhook_secret_encrypted) ??
        process.env.CASHFREE_VERIFY_WEBHOOK_SECRET ??
        null,
      beneficiary_name:
        row?.beneficiary_name ?? process.env.CASHFREE_VBA_PREFIX ?? "POLEMARCH",
    }
  }

  // ==================================================================
  //  PRODUCT-AWARE CREDENTIAL RESOLUTION
  //
  //  Cashfree treats each product as its own integration with an isolated
  //  (x-client-id, x-client-secret, webhook_signing_secret) triple. The
  //  methods below replace the legacy "audience"-based access (which
  //  conflated Auto-Collect/VBA with Verification Suite). Old call sites
  //  that still take "verification" / "payouts" are routed through
  //  `LEGACY_AUDIENCE_TO_PRODUCT` below so nothing breaks during rollout.
  // ==================================================================

  /** The Cashfree products we model. Must stay in sync with
   *  `PRODUCT_COLUMN_PREFIX` below. */
  // NB: exported via getters; the string union doubles as a discriminator.

  /** Map each product to the column name prefix used to store its
   *  credentials. Legacy products (VS, Payouts) keep their original
   *  column names; new products (PG, Subscriptions, Cross-border) use
   *  a `<env>_<product>_...` naming. */
  private static readonly PRODUCT_COLUMN_PREFIX: Record<
    CashfreeProduct,
    {
      client_id: (env: CashfreeEnv) => string
      client_secret: (env: CashfreeEnv) => string
      webhook_secret: (env: CashfreeEnv) => string
      /** If true, this product has no Cashfree-dashboard test keys. The
       *  admin UI forces production and skips the env picker. */
      productionOnly: boolean
      envColumn: string | null // name of the `<p>_active_env` column, null for productionOnly
      enabledColumn: string
    }
  > = {
    payment_gateway: {
      client_id: (e) => `${e}_pg_client_id`,
      client_secret: (e) => `${e}_pg_client_secret_encrypted`,
      webhook_secret: (e) => `${e}_pg_webhook_secret_encrypted`,
      productionOnly: false,
      envColumn: "pg_active_env",
      enabledColumn: "pg_enabled",
    },
    payouts: {
      client_id: (e) => `${e}_payouts_client_id`,
      client_secret: (e) => `${e}_payouts_client_secret_encrypted`,
      webhook_secret: (e) => `${e}_webhook_secret_encrypted`,
      productionOnly: false,
      envColumn: "payouts_active_env",
      enabledColumn: "payouts_enabled",
    },
    subscriptions: {
      client_id: (e) => `${e}_subscriptions_client_id`,
      client_secret: (e) => `${e}_subscriptions_client_secret_encrypted`,
      webhook_secret: (e) => `${e}_subscriptions_webhook_secret_encrypted`,
      productionOnly: false,
      envColumn: "subscriptions_active_env",
      enabledColumn: "subscriptions_enabled",
    },
    cross_border: {
      client_id: (e) => `${e}_cross_border_client_id`,
      client_secret: (e) => `${e}_cross_border_client_secret_encrypted`,
      webhook_secret: (e) => `${e}_cross_border_webhook_secret_encrypted`,
      productionOnly: false,
      envColumn: "cross_border_active_env",
      enabledColumn: "cross_border_enabled",
    },
    verification_suite: {
      client_id: (e) => `${e}_client_id`,
      client_secret: (e) => `${e}_client_secret_encrypted`,
      webhook_secret: (e) => `${e}_verify_webhook_secret_encrypted`,
      productionOnly: true,
      envColumn: null,
      enabledColumn: "verification_enabled",
    },
  }

  /** Cashfree-audience → product mapping for old `getCashfreeClient("...")`
   *  callers. Auto-Collect (`/pg/vba`) used to be routed via the
   *  "verification" audience — we switch its effective product to
   *  payment_gateway separately in `getAutoCollect` below. */
  private static readonly LEGACY_AUDIENCE_TO_PRODUCT: Record<
    CashfreeAudience,
    CashfreeProduct
  > = {
    verification: "verification_suite",
    payouts: "payouts",
  }

  /** Which env is live for a given product. Respects the per-product
   *  pointer; falls back to the row's global `env` for the first time a
   *  product is configured on a pre-migration row. VS is always
   *  production. */
  private productActiveEnv(row: any, product: CashfreeProduct): CashfreeEnv {
    const meta = CashfreeWalletService.PRODUCT_COLUMN_PREFIX[product]
    if (meta.productionOnly) return "production"
    const explicit = row?.[meta.envColumn!] as CashfreeEnv | undefined
    if (explicit === "sandbox" || explicit === "production") return explicit
    return (row?.env as CashfreeEnv | undefined) ?? "sandbox"
  }

  /** Read the raw (ciphertext) column triple for a product + env, plus
   *  legacy-column read-fallback where applicable. Only used internally. */
  private readProductColumns(
    row: any,
    product: CashfreeProduct,
    env: CashfreeEnv
  ): {
    client_id: string | null
    client_secret_encrypted: string | null
    webhook_secret_encrypted: string | null
  } {
    const meta = CashfreeWalletService.PRODUCT_COLUMN_PREFIX[product]
    const direct = (k: keyof typeof meta) =>
      row?.[(meta[k] as (e: CashfreeEnv) => string)(env)] ?? null

    let client_id = direct("client_id") as string | null
    let client_secret_encrypted = direct("client_secret") as string | null
    let webhook_secret_encrypted = direct("webhook_secret") as string | null

    // Legacy flat-column fallback — only for VS + Payouts where the old
    // flat columns historically held these products' credentials.
    if (product === "verification_suite") {
      client_id ||= row?.client_id ?? null
      client_secret_encrypted ||= row?.client_secret_encrypted ?? null
      webhook_secret_encrypted ||=
        row?.verify_webhook_secret_encrypted ?? null
    } else if (product === "payouts") {
      client_id ||= row?.payouts_client_id ?? null
      client_secret_encrypted ||= row?.payouts_client_secret_encrypted ?? null
      webhook_secret_encrypted ||= row?.webhook_secret_encrypted ?? null
    }
    return { client_id, client_secret_encrypted, webhook_secret_encrypted }
  }

  /** Plaintext credentials for a product (decrypting secrets on the way
   *  out). Returns nulls if not configured. Only callable inside the
   *  service. */
  private async resolveProductCredentials(
    product: CashfreeProduct
  ): Promise<{
    enabled: boolean
    env: CashfreeEnv
    client_id: string | null
    client_secret: string | null
    webhook_secret: string | null
  }> {
    const row = await this.loadSettingRow()
    const meta = CashfreeWalletService.PRODUCT_COLUMN_PREFIX[product]
    const env = this.productActiveEnv(row, product)
    const enabled = !!row?.[meta.enabledColumn]
    const raw = this.readProductColumns(row, product, env)
    return {
      enabled,
      env,
      client_id: raw.client_id,
      client_secret: this.decryptOrNull(raw.client_secret_encrypted),
      webhook_secret: this.decryptOrNull(raw.webhook_secret_encrypted),
    }
  }

  /** Build a Cashfree HTTP client bound to a product's active env + creds.
   *  Throws if the product is disabled or credentials aren't set — caller
   *  translates that to the appropriate HTTP response. */
  async getCashfreeClientForProduct(
    product: CashfreeProduct
  ): Promise<CashfreeClient> {
    const live = await this.resolveProductCredentials(product)
    if (!live.enabled) {
      throw new Error(
        `cashfree product ${product} is disabled; enable it in Admin → Cashfree → ${product}`
      )
    }
    if (!live.client_id || !live.client_secret) {
      throw new Error(
        `cashfree product ${product} has no credentials for env=${live.env}; set them in Admin → Cashfree → ${product}`
      )
    }
    // Back-compat: the HTTP client still wants a legacy "audience" for its
    // base-URL table. All current products share the api.cashfree.com host
    // so `verification` is safe as the audience key here.
    const audience: CashfreeAudience =
      product === "payouts" ? "payouts" : "verification"
    return new CashfreeClient({
      env: live.env,
      audience,
      clientId: live.client_id,
      clientSecret: live.client_secret,
    })
  }

  /** Admin view of a single product: credential state for BOTH envs, masked.
   *  Drives the new /admin/cashfree page's per-product tab. */
  async getCashfreeProductView(
    product: CashfreeProduct
  ): Promise<CashfreeProductSettingsView> {
    const row = await this.loadSettingRow()
    const meta = CashfreeWalletService.PRODUCT_COLUMN_PREFIX[product]
    const envs: CashfreeEnv[] = meta.productionOnly
      ? ["production"]
      : ["sandbox", "production"]
    const envView: CashfreeProductSettingsView["envs"] = {
      sandbox: {
        client_id: null,
        client_secret_set: false,
        client_secret_masked: null,
        webhook_secret_set: false,
        webhook_secret_masked: null,
      },
      production: {
        client_id: null,
        client_secret_set: false,
        client_secret_masked: null,
        webhook_secret_set: false,
        webhook_secret_masked: null,
      },
    }
    for (const env of envs) {
      const raw = this.readProductColumns(row, product, env)
      const secret = this.decryptOrNull(raw.client_secret_encrypted)
      const webhook = this.decryptOrNull(raw.webhook_secret_encrypted)
      envView[env] = {
        client_id: raw.client_id,
        client_secret_set: !!secret,
        client_secret_masked: this.maskSecret(secret),
        webhook_secret_set: !!webhook,
        webhook_secret_masked: this.maskSecret(webhook),
      }
    }
    // Verification-Suite only: expose per-kind toggles. Defaults to TRUE
    // so an unconfigured row + an on master switch behaves like "all kinds
    // live" (matches the pre-migration runtime behavior).
    let verificationKinds: Record<SecureIdKindGroup, boolean> | null = null
    if (product === "verification_suite") {
      const r = row as any
      verificationKinds = {
        pan: r?.pan_verification_enabled ?? true,
        aadhaar: r?.aadhaar_verification_enabled ?? true,
        bank: r?.bank_verification_enabled ?? true,
        cmr: r?.cmr_verification_enabled ?? true,
      }
    }

    return {
      product,
      enabled: !!row?.[meta.enabledColumn],
      active_env: this.productActiveEnv(row, product),
      production_only: meta.productionOnly,
      envs: envView,
      beneficiary_name: row?.beneficiary_name ?? null,
      pg_notification_group: (row as any)?.pg_notification_group ?? null,
      verification_kinds: verificationKinds,
      updated_at: row?.updated_at ?? null,
    }
  }

  /** List view of every product — one call, used to hydrate the
   *  /admin/cashfree page's side nav. */
  async listCashfreeProductViews(): Promise<CashfreeProductSettingsView[]> {
    const products: CashfreeProduct[] = [
      "payment_gateway",
      "payouts",
      "subscriptions",
      "cross_border",
      "verification_suite",
    ]
    return Promise.all(products.map((p) => this.getCashfreeProductView(p)))
  }

  /** Save one product's settings atomically. Only writes columns that
   *  belong to this product + its chosen env — sibling products and the
   *  opposite env stay untouched. */
  async saveCashfreeProductSettings(
    input: CashfreeProductSettingsInput
  ): Promise<CashfreeProductSettingsView> {
    const existing = await this.loadSettingRow()
    const meta = CashfreeWalletService.PRODUCT_COLUMN_PREFIX[input.product]

    // Env the credential fields apply to.
    const targetEnv: CashfreeEnv = meta.productionOnly
      ? "production"
      : (input.env ??
          this.productActiveEnv(existing, input.product) ??
          "sandbox")

    const data: Record<string, unknown> = {
      singleton_key: CashfreeWalletService.SINGLETON_KEY,
    }

    // Scalars
    if (input.enabled !== undefined) {
      data[meta.enabledColumn] = input.enabled
    }
    if (input.active_env !== undefined && !meta.productionOnly) {
      data[meta.envColumn!] = input.active_env
    }

    // PG-only: VBA prefix + notification_group both live on the singleton.
    if (input.product === "payment_gateway" && input.beneficiary_name !== undefined) {
      data.beneficiary_name =
        input.beneficiary_name === "" ? existing?.beneficiary_name ?? null : input.beneficiary_name
    }
    if (
      input.product === "payment_gateway" &&
      input.pg_notification_group !== undefined
    ) {
      data.pg_notification_group =
        input.pg_notification_group === ""
          ? (existing as any)?.pg_notification_group ?? null
          : input.pg_notification_group
    }
    if (input.updated_by_user_id !== undefined) {
      data.updated_by_user_id = input.updated_by_user_id
    }

    // Credential columns — only for the target env.
    const existingCols = this.readProductColumns(
      existing,
      input.product,
      targetEnv
    )
    const clientIdCol = meta.client_id(targetEnv)
    const clientSecretCol = meta.client_secret(targetEnv)
    const webhookSecretCol = meta.webhook_secret(targetEnv)

    if (input.client_id !== undefined) {
      data[clientIdCol] =
        input.client_id === "" ? existingCols.client_id ?? null : input.client_id
    }
    if (input.client_secret !== undefined) {
      if (input.client_secret === "") {
        data[clientSecretCol] = existingCols.client_secret_encrypted ?? null
      } else {
        data[clientSecretCol] =
          input.client_secret === null
            ? null
            : encryptString(input.client_secret)
      }
    }
    if (input.webhook_secret !== undefined) {
      if (input.webhook_secret === "") {
        data[webhookSecretCol] = existingCols.webhook_secret_encrypted ?? null
      } else {
        data[webhookSecretCol] =
          input.webhook_secret === null
            ? null
            : encryptString(input.webhook_secret)
      }
    }

    // Verification-Suite-only per-kind toggles. Partial input map — only
    // explicitly-set keys get written; unknown/omitted keys stay as-is.
    if (
      input.product === "verification_suite" &&
      input.verification_kinds !== undefined
    ) {
      const kinds = input.verification_kinds
      if (typeof kinds.pan === "boolean") {
        data.pan_verification_enabled = kinds.pan
      }
      if (typeof kinds.aadhaar === "boolean") {
        data.aadhaar_verification_enabled = kinds.aadhaar
      }
      if (typeof kinds.bank === "boolean") {
        data.bank_verification_enabled = kinds.bank
      }
      if (typeof kinds.cmr === "boolean") {
        data.cmr_verification_enabled = kinds.cmr
      }
    }

    if (existing) {
      await this.updateCashfreeSettings({
        selector: { id: existing.id },
        data,
      })
    } else {
      await this.createCashfreeSettings(data)
    }
    return this.getCashfreeProductView(input.product)
  }

  /** Admin-facing view: all secrets masked, env-fallback indicators set.
   *  Indicators are computed against the ACTIVE env's column set so the UI
   *  reflects the credentials that will actually be used at runtime. */
  async getCashfreeSettingsView(): Promise<CashfreeSettingsView> {
    const row = await this.loadSettingRow()
    const live = await this.resolveLiveCredentials()
    const creds = this.pickEnvCreds(row, live.env)
    const fromDb = (rowVal: string | null | undefined): boolean => !!rowVal
    return {
      env: live.env,
      client_id: live.client_id,
      client_secret_set: !!live.client_secret,
      client_secret_masked: this.maskSecret(live.client_secret),
      payouts_client_id: live.payouts_client_id,
      payouts_client_secret_set: !!live.payouts_client_secret,
      payouts_client_secret_masked: this.maskSecret(live.payouts_client_secret),
      webhook_secret_set: !!live.webhook_secret,
      webhook_secret_masked: this.maskSecret(live.webhook_secret),
      verify_webhook_secret_set: !!live.verify_webhook_secret,
      verify_webhook_secret_masked: this.maskSecret(live.verify_webhook_secret),
      beneficiary_name: live.beneficiary_name,
      updated_at: row?.updated_at ?? null,
      env_fallback_active: {
        client_id: !fromDb(creds.client_id) && !!process.env.CASHFREE_CLIENT_ID,
        client_secret:
          !fromDb(creds.client_secret_encrypted) &&
          !!process.env.CASHFREE_CLIENT_SECRET,
        payouts_client_id:
          !fromDb(creds.payouts_client_id) &&
          !!process.env.CASHFREE_PAYOUTS_CLIENT_ID,
        payouts_client_secret:
          !fromDb(creds.payouts_client_secret_encrypted) &&
          !!process.env.CASHFREE_PAYOUTS_CLIENT_SECRET,
        webhook_secret:
          !fromDb(creds.webhook_secret_encrypted) &&
          !!process.env.CASHFREE_WEBHOOK_SECRET,
        verify_webhook_secret:
          !fromDb(creds.verify_webhook_secret_encrypted) &&
          !!process.env.CASHFREE_VERIFY_WEBHOOK_SECRET,
      },
    }
  }

  /**
   * Upsert the singleton settings row.
   *
   * Convention for partial updates:
   *   - field `undefined`  → leave the existing column alone
   *   - field `""` (empty) → also leave alone (treat the form's blank
   *                          "secret" inputs as "no change")
   *   - field `null`       → explicitly clear the column
   *   - any other value    → set (and encrypt for *_secret fields)
   *
   * `AT_REST_ENCRYPTION_KEY` must be set; encryptString throws otherwise,
   * which we let propagate so the admin sees a clear 500 with the
   * message "AT_REST_ENCRYPTION_KEY env var must be set...".
   */
  async saveCashfreeSettings(
    input: CashfreeSettingsInput
  ): Promise<CashfreeSettingsView> {
    const existing = await this.loadSettingRow()

    // The env that the admin form is editing credentials FOR. Defaults to the
    // row's current active env so a save that only updates e.g. `beneficiary_name`
    // never accidentally rewrites the opposite env's slot.
    const targetEnv: CashfreeEnv = (input.env ??
      (existing?.env as CashfreeEnv | undefined) ??
      "sandbox") as CashfreeEnv
    const prefix = targetEnv // "sandbox" or "production"

    const data: Record<string, unknown> = {
      singleton_key: CashfreeWalletService.SINGLETON_KEY,
    }

    if (input.env !== undefined) data.env = input.env

    // Non-secret IDs are written to the per-env slot for targetEnv. The
    // legacy flat column is left alone — readers fall through to it only when
    // the per-env slot is NULL (pre-migration rows).
    const existingEnv = this.pickEnvCreds(existing, targetEnv)
    const setScalar = (
      suffix: string,
      formField: string | null | undefined,
      existingValue: string | null | undefined
    ) => {
      if (formField === undefined) return
      data[`${prefix}_${suffix}`] =
        formField === ""
          ? existingValue ?? null
          : formField // null passes through as "clear"
    }
    setScalar("client_id", input.client_id, existingEnv.client_id)
    setScalar(
      "payouts_client_id",
      input.payouts_client_id,
      existingEnv.payouts_client_id
    )

    if (input.beneficiary_name !== undefined) {
      data.beneficiary_name =
        input.beneficiary_name === "" ? existing?.beneficiary_name ?? null : input.beneficiary_name
    }
    if (input.updated_by_user_id !== undefined) {
      data.updated_by_user_id = input.updated_by_user_id
    }

    // Secrets: empty-string = leave as-is; null = clear; value = encrypt+set.
    // All writes targeted at the `{prefix}_*_encrypted` columns — the opposite
    // env's secrets are never touched here.
    const setSecret = (
      suffix: string,
      formField: string | null | undefined,
      existingValue: string | null | undefined
    ) => {
      if (formField === undefined) return
      if (formField === "") {
        data[`${prefix}_${suffix}`] = existingValue ?? null
        return
      }
      data[`${prefix}_${suffix}`] =
        formField === null ? null : encryptString(formField)
    }
    setSecret(
      "client_secret_encrypted",
      input.client_secret,
      existingEnv.client_secret_encrypted
    )
    setSecret(
      "payouts_client_secret_encrypted",
      input.payouts_client_secret,
      existingEnv.payouts_client_secret_encrypted
    )
    setSecret(
      "webhook_secret_encrypted",
      input.webhook_secret,
      existingEnv.webhook_secret_encrypted
    )
    setSecret(
      "verify_webhook_secret_encrypted",
      input.verify_webhook_secret,
      existingEnv.verify_webhook_secret_encrypted
    )

    if (existing) {
      await this.updateCashfreeSettings({
        selector: { id: existing.id },
        data,
      })
    } else {
      await this.createCashfreeSettings(data)
    }
    return this.getCashfreeSettingsView()
  }

  /**
   * Build a Cashfree client for the given audience using the live (DB or
   * env) credentials. Throws a typed error if creds are missing — caller
   * decides whether to 500 or degrade gracefully.
   */
  /** Legacy audience-based accessor. Delegates to the product-aware path
   *  via `LEGACY_AUDIENCE_TO_PRODUCT`. */
  async getCashfreeClient(audience: CashfreeAudience): Promise<CashfreeClient> {
    const product = CashfreeWalletService.LEGACY_AUDIENCE_TO_PRODUCT[audience]
    return this.getCashfreeClientForProduct(product)
  }

  /**
   * Resolve the live webhook signing secret for an incoming webhook.
   * Each Cashfree product has its own signing secret configured in the
   * merchant dashboard; we resolve per product. The legacy "vba" channel
   * is serviced by the Payment Gateway product (Auto-Collect is part of PG).
   */
  async getWebhookSecret(
    channel:
      | "vba"
      | "verification"
      | "payouts"
      | "subscriptions"
      | "cross_border"
      | "payment_gateway"
  ): Promise<string | null> {
    const channelToProduct: Record<string, CashfreeProduct> = {
      vba: "payment_gateway",
      payment_gateway: "payment_gateway",
      verification: "verification_suite",
      payouts: "payouts",
      subscriptions: "subscriptions",
      cross_border: "cross_border",
    }
    const product = channelToProduct[channel]
    if (!product) return null
    const live = await this.resolveProductCredentials(product)

    // Cashfree Verification Suite is the odd one out: their webhook
    // signing scheme uses the API client_secret, not a separate
    // dashboard-issued webhook signing secret. See the docs at
    // https://www.cashfree.com/docs/api-reference/vrs/webhook-signature-verification
    // ("Generate an HMAC-SHA256 hash of this string using your
    // client secret"). Payment Gateway / Payouts / etc. DO have a
    // dedicated webhook secret, which is why the DB column exists.
    //
    // For verification, prefer the stored `webhook_secret` if the
    // admin happens to have pasted one (forward-compat in case
    // Cashfree ever introduces a dedicated VRS webhook secret), and
    // otherwise fall through to `client_secret`.
    if (channel === "verification") {
      return live.webhook_secret ?? live.client_secret
    }
    return live.webhook_secret
  }

  /** Pre-bound Secure ID call surface using the live verification client. */
  async getSecureId() {
    const client = await this.getCashfreeClient("verification")
    return {
      verifyPan: (a: Parameters<typeof verifyPan>[1]) => verifyPan(client, a),
      sendAadhaarOtp: (a: Parameters<typeof sendAadhaarOtp>[1]) =>
        sendAadhaarOtp(client, a),
      verifyAadhaarOtp: (a: Parameters<typeof verifyAadhaarOtp>[1]) =>
        verifyAadhaarOtp(client, a),
      pennyDropBank: (a: Parameters<typeof pennyDropBank>[1]) =>
        pennyDropBank(client, a),
      // verifyCmr removed — Cashfree CMR validation no longer in
      // contract. Demat verification is admin-manual. maskAadhaarCard
      // removed 2026-05-04 — see secure-id.ts header for rationale.
    }
  }

  /**
   * @deprecated Old Payouts oneEscrow VBA API. Replaced by Auto Collect
   * (`/pg/vba`) — see `provisionVirtualAccountForBank` below. Kept only so
   * older callers compile while we migrate them.
   */
  async getVbaApi() {
    const client = await this.getCashfreeClient("payouts")
    return {
      create: (a: CreateVbaArgs) => createVirtualAccount(client, a),
      fetch: (id: string) => fetchVirtualAccount(client, id),
      listTransactions: (id: string) => listVirtualAccountTransactions(client, id),
    }
  }

  /** Pre-bound Auto Collect (`/pg/vba`) call surface. Auto-Collect is part
   *  of the Payment Gateway product — same PG app keys, same PG webhook
   *  signing secret. */
  async getAutoCollect() {
    const client = await this.getCashfreeClientForProduct("payment_gateway")
    return {
      createVba: (a: Parameters<typeof createVba>[1]) => createVba(client, a),
      getVba: (id: string) => getVba(client, id),
      updateVba: (id: string, a: Parameters<typeof updateVba>[2]) =>
        updateVba(client, id, a),
      listPayments: (a: Parameters<typeof listVbaPayments>[1]) =>
        listVbaPayments(client, a),
    }
  }

  // ------------------------------------------------------------------
  // PG VBA — one virtual account per CUSTOMER (not per bank)
  // ------------------------------------------------------------------

  /**
   * Provision (or return) the customer's PG VBA. Idempotent — if a VBA
   * row exists for the customer, returns it without calling Cashfree.
   *
   * Per-customer model (changed 2026-05-04):
   *   - One active VBA per customer, regardless of how many verified
   *     banks they have. Bank add/delete no longer creates/destroys
   *     VBAs.
   *   - `virtual_account_id` is the customer's stable
   *     `customer_identity.client_id` (8-char `NNNNYYWW`), passed in
   *     by the route. Fits Cashfree's tightest constraint
   *     (alphanumeric uppercase, ≤ 8 chars).
   *   - `virtual_account_name` is the customer's PAN-verified name —
   *     surfaces as both Cashfree dashboard "Account Holder Name" AND
   *     the storefront "Beneficiary" label.
   *   - `allowed_remitters` IS pushed to Cashfree at create time, and
   *     kept in sync on every bank add/delete via `PUT /pg/vba/{id}`
   *     (see `syncVbaAllowedRemitters` below). The earlier comment
   *     here saying "Cashfree has no update endpoint" was wrong —
   *     `PUT /pg/vba/{id}` mutates `allowed_remitters` without
   *     touching the deposit `vba_account_number` / `vba_ifsc`. The
   *     PAYMENT_SUCCESS_WEBHOOK handler still does belt-and-braces
   *     TPV at deposit time, but the Cashfree-side allowed-remitters
   *     list is now authoritative and live.
   *
   * Caller is expected to have at least one verified bank for this
   * customer before calling — but we don't enforce that here (it's a
   * route-level gate so admin retry paths can exist independently).
   */
  async provisionVirtualAccountForCustomer(args: {
    customer_id: string
    /** From `customer_identity.client_id`. Caller resolves this. */
    client_id: string
    /** PAN-verified full name, used for both Cashfree dashboard
     *  Account Holder Name and storefront Beneficiary display. */
    customer_name: string
    customer_email: string
    customer_phone: string
    /** Customer's `metadata` (`customerModule.retrieveCustomer(...).metadata`).
     *  Optional — when supplied, the wallet service builds the
     *  Cashfree `kyc_details` payload (pan + aadhaar where on file)
     *  and includes it in the create body. Callers that don't pass
     *  it (e.g. legacy paths) get a VBA without kyc — Cashfree
     *  accepts that. */
    customer_metadata?: Record<string, unknown> | null
  }) {
    // Idempotent return — one active VBA per customer.
    const [existing] = await this.listCashfreeVirtualAccounts({
      customer_id: args.customer_id,
      status: "active",
    })
    if (existing) return existing

    // ── Identity-registry reuse path ──────────────────────────────
    //
    // Before paying for a fresh Cashfree VBA mint, check the
    // PAN-anchored identity registry. If this human has already had
    // a VBA provisioned (e.g., they hard-deleted their account and
    // re-registered with the same PAN), we reattach the SAME VBA
    // instead of asking Cashfree for a new one. Same vAccountId,
    // same routable account number, same IFSC — money sent to
    // either the previous or the current customer's wallet by way
    // of this VBA always lands at the human who currently owns the
    // PAN.
    //
    // Skipped when:
    //   - customer_metadata isn't supplied (legacy callers)
    //   - no pan_hash on metadata (PAN verify hasn't run yet)
    //   - registry row exists but has no VBA fields populated yet
    //     (e.g. brand-new PAN being verified now → fall through to
    //     fresh Cashfree mint, then attach to registry below)
    const panHashForRegistry =
      typeof args.customer_metadata?.pan_hash === "string"
        ? (args.customer_metadata.pan_hash as string)
        : null
    const identitySvc = panHashForRegistry
      ? ((this as any).__container__?.resolve?.("customer_identity") ?? null)
      : null
    const registryRow =
      identitySvc && panHashForRegistry
        ? await identitySvc
            .lookupRegistryByPanHash(panHashForRegistry)
            .catch(() => null)
        : null
    if (
      registryRow &&
      registryRow.cashfree_virtual_account_id &&
      registryRow.virtual_account_number &&
      registryRow.ifsc
    ) {
      // Hot reuse — clone the registry's VBA into a fresh
      // cashfree_virtual_account row for this customer. NO Cashfree
      // call. The registry-side `claimForCustomer` already pointed
      // current_customer_id at us during the PAN-verify hop.
      return await this.createCashfreeVirtualAccounts({
        customer_id: args.customer_id,
        bank_account_id: null,
        virtual_account_id: registryRow.cashfree_virtual_account_id,
        virtual_account_number: registryRow.virtual_account_number,
        ifsc: registryRow.ifsc,
        upi_id: registryRow.upi_id ?? null,
        beneficiary_name:
          registryRow.beneficiary_name ?? args.customer_name.trim(),
        bank_code: null,
        status: "active",
        raw: {
          source: "identity_registry_reuse",
          registry_id: registryRow.id,
          first_provisioned_at: registryRow.first_provisioned_at,
          reattach_count: registryRow.reattach_count,
        },
      })
    }

    // virtual_account_id is the customer's permanent client_id; sanity
    // check it matches Cashfree's constraint (alphanumeric uppercase,
    // ≤ 8 chars). client_id is `NNNNYYWW` so always 8 numeric chars.
    const vAccountId = args.client_id.toUpperCase().slice(0, 8)
    if (!/^[A-Z0-9]{4,8}$/.test(vAccountId)) {
      throw new Error(
        `Invalid client_id format for VBA: ${args.client_id}. Expected 4-8 chars of [A-Z0-9].`,
      )
    }

    // Cashfree's 2024-07-10 PG-VBA API requires every VBA to be
    // attached to a named `notification_group` (pre-created on
    // Cashfree dashboard). Reject upfront with a clear admin-facing
    // error if it's not configured.
    const row = await this.loadSettingRow()
    const notificationGroup = (row as any)?.pg_notification_group as
      | string
      | null
    if (!notificationGroup) {
      throw new Error(
        "Cashfree notification group not configured. Open Admin → Cashfree → Payment Gateway, paste the notification-group name (must match Cashfree dashboard → Auto-Collect → Notifications), and save."
      )
    }

    // Two separate names — they do separate jobs (revised 2026-05-04
    // after a conflation bug):
    //
    //   1. cashfreeAccountHolderName — sent to Cashfree as
    //      `virtual_account_name`. Surfaces as Cashfree dashboard
    //      "Account Holder Name" + on the remitter's transfer
    //      confirmation as the beneficiary. MUST be the customer's
    //      PAN-verified legal name (compliance + clarity for ops
    //      auditing the Cashfree dashboard).
    //
    //   2. platformBeneficiary — admin-editable
    //      `cashfree_setting.beneficiary_name`. Drives ONLY the
    //      storefront-rendered beneficiary line, via the override at
    //      `/store/bank-accounts` GET. Lets ops show a friendly
    //      platform name like "Mithtech Innovative Solutions Pvt Ltd"
    //      to the customer without forcing it into Cashfree's account-
    //      holder field.
    //
    // We persist the customer's name into our `beneficiary_name`
    // column too — that's just a sensible default that the
    // storefront override masks anyway.
    const cashfreeAccountHolderName =
      args.customer_name.trim() || "POLEMARCH"

    // Allowed-remitters: at create time we push every currently-
    // verified bank for this customer into Cashfree's
    // `remitter_lock_details.allowed_remitters` so the Cashfree
    // dashboard shows the linked banks under "Get payments from a
    // specific account". Banks added AFTER VBA creation are pushed
    // via `syncVbaAllowedRemitters` (PUT /pg/vba/{id}) — the deposit
    // address stays the same, only the lock list changes. A
    // best-effort failure to decrypt one bank doesn't fail the whole
    // VBA call — we just skip that bank in the lock list. Webhook-
    // time TPV in /webhooks/cashfree/payment-gateway acts as a
    // belt-and-braces second check.
    const allowedRemitters = await this.buildAllowedRemittersForCustomer(
      args.customer_id,
    )

    // Build KYC payload (PAN + Aadhaar where available). Best-effort
    // — if `customer_metadata` wasn't supplied or neither field is
    // on file, we omit the kyc block entirely and Cashfree's create
    // call works without it. Adds the customer's identity to
    // Cashfree's VBA dashboard so a banking-side query about a
    // remitter can be answered without a round-trip through us.
    const kyc = await this.buildKycFromMeta(args.customer_metadata)

    const ac = await this.getAutoCollect()
    const created = await ac.createVba({
      virtual_account_id: vAccountId,
      virtual_account_name: cashfreeAccountHolderName.slice(0, 50),
      virtual_account_email: args.customer_email,
      virtual_account_phone: args.customer_phone,
      // Push verified banks if we have any; otherwise omit the field
      // and Cashfree treats it as "any remitter accepted". The
      // omit-when-empty branch matters because Cashfree may reject a
      // body with `remitter_lock_details: { allowed_remitters: [] }`
      // — empty array is a different signal than missing key.
      ...(allowedRemitters.length > 0
        ? { allowed_remitters: allowedRemitters }
        : {}),
      ...(kyc ? { kyc } : {}),
      // Pin issuing bank to AXIS (UTIB) — the only PG-VBA partner bank
      // Cashfree has activated for our merchant as of 2026-05-04. See
      // commit history (`bank_codes: ["UTIB"]`) for the diagnosis.
      bank_codes: ["UTIB"],
      notification_group: notificationGroup,
    })

    const vbaRow = await this.createCashfreeVirtualAccounts({
      customer_id: args.customer_id,
      // bank_account_id stays nullable in the per-customer model — we
      // no longer key the VBA off a specific bank.
      bank_account_id: null,
      virtual_account_id: created.virtual_account_id || vAccountId,
      virtual_account_number: created.vba_account_number,
      ifsc: created.vba_ifsc,
      upi_id: created.upi_id ?? null,
      // Store the customer's PAN name (same as what we sent to
      // Cashfree as Account Holder Name). The storefront's bank-
      // accounts list endpoint overrides this with the platform-
      // level admin setting at read time, so what's persisted here
      // is just a fallback — never the user-facing display.
      beneficiary_name: cashfreeAccountHolderName,
      bank_code: created.vba_bank_code ?? null,
      status: "active",
      raw: created.raw,
    })

    // ── Identity-registry attach ──────────────────────────────────
    //
    // If we hit this fresh-mint path, the registry was either (a)
    // missing entirely (PAN verify hadn't run yet — rare, since most
    // VBA provisions happen post bank-verify which post-dates PAN
    // verify) or (b) present but with VBA fields still NULL (the
    // first-bank-verify case for a freshly-PAN-verified customer).
    // In case (b) we fill in the VBA fields so the next re-
    // registration with this PAN finds them.
    //
    // Skipped silently when no pan_hash is on metadata; the registry
    // can't be keyed without it. Errors swallowed — VBA mint
    // succeeded, the registry hop is opportunistic.
    if (panHashForRegistry && identitySvc) {
      try {
        await identitySvc.attachVbaToRegistry({
          pan_hash: panHashForRegistry,
          cashfree_virtual_account_id: vbaRow.virtual_account_id,
          virtual_account_number: vbaRow.virtual_account_number,
          ifsc: vbaRow.ifsc,
          beneficiary_name: vbaRow.beneficiary_name,
          upi_id: vbaRow.upi_id,
        })
      } catch {
        /* non-fatal; backfill script can heal later */
      }
    }

    return vbaRow
  }

  /**
   * Build the {account_number, ifsc} list for a customer's currently-
   * verified banks. Decryption failures are logged and skipped so a
   * single bad row doesn't poison the whole list. Same rules used by
   * `provisionVirtualAccountForCustomer` and `syncVbaAllowedRemitters`.
   */
  private async buildAllowedRemittersForCustomer(
    customer_id: string,
  ): Promise<{ account_number: string; ifsc: string }[]> {
    const verifiedBanks = await this.listBankAccounts({
      customer_id,
      verification_status: "verified",
    })
    const out: { account_number: string; ifsc: string }[] = []
    for (const b of verifiedBanks) {
      try {
        const acctNumber = decryptString((b as any).account_number_encrypted)
        if (acctNumber && (b as any).ifsc) {
          out.push({
            account_number: acctNumber,
            ifsc: String((b as any).ifsc).toUpperCase(),
          })
        }
      } catch (decryptErr) {
        // eslint-disable-next-line no-console
        console.warn(
          "buildAllowedRemittersForCustomer: skipped bank (decrypt failed)",
          {
            bank_account_id: (b as any).id,
            error: (decryptErr as Error).message,
          },
        )
      }
    }
    // Dedup on (account, IFSC) — Cashfree rejects duplicate entries.
    const seen = new Set<string>()
    return out.filter((r) => {
      const key = `${r.account_number}|${r.ifsc}`
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
  }

  /**
   * Build the `kyc_details` payload Cashfree's PG-VBA `/pg/vba` endpoint
   * (and the PUT update endpoint) accepts. Returns `{ pan?, aadhaar? }`
   * with whichever fields we actually have on file:
   *
   *   - PAN: from `pan_record.pan_full` (forward-only — pre-2026-05-06
   *     records have null `pan_full` and are filtered out here, with
   *     no follow-up prompt to the customer).
   *   - Aadhaar: from `customer.metadata.aadhaar_full_number` (set by
   *     /store/kyc/aadhaar/otp-verify on a clean auto-pass).
   *
   * Returns `undefined` when neither is available so callers can
   * cleanly omit `kyc` from the create/update args (the auto-collect
   * helpers gate the whole `kyc_details` block on the field being
   * present).
   */
  /**
   * Public — given a customer's `metadata` object (as returned by
   * `customerModule.retrieveCustomer(id).metadata`), assemble the
   * `kyc_details` payload Cashfree's PG-VBA accepts. Callers fetch
   * the customer themselves and pass metadata in; the service
   * stays decoupled from cross-module DI (Medusa v2 module containers
   * are isolated, and the cradle-style accessors aren't reliably
   * resolvable from inside a sibling module's service).
   */
  async buildKycFromMeta(
    meta: Record<string, unknown> | null | undefined,
  ): Promise<{ pan?: string; aadhaar?: string } | undefined> {
    if (!meta) return undefined

    let pan: string | undefined
    const panHash =
      typeof meta.pan_hash === "string" && meta.pan_hash.length > 0
        ? (meta.pan_hash as string)
        : null
    if (panHash) {
      try {
        const [row] = await this.listPanRecords(
          { pan_hash: panHash } as any,
          { take: 1 },
        )
        const full = (row as any)?.pan_full
        if (typeof full === "string" && /^[A-Z]{5}[0-9]{4}[A-Z]$/.test(full)) {
          pan = full
        }
      } catch {
        /* swallow — pan stays undefined */
      }
    }

    let aadhaar: string | undefined
    const aadhaarFull =
      typeof meta.aadhaar_full_number === "string" &&
      /^\d{12}$/.test(meta.aadhaar_full_number)
        ? (meta.aadhaar_full_number as string)
        : null
    if (aadhaarFull) {
      aadhaar = aadhaarFull
    } else {
      // Fallback: look up aadhaar_record by hash (mirrors the PAN
      // path so a customer.metadata reset doesn't blank the KYC
      // payload — the global registry persists).
      const aadhaarHash =
        typeof meta.aadhaar_hash === "string" && meta.aadhaar_hash.length > 0
          ? (meta.aadhaar_hash as string)
          : null
      if (aadhaarHash) {
        try {
          const [row] = await this.listAadhaarRecords(
            { aadhaar_hash: aadhaarHash } as any,
            { take: 1 },
          )
          const full = (row as any)?.aadhaar_full
          if (typeof full === "string" && /^\d{12}$/.test(full)) {
            aadhaar = full
          }
        } catch {
          /* swallow */
        }
      }
    }

    if (!pan && !aadhaar) return undefined
    return {
      ...(pan && { pan }),
      ...(aadhaar && { aadhaar }),
    }
  }

  /**
   * Push the customer's currently-verified bank list to Cashfree as the
   * VBA's `allowed_remitters` via `PUT /pg/vba/{virtual_account_id}`.
   * Idempotent and safe to call on every bank add / delete.
   *
   * Behaviour:
   *  - No active VBA for the customer → noop, returns `null`. We don't
   *    auto-provision here; the bank-add route does that exactly once
   *    (after the FIRST verified bank).
   *  - VBA exists but verified-bank list is empty → call PUT with an
   *    empty `allowed_remitters: []`. Per Cashfree docs (cashfreeVBA.md
   *    §2) this is treated as "fully unlocked" — any remitter
   *    accepted. We rely on webhook TPV as the second-line gate in
   *    that case (and the bank-delete guardrail prevents the customer
   *    from getting here voluntarily).
   *  - Cashfree call fails → we log + rethrow. Caller decides whether
   *    to fail the bank add/delete or continue with eventual-
   *    consistency. Storefront wires this as best-effort (logs but
   *    doesn't block the bank operation, since webhook TPV still
   *    protects funds).
   *
   * Returns the freshly-fetched VBA row from Cashfree on success, or
   * `null` if there's no VBA to update.
   */
  async syncVbaAllowedRemitters(args: {
    customer_id: string
    /** Optional — same role as in `provisionVirtualAccountForCustomer`.
     *  When provided, the PUT body includes `kyc_details` with
     *  whichever of pan/aadhaar are on file. When omitted, kyc isn't
     *  touched on the Cashfree side (Cashfree's PUT merges, doesn't
     *  replace, so an absent kyc on the body leaves the existing
     *  kyc unchanged). */
    customer_metadata?: Record<string, unknown> | null
  }) {
    const [vba] = await this.listCashfreeVirtualAccounts({
      customer_id: args.customer_id,
      status: "active",
    })
    if (!vba) return null

    const [allowedRemitters, desiredKyc] = await Promise.all([
      this.buildAllowedRemittersForCustomer(args.customer_id),
      this.buildKycFromMeta(args.customer_metadata),
    ])

    const ac = await this.getAutoCollect()

    // Diff against Cashfree's current kyc state — their PUT rejects
    // with `400 kyc_details_already_exists` if we re-supply a kyc
    // field that's already populated. So we GET the live VBA, read
    // `raw.kyc_details`, and only forward fields that aren't there
    // yet. If GET fails for any reason, drop the kyc block entirely
    // (the allowed_remitters update is the load-bearing part of the
    // PUT and we don't want a kyc rejection to also fail the lock-
    // list refresh).
    let kycToSend: { pan?: string; aadhaar?: string } | undefined
    if (desiredKyc) {
      try {
        const live = await ac.getVba(vba.virtual_account_id)
        const liveKyc = (((live as any)?.raw?.kyc_details ?? {}) as Record<
          string,
          unknown
        >) ?? {}
        const pruned: { pan?: string; aadhaar?: string } = {}
        if (desiredKyc.pan && !liveKyc.pan) pruned.pan = desiredKyc.pan
        if (desiredKyc.aadhaar && !liveKyc.aadhaar)
          pruned.aadhaar = desiredKyc.aadhaar
        if (Object.keys(pruned).length > 0) kycToSend = pruned
      } catch (e) {
        // eslint-disable-next-line no-console
        console.warn(
          "syncVbaAllowedRemitters: kyc diff lookup failed — sending PUT without kyc",
          {
            virtual_account_id: vba.virtual_account_id,
            error: (e as Error).message,
          },
        )
        kycToSend = undefined
      }
    }

    const updated = await ac.updateVba(vba.virtual_account_id, {
      // Always pass the full list (even if empty). The auto-collect
      // helper translates `[]` into `remitter_lock_details: { allowed_remitters: [] }`
      // which Cashfree treats as "unlock". If Cashfree tightens this
      // and rejects empty arrays, we'd need to switch to PATCH-style
      // omit-on-empty here.
      allowed_remitters: allowedRemitters,
      ...(kycToSend ? { kyc: kycToSend } : {}),
    })

    // Mirror the new raw blob into our DB so the admin "Virtual
    // account" panel and any reconciliation surface can read the
    // last-known live state without re-hitting Cashfree.
    try {
      await this.updateCashfreeVirtualAccounts({
        id: (vba as any).id,
        raw: updated.raw,
      })
    } catch (e) {
      // eslint-disable-next-line no-console
      console.warn("syncVbaAllowedRemitters: failed to persist updated VBA raw", {
        vba_id: (vba as any).id,
        error: (e as Error).message,
      })
    }

    return updated
  }

  /**
   * Manual "pull recent deposits from Cashfree and credit any we
   * haven't already booked." Customer-driven fallback for the case
   * where the Cashfree webhook didn't fire (transient network blip,
   * missing webhook secret, our server down at delivery time).
   *
   * Same idempotency + TPV semantics as the webhook handler — every
   * payment we apply is keyed on a stable `cashfree_event_id`, so
   * the webhook and this method can race without double-crediting.
   *
   * Window: last 24h of SUCCESS-status payments. The webhook is the
   * primary path (sub-second on a good day); this is a safety net,
   * not a back-fill tool, so 24h covers the realistic blast radius
   * without burning API quota.
   *
   * Returns a per-payment outcome list so the caller can fire
   * `wallet.deposit_credited` emails on each fresh credit and surface
   * a summary in the response.
   */
  async syncCustomerVbaPayments(customer_id: string): Promise<{
    new_credits: Array<{
      transaction_id: string
      amount_inr: number
      utr: string | null
      remitter_name: string | null
      virtual_account_id: string
    }>
    duplicates: number
    tpv_failures: number
    orphaned: number
    /** PENDING transfers — Cashfree saw the bank's intent but the
     *  settlement batch hasn't cleared. Surface in UI as "transfer
     *  in flight, check back in a few minutes". */
    pending_count: number
    /** Bank rejected the transfer (NEFT bounce, name-mismatch flag,
     *  cooling-period, etc.). Customer needs to retry / contact bank. */
    rejected_count: number
    new_balance_inr: number
  }> {
    const [vba] = await this.listCashfreeVirtualAccounts({
      customer_id,
      status: "active",
    })
    if (!vba) {
      throw new Error("no_active_vba")
    }

    // 7-day window (widened from 24h on 2026-05-08). NEFT settlement
    // batches plus customer "I sent it yesterday" reports were the
    // common pattern — a tighter window meant ops had to manually
    // open Cashfree's dashboard, which defeats the purpose of the
    // self-service sync. 7 days is still cheap (≤ 50 payments per
    // VBA in steady state) and covers any reasonable settlement
    // delay. Cashfree's API expects "YYYY-MM-DD HH:MM:SS" (UTC);
    // ISO with the 'T' / millis stripped does the job.
    const fmtCashfreeDate = (d: Date) =>
      d.toISOString().replace("T", " ").replace(/\..*$/, "")
    const now = new Date()
    const start = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000)

    const ac = await this.getAutoCollect()
    // Status "ALL" surfaces SUCCESS, PENDING, and REJECTED in one
    // pass; the per-payment loop below filters on `txstatus` so we
    // only credit SUCCESS rows. PENDING / REJECTED are still useful
    // for ops to see in the report (returned in the response so
    // admins can spot a held transfer that hasn't cleared yet).
    const { payments } = await ac.listPayments({
      status: "ALL",
      virtual_account_id: vba.virtual_account_id,
      start_date: fmtCashfreeDate(start),
      end_date: fmtCashfreeDate(now),
      pagination: { limit: 200 },
    })

    // Pre-load verified banks once for TPV — avoids N+1 in the loop.
    const verifiedBanks = await this.listBankAccounts({
      customer_id,
      verification_status: "verified",
    })

    const new_credits: Array<{
      transaction_id: string
      amount_inr: number
      utr: string | null
      remitter_name: string | null
      virtual_account_id: string
    }> = []
    let duplicates = 0
    let tpv_failures = 0
    let orphaned = 0
    let pending_count = 0
    let rejected_count = 0

    for (const p of payments) {
      // Status filter — listPayments now uses status="ALL" so the
      // response can contain SUCCESS / PENDING / REJECTED. Only
      // SUCCESS rows are eligible to credit; PENDING (NEFT batch
      // not yet settled) and REJECTED (bank bounced the transfer)
      // are surfaced in the response so ops can see "transfer is
      // in flight" / "bank rejected, customer needs to retry".
      const txstatus = String(p.txstatus ?? "").toUpperCase()
      if (txstatus === "PENDING") {
        pending_count++
        continue
      }
      if (txstatus === "REJECTED" || txstatus === "FAILED") {
        rejected_count++
        continue
      }
      if (txstatus && txstatus !== "SUCCESS") {
        continue
      }

      // Same event-id derivation as the webhook handler. cf_payment_id
      // (2025-01-01) → reference_id → credit_ref_number → utr →
      // composite. The webhook's writes use this same shape, so the
      // unique constraint on `cashfree_webhook_event.event_id` makes
      // the two paths share dedup state.
      const rawAny = p.raw as Record<string, unknown>
      const eventId =
        (rawAny.cf_payment_id as string | undefined) ??
        p.reference_id ??
        p.credit_ref_number ??
        p.utr ??
        `vba_${vba.virtual_account_id}_${p.amount}_${p.txtime ?? Date.now()}`

      // Pre-check: if the event_id already exists in the webhook log
      // OR has already credited the wallet, skip. We probe BEFORE
      // attempting an insert because the wallet_transaction is keyed
      // separately on `cashfree_event_id` — a row can exist there
      // (from the webhook) without a webhook_event row, in the rare
      // case the event-row write failed but the credit succeeded.
      const existingTxs = await this.listWalletTransactions(
        { cashfree_event_id: String(eventId) } as any,
        { take: 1 },
      ).catch(() => [] as any[])
      if ((existingTxs as any[]).length > 0) {
        duplicates++
        continue
      }

      // Best-effort webhook_event insert for audit visibility. If the
      // unique constraint trips, the webhook handler is concurrently
      // processing the same payment; treat as duplicate.
      try {
        await this.createWebhookEvents({
          channel: "vba",
          event_id: String(eventId),
          event_type: "MANUAL_SYNC",
          signature: null,
          payload_raw: rawAny,
          processing_status: "processing",
        })
      } catch (err) {
        const e = err as { code?: string | number; cause?: { code?: string } }
        if (
          e?.code === "23505" ||
          e?.cause?.code === "23505" ||
          /unique|duplicate/i.test(String((err as Error)?.message ?? ""))
        ) {
          duplicates++
          continue
        }
        throw err
      }

      // TPV — same rule as the webhook handler. Match
      // (remitter_last4, remitter_ifsc) against the customer's
      // verified banks. Cashfree's listPayments response carries
      // `remitter_account` (full or partially-masked) and
      // sometimes `remitter_ifsc` in raw; we read both.
      const remitterRaw = String(p.remitter_account ?? "").replace(/\s+/g, "")
      const remitterLast4 = remitterRaw.slice(-4)
      const remitterIfsc = String(
        (rawAny.remitter_ifsc as string | undefined) ?? "",
      )
        .trim()
        .toUpperCase()
      const matched = (verifiedBanks as any[]).some((b) => {
        const sameLast4 = String(b.account_number_last4) === remitterLast4
        const sameIfsc = remitterIfsc
          ? String(b.ifsc ?? "").toUpperCase() === remitterIfsc
          : true
        return sameLast4 && sameIfsc
      })
      if (!matched) {
        tpv_failures++
        await this.updateWebhookEvents({
          selector: { event_id: String(eventId) },
          data: {
            processing_status: "failed",
            processing_error: `tpv_failed: ${remitterLast4}@${remitterIfsc || "??"}`,
            processed_at: new Date(),
          },
        }).catch(() => {})
        continue
      }

      // Apply credit (idempotent at the wallet_transaction level via
      // `cashfree_event_id`).
      try {
        const tx = await this.applyVbaCredit({
          virtual_account_id: vba.virtual_account_id,
          amount_inr: Math.round(p.amount * 100),
          cashfree_event_id: String(eventId),
          utr: p.utr ?? null,
          remitter_name: p.remitter_name ?? null,
          remitter_account_number: p.remitter_account ?? null,
        })

        if (tx) {
          new_credits.push({
            transaction_id: tx.id,
            amount_inr: Math.round(p.amount * 100),
            utr: p.utr ?? null,
            remitter_name: p.remitter_name ?? null,
            virtual_account_id: vba.virtual_account_id,
          })
          await this.updateWebhookEvents({
            selector: { event_id: String(eventId) },
            data: {
              processing_status: "processed",
              processing_error: null,
              processed_at: new Date(),
            },
          }).catch(() => {})
          // Drain held attempts (best-effort).
          await this.captureHeldPaymentAttempts(tx.customer_id).catch(() => {})
        } else {
          // Same VBA → null only when the locked-bank check rejects;
          // shouldn't happen for the customer's own VBA, but bookkeep.
          orphaned++
          await this.updateWebhookEvents({
            selector: { event_id: String(eventId) },
            data: {
              processing_status: "failed",
              processing_error: "unknown_virtual_account_id_or_locked_bank",
              processed_at: new Date(),
            },
          }).catch(() => {})
        }
      } catch (err) {
        await this.updateWebhookEvents({
          selector: { event_id: String(eventId) },
          data: {
            processing_status: "failed",
            processing_error: ((err as Error)?.message ?? "unknown").slice(0, 500),
            processed_at: new Date(),
          },
        }).catch(() => {})
        throw err
      }
    }

    const wallet = await this.ensureWallet(customer_id)
    return {
      new_credits,
      duplicates,
      tpv_failures,
      orphaned,
      pending_count,
      rejected_count,
      new_balance_inr: wallet.balance_inr,
    }
  }

  /**
   * Wallet snapshot used by `GET /store/wallet`: balance + every VBA the
   * customer has (one per linked bank), each annotated with the source
   * bank's display fields so the storefront can show "Bank A → VBA X,
   * Bank B → VBA Y" together.
   */
  async getWalletSummary(customer_id: string) {
    const wallet = await this.ensureWallet(customer_id)
    const vbas = await this.listCashfreeVirtualAccounts({
      customer_id,
      status: "active",
    })
    const banksById = new Map<
      string,
      Awaited<ReturnType<this["retrieveBankAccount"]>> | null
    >()
    for (const v of vbas) {
      if (v.bank_account_id && !banksById.has(v.bank_account_id)) {
        banksById.set(
          v.bank_account_id,
          await this.retrieveBankAccount(v.bank_account_id).catch(() => null)
        )
      }
    }

    return {
      customer_id,
      balance_inr: Number(wallet.balance_inr),
      /** Non-withdrawable bucket. Funded by referrals + points
       *  conversion. Storefront renders this alongside the main
       *  balance under a single "Wallet" surface. */
      promo_balance_inr: Number(wallet.promo_balance_inr ?? 0),
      status: wallet.status,
      virtual_accounts: vbas.map((v) => {
        const bank = v.bank_account_id ? banksById.get(v.bank_account_id) : null
        return {
          id: v.id,
          virtual_account_number: v.virtual_account_number,
          ifsc: v.ifsc,
          upi_id: v.upi_id,
          beneficiary_name: v.beneficiary_name,
          bank_code: v.bank_code,
          source_bank: bank
            ? {
                id: bank.id,
                bank_name: bank.bank_name,
                account_number_last4: bank.account_number_last4,
                ifsc: bank.ifsc,
                account_holder_name: bank.account_holder_name,
              }
            : null,
        }
      }),
    }
  }

  /**
   * Process an AMOUNT_COLLECTED webhook for one of our VBAs. Resolves the
   * customer from the VBA, sanity-checks the remitter against the linked
   * bank (Cashfree should already have rejected mismatched senders via
   * `allowed_remitters`, but we guard defensively), and credits the
   * wallet. Idempotent.
   *
   * Returns null when:
   *   - the `virtual_account_id` is unknown (orphaned settlement), or
   *   - the remitter doesn't match the linked bank (rejected; logged)
   */

  /**
   * AML / PMLA pre-check — how many OTHER customers have a verified
   * bank with this exact fingerprint (`IFSC + account_last4`)?
   *
   * Used at `POST /store/bank-accounts` before the Cashfree penny drop
   * so we catch a fraud pattern (one bank, many Polemarch accounts)
   * without burning a Cashfree API call. Legitimate retail customers
   * don't share bank accounts across platform accounts; if a family
   * pair genuinely does, ops can white-list via the admin API.
   */
  async countVerifiedBankAccountsByFingerprint(args: {
    ifsc: string
    account_number_last4: string
    /** Exclude this customer's own banks from the count — we're only
     *  trying to flag OTHER accounts that share the same fingerprint. */
    exclude_customer_id?: string
  }): Promise<number> {
    const matches = await this.listBankAccounts({
      ifsc: args.ifsc,
      account_number_last4: args.account_number_last4,
      verification_status: "verified",
    })
    const customers = new Set<string>()
    for (const m of matches) {
      if (!m.customer_id) continue
      if (args.exclude_customer_id && m.customer_id === args.exclude_customer_id) continue
      customers.add(m.customer_id)
    }
    return customers.size
  }

  /**
   * Count OTHER customers who already have this demat fingerprint on
   * file in any non-failed state. Mirrors the bank version — used to
   * gate `/store/demat-accounts` POST against cross-customer reuse
   * (one demat = one Polemarch account). The fingerprint is the
   * (depository, boid) pair for CDSL or (depository, dp_id, client_id)
   * for NSDL — DP-ID + Client-ID together uniquely identify an NSDL
   * account, BOID alone uniquely identifies a CDSL account.
   *
   * We include `pending` and `name_mismatch` rows in the count, not
   * just `verified`, because two customers can't legitimately have
   * mid-air verifications for the same depository account; whichever
   * one finished first owns it.
   */
  async countDematAccountsByFingerprint(args: {
    depository: "CDSL" | "NSDL"
    boid?: string | null
    dp_id?: string | null
    client_id?: string | null
    exclude_customer_id?: string
  }): Promise<number> {
    const filter: Record<string, unknown> = {
      depository: args.depository,
    }
    if (args.depository === "CDSL") {
      if (!args.boid) return 0
      filter.boid = args.boid
    } else {
      if (!args.dp_id || !args.client_id) return 0
      filter.dp_id = args.dp_id
      filter.client_id = args.client_id
    }
    const matches = await this.listDematAccounts(filter as any)
    const customers = new Set<string>()
    for (const m of matches as any[]) {
      if (!m.customer_id) continue
      if (m.verification_status === "failed") continue
      if (args.exclude_customer_id && m.customer_id === args.exclude_customer_id) continue
      customers.add(m.customer_id)
    }
    return customers.size
  }

  async applyVbaCredit(args: {
    virtual_account_id: string
    amount_inr: number
    cashfree_event_id: string
    utr?: string | null
    remitter_name?: string | null
    remitter_account_number?: string | null
  }) {
    const [vba] = await this.listCashfreeVirtualAccounts(
      { virtual_account_id: args.virtual_account_id },
      { take: 1 }
    )
    if (!vba) return null

    // Defensive sender-match: if the VBA is locked to a bank, confirm the
    // remitter matches. Compare on last4 since incoming webhook payload
    // typically masks the full number; we have last4 on record anyway.
    if (vba.bank_account_id) {
      const bank = await this.retrieveBankAccount(vba.bank_account_id).catch(
        () => null
      )
      if (bank && args.remitter_account_number) {
        const incoming = args.remitter_account_number.replace(/\s+/g, "")
        const incomingLast4 = incoming.slice(-4)
        if (
          incomingLast4 &&
          bank.account_number_last4 &&
          incomingLast4 !== bank.account_number_last4
        ) {
          // Don't credit — record under metadata for triage. Returning
          // null lets the webhook handler mark the WebhookEvent as
          // failed with a clear reason.
          return null
        }
      }
    }

    return await this.credit({
      customer_id: vba.customer_id,
      amount_inr: args.amount_inr,
      kind: "vba_credit",
      reference_type: "vba_event",
      reference_id: args.utr ?? args.cashfree_event_id,
      cashfree_event_id: args.cashfree_event_id,
      idempotency_key: `vba_${args.cashfree_event_id}`,
      note: args.remitter_name
        ? `from ${args.remitter_name}${args.utr ? ` UTR ${args.utr}` : ""}`
        : args.utr
          ? `UTR ${args.utr}`
          : null,
      metadata: {
        bank_account_id: vba.bank_account_id ?? null,
        remitter_account_number: args.remitter_account_number ?? null,
        remitter_name: args.remitter_name ?? null,
        utr: args.utr ?? null,
      },
    })
  }

  /**
   * Drain held PaymentAttempts for a customer in FIFO order. For each
   * attempt where the wallet now covers the amount, perform the debit and
   * mark it captured.
   *
   * Returns a list of captured attempt ids so callers (e.g. the VBA
   * webhook + a future Medusa-order-capture workflow) can propagate the
   * state change to the Order.
   *
   * Safe to call on every VBA credit — runs cheaply when no attempts are
   * pending. Idempotent per attempt via the existing debit idempotency
   * key (`attempt_<id>`).
   */
  async captureHeldPaymentAttempts(customer_id: string): Promise<
    Array<{ attempt_id: string; order_id: string | null; tx_id: string }>
  > {
    // Both conditions have to be true before we debit a held attempt:
    //   1. Wallet covers the amount (FIFO-stoppable)
    //   2. KYC is approved (independent — if KYC isn't done, we can't capture
    //      at all even if funds are there; share delivery is gated on both)
    const kyc = await this.getKycStatus(customer_id)
    if (kyc.overall !== "approved") {
      // Nothing to drain until KYC lands. A later trigger (KYC approval
      // workflow in phase 12/13) will call this function again.
      return []
    }

    const held = await this.listPaymentAttempts(
      { customer_id, status: "held" },
      { order: { created_at: "ASC" } as any, take: 50 }
    )
    const captured: Array<{
      attempt_id: string
      order_id: string | null
      tx_id: string
    }> = []
    for (const attempt of held) {
      const wallet = await this.ensureWallet(customer_id)
      // Combined-funds check across both buckets, mirroring the
      // wallet provider's authorize logic. Promo drains first
      // (capped per-tx), main covers the rest.
      //
      // We don't have direct access to the Cart module here (this is
      // the wallet service, not the payment provider), so we use the
      // attempt's gross amount as the subtotal proxy. This slightly
      // OVER-reports the cap by the fee-portion; acceptable tradeoff
      // for the auto-drain happy path. The exact cap is enforced at
      // ledger-write time by `debitForOrder`, so a too-generous cap
      // here just means we attempt the debit; the service still
      // bounds the actual promo drain to `min(promo, cap)`.
      const promoCap = await this.getPromoCapForCart(attempt.amount_inr)
      const promoUsable = Math.min(
        Number(wallet.promo_balance_inr ?? 0),
        promoCap,
      )
      // Respect the customer's promo-spend choice stored at init.
      // Falls back to drain-max for pre-override attempts (NULL column).
      const promoOverride =
        (attempt as { promo_amount_override_inr?: number | null })
          ?.promo_amount_override_inr ?? null
      const promoCommitted =
        promoOverride == null ? promoUsable : Math.min(promoOverride, promoUsable)
      const combinedAvailable = Number(wallet.balance_inr) + promoCommitted
      if (combinedAvailable < attempt.amount_inr) break // FIFO stop on first unfunded
      const debit = await this.debitForOrder({
        customer_id,
        amount_inr: attempt.amount_inr,
        cart_subtotal_inr: attempt.amount_inr, // see comment above
        reference_type: "cart",
        reference_id: attempt.cart_id,
        idempotency_key: `attempt_${attempt.id}`,
        note: `auto-capture held attempt ${attempt.id}`,
        promo_override_inr: promoOverride,
      })
      if (debit.ok !== true) break
      const canonicalTxId =
        debit.main_transaction_id ?? debit.promo_transaction_id ?? ""
      await this.updatePaymentAttempts({
        selector: { id: attempt.id },
        data: {
          status: "captured",
          wallet_debit_tx_id: canonicalTxId,
          shortfall_inr: 0,
        },
      })
      // Promote the linked HeldOrder (if any) to captured.
      if (attempt.held_order_id) {
        await this.updateHeldOrders({
          selector: { id: attempt.held_order_id },
          data: { status: "captured", captured_at: new Date() },
        }).catch(() => {})
      }
      captured.push({
        attempt_id: attempt.id,
        order_id: attempt.held_order_id ?? null,
        tx_id: canonicalTxId,
      })
    }
    return captured
  }

  /* ---------------------------------------------------------------- *
   *  Referral helpers
   * ---------------------------------------------------------------- */

  private static REFERRAL_CODE_LEN = 8

  /** Generate a random 8-char uppercase alphanumeric code. */
  private generateCode(): string {
    const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789" // no 0/O/1/I to avoid confusion
    let code = ""
    const bytes = new Uint8Array(CashfreeWalletService.REFERRAL_CODE_LEN)
    globalThis.crypto.getRandomValues(bytes)
    for (const b of bytes) code += chars[b % chars.length]
    return code
  }

  /**
   * Return the referral code for a customer, creating one if none exists.
   * Idempotent — subsequent calls return the same code.
   */
  async ensureReferralCode(customer_id: string): Promise<string> {
    const [existing] = await this.listReferrals(
      { referrer_customer_id: customer_id, referred_customer_id: null },
      { take: 1 }
    )
    if (existing) return existing.code

    // Snapshot current admin-configured rewards onto the auto-generated
    // template row so the DB reflects the live programme rates. Apply
    // path also stamps the row when a referee redeems — at that point
    // the template's snapshot is overwritten by the per-redemption
    // snapshot. Both paths now keep the new `referrer_reward_inr` /
    // `referee_reward_inr` columns populated; pre-2026-05-08 rows that
    // sit at 0/0 are still served correctly via the read-side fallback
    // in `referralStats` (it falls back to current settings).
    const settings = await this.getReferralSettings()

    // Generate a unique code (retry on collision — astronomically unlikely
    // with 32^8 = ~1 trillion codes, but defensive).
    for (let i = 0; i < 5; i++) {
      const code = this.generateCode()
      try {
        await this.createReferrals({
          referrer_customer_id: customer_id,
          referred_customer_id: null,
          code,
          status: "pending",
          reward_amount_inr: settings.refereeRewardInr,
          referrer_reward_inr: settings.referrerRewardInr,
          referee_reward_inr: settings.refereeRewardInr,
        })
        return code
      } catch {
        // unique constraint collision — retry with a fresh code
      }
    }
    throw new Error("referral_code_generation_failed")
  }

  /** Referral stats for a customer's dashboard card. */
  async referralStats(customer_id: string) {
    const code = await this.ensureReferralCode(customer_id)
    const settings = await this.getReferralSettings()
    const all = await this.listReferrals(
      { referrer_customer_id: customer_id },
      { take: 200 }
    )
    const withReferred = all.filter((r: any) => r.referred_customer_id)
    const credited = withReferred.filter((r: any) => r.status === "credited")
    const pending = withReferred.filter((r: any) => r.status === "pending")

    // Also check if this customer was referred by someone
    const [myReferral] = await this.listReferrals(
      { referred_customer_id: customer_id },
      { take: 1 }
    )

    // Hydrate per-referee cumulative lifetime buy on demand. This is
    // what the referrer side gates on (≥ settings.minPurchaseInr) so
    // the storefront needs the running total to render the progress
    // bar. Computed fresh from order data — no denormalised column to
    // drift. Bounded by per-referrer referee count (typically <20).
    const refereeIds = new Set<string>()
    for (const r of withReferred as any[]) {
      if (r.referred_customer_id) refereeIds.add(r.referred_customer_id)
    }
    if (myReferral?.referred_customer_id) {
      refereeIds.add((myReferral as any).referred_customer_id)
    }
    const lifetimeBuyByCustomer = new Map<string, number>()
    await Promise.all(
      Array.from(refereeIds).map(async (id) => {
        try {
          lifetimeBuyByCustomer.set(id, await this.computeLifetimeBuyInr(id))
        } catch {
          lifetimeBuyByCustomer.set(id, 0)
        }
      }),
    )

    const refRow = (r: any) => {
      const referrerReward = Number(
        r.referrer_reward_inr ?? r.reward_amount_inr ?? settings.referrerRewardInr,
      )
      const refereeReward = Number(
        r.referee_reward_inr ?? r.reward_amount_inr ?? settings.refereeRewardInr,
      )
      return {
        id: r.id,
        referrer_customer_id: r.referrer_customer_id,
        referred_customer_id: r.referred_customer_id,
        status: r.status,
        referrer_reward_inr: referrerReward,
        referee_reward_inr: refereeReward,
        first_order_subtotal_inr: r.first_order_subtotal_inr ?? null,
        /**
         * Cumulative item-subtotal (₹) across every non-cancelled order
         * this referee has placed. Used by the storefront to render
         * the progress bar against `min_purchase_inr` (the cumulative-
         * buy threshold the REFERRER credit gates on).
         */
        cumulative_buy_inr:
          lifetimeBuyByCustomer.get(r.referred_customer_id) ?? 0,
        min_purchase_inr: settings.minPurchaseInr,
        created_at: r.created_at,
        first_trade_at: r.first_trade_at ?? null,
        /**
         * Set when the REFEREE bonus was credited (KYC overall='approved').
         * Independent of `credited_at`, which now strictly tracks the
         * REFERRER credit (cumulative-buy threshold met).
         */
        referee_credited_at: r.referee_credited_at ?? null,
        credited_at: r.credited_at ?? null,
        reversed_at: r.reversed_at ?? null,
      }
    }

    return {
      code,
      program_enabled: settings.enabled,
      min_purchase_inr: settings.minPurchaseInr,
      referrer_reward_inr: settings.referrerRewardInr,
      referee_reward_inr: settings.refereeRewardInr,
      total_referred: withReferred.length,
      total_credited: credited.length,
      total_pending: pending.length,
      total_earned: credited.reduce(
        (sum: number, r: any) =>
          sum +
          Number(
            r.referrer_reward_inr ?? r.reward_amount_inr ?? settings.referrerRewardInr,
          ),
        0,
      ),
      referrals: withReferred.map(refRow),
      // My referral status (as the referred party)
      my_referral: myReferral ? refRow(myReferral) : null,
    }
  }

  // ─── Referral settings helpers ──────────────────────────────────

  /** Read referral programme settings from the CashfreeSetting singleton.
   *
   *  Model:
   *    - One global min-purchase threshold (`referral_min_purchase_inr`).
   *      The referee's order subtotal is compared against this and
   *      gates BOTH sides simultaneously. The referrer doesn't make
   *      a triggering purchase — referee's spend is the only signal.
   *    - Per-side reward amount can vary (referrer gets ₹X, referee
   *      gets ₹Y).
   *    - Per-side bucket (main / promo) can vary.
   *
   *  Two columns named `referral_referrer_min_purchase_inr` and
   *  `referral_referee_min_purchase_inr` exist on the table from an
   *  earlier model that gated each side separately; they're now
   *  unused. Left in place so dropping them doesn't require a
   *  destructive migration on a live database. */
  async getReferralSettings(): Promise<{
    enabled: boolean
    rewardAmountInr: number
    /** Single min-purchase threshold — the referee's order subtotal
     *  must clear this for BOTH sides to credit. */
    minPurchaseInr: number
    referrerRewardInr: number
    refereeRewardInr: number
    /** Per-side bucket — 'main' (withdrawable) or 'promo'. Default
     *  'promo' (incentive-style). */
    referrerCreditBucket: "main" | "promo"
    refereeCreditBucket: "main" | "promo"
  }> {
    const row = await this.loadSettingRow()
    const legacy = Number((row as any)?.referral_reward_amount_inr ?? 250)
    const referrerReward = Number(
      (row as any)?.referral_referrer_reward_inr ?? legacy,
    )
    const refereeReward = Number(
      (row as any)?.referral_referee_reward_inr ?? legacy,
    )
    // Semantic shifted 2026-05-15: this field used to mean "minimum
    // single-order subtotal that triggers BOTH credits". It now means
    // "cumulative lifetime buy threshold the referee must cross before
    // the REFERRER side credits". The referee side fires on KYC
    // completion (independent of any purchase). Default bumped
    // ₹1 000 → ₹10 000 per the May-2026 product spec; existing rows
    // with an admin-set value keep that value untouched.
    const minPurchase = Number((row as any)?.referral_min_purchase_inr ?? 10_000)
    return {
      enabled: (row as any)?.referral_enabled ?? true,
      rewardAmountInr: refereeReward,
      minPurchaseInr: minPurchase,
      referrerRewardInr: referrerReward,
      refereeRewardInr: refereeReward,
      referrerCreditBucket:
        ((row as any)?.referrer_credit_bucket as "main" | "promo") ?? "promo",
      refereeCreditBucket:
        ((row as any)?.referee_credit_bucket as "main" | "promo") ?? "promo",
    }
  }

  // ── Platform processing fee ──────────────────────────────────────
  // Returned to the storefront via GET /store/fees (unauthenticated —
  // safe, only exposes the %-rate) and edited via POST /admin/fees.
  // Stored as a decimal (0.02 = 2%); the admin-facing API translates
  // to/from whole-percent for UI friendliness.

  async getProcessingFeeSettings(): Promise<{
    enabled: boolean
    rate: number
    /** Optional per-scrip cap in whole ₹. NULL = no cap. */
    max_inr: number | null
  }> {
    const row = await this.loadSettingRow()
    const rawEnabled = (row as any)?.processing_fee_enabled
    const rawRate = (row as any)?.processing_fee_rate
    const rawMax = (row as any)?.processing_fee_max_inr
    // Prisma may return numeric columns as strings depending on driver.
    const rate =
      typeof rawRate === "string" ? parseFloat(rawRate) : (rawRate as number)
    const maxParsed =
      typeof rawMax === "string" ? parseInt(rawMax, 10) : (rawMax as number)
    return {
      // default true for new installs — matches prior hard-coded behaviour
      enabled: rawEnabled === undefined || rawEnabled === null ? true : !!rawEnabled,
      rate: Number.isFinite(rate) ? rate : 0.02,
      max_inr:
        rawMax === undefined || rawMax === null || !Number.isFinite(maxParsed)
          ? null
          : Math.max(0, Math.trunc(maxParsed)),
    }
  }

  /** Admin: update processing-fee settings. Accepts either a decimal
   *  (0-1) or a percent (1-100); the route layer normalises to decimal
   *  before calling here. `max_inr` is the optional per-scrip cap in
   *  whole ₹ — pass `null` to clear the cap, `0` to effectively disable
   *  the fee while leaving the rate intact for later. */
  async saveProcessingFeeSettings(input: {
    enabled?: boolean
    rate?: number
    max_inr?: number | null
  }) {
    const row = await this.loadSettingRow()
    const data: Record<string, unknown> = {}
    if (input.enabled !== undefined) data.processing_fee_enabled = input.enabled
    if (input.rate !== undefined) {
      if (!Number.isFinite(input.rate) || input.rate < 0 || input.rate > 1) {
        throw new Error(
          `processing fee rate must be a decimal between 0 and 1 (e.g. 0.02 for 2%)`
        )
      }
      data.processing_fee_rate = input.rate
    }
    if (input.max_inr !== undefined) {
      if (input.max_inr === null) {
        data.processing_fee_max_inr = null
      } else if (
        !Number.isFinite(input.max_inr) ||
        input.max_inr < 0 ||
        input.max_inr > 100_000_000
      ) {
        throw new Error(
          `processing fee max_inr must be a non-negative integer ≤ 100,000,000 (or null to clear the cap)`,
        )
      } else {
        data.processing_fee_max_inr = Math.trunc(input.max_inr)
      }
    }
    if (row) {
      await this.updateCashfreeSettings({ id: row.id, ...data })
    } else {
      await this.createCashfreeSettings({ singleton_key: "default", ...data })
    }
    return this.getProcessingFeeSettings()
  }

  // ── Low-quantity flat fee ───────────────────────────────────────
  // Same shape as the processing-fee helpers: GET returns the live
  // values, POST normalises and persists. Storefront cart adds this
  // flat ₹ amount when the line-item subtotal is below threshold.

  async getLowQtyFeeSettings(): Promise<{
    enabled: boolean
    threshold_inr: number
    amount_inr: number
  }> {
    const row = await this.loadSettingRow()
    const rawEnabled = (row as any)?.low_qty_fee_enabled
    const rawThreshold = (row as any)?.low_qty_fee_threshold_inr
    const rawAmount = (row as any)?.low_qty_fee_amount_inr
    const threshold =
      typeof rawThreshold === "string"
        ? parseInt(rawThreshold, 10)
        : (rawThreshold as number)
    const amount =
      typeof rawAmount === "string"
        ? parseInt(rawAmount, 10)
        : (rawAmount as number)
    return {
      // default true to match prior hard-coded behaviour
      enabled:
        rawEnabled === undefined || rawEnabled === null ? true : !!rawEnabled,
      threshold_inr: Number.isFinite(threshold) ? threshold : 10000,
      amount_inr: Number.isFinite(amount) ? amount : 250,
    }
  }

  /** Admin: update low-qty-fee settings. Inputs in whole ₹. */
  async saveLowQtyFeeSettings(input: {
    enabled?: boolean
    threshold_inr?: number
    amount_inr?: number
  }) {
    const row = await this.loadSettingRow()
    const data: Record<string, unknown> = {}
    if (input.enabled !== undefined) data.low_qty_fee_enabled = input.enabled
    if (input.threshold_inr !== undefined) {
      if (
        !Number.isFinite(input.threshold_inr) ||
        input.threshold_inr < 0 ||
        !Number.isInteger(input.threshold_inr)
      ) {
        throw new Error(
          "low_qty_fee_threshold_inr must be a non-negative integer (whole ₹)"
        )
      }
      data.low_qty_fee_threshold_inr = input.threshold_inr
    }
    if (input.amount_inr !== undefined) {
      if (
        !Number.isFinite(input.amount_inr) ||
        input.amount_inr < 0 ||
        !Number.isInteger(input.amount_inr)
      ) {
        throw new Error(
          "low_qty_fee_amount_inr must be a non-negative integer (whole ₹)"
        )
      }
      data.low_qty_fee_amount_inr = input.amount_inr
    }
    if (row) {
      await this.updateCashfreeSettings({ id: row.id, ...data })
    } else {
      await this.createCashfreeSettings({ singleton_key: "default", ...data })
    }
    return this.getLowQtyFeeSettings()
  }

  /** Admin: save referral programme settings. Partial-update — only
   *  fields the caller explicitly sends are written. Per-side
   *  bucket accepts 'main' | 'promo'. There is one shared
   *  min-purchase threshold (the referee's order); per-side reward
   *  amount can vary. */
  async saveReferralSettings(input: {
    enabled?: boolean
    rewardAmountInr?: number
    minPurchaseInr?: number
    referrerRewardInr?: number
    refereeRewardInr?: number
    referrerCreditBucket?: "main" | "promo"
    refereeCreditBucket?: "main" | "promo"
  }) {
    const row = await this.loadSettingRow()
    const data: Record<string, unknown> = {}
    if (input.enabled !== undefined) data.referral_enabled = input.enabled
    if (input.rewardAmountInr !== undefined) {
      data.referral_reward_amount_inr = input.rewardAmountInr
    }
    if (input.minPurchaseInr !== undefined) {
      data.referral_min_purchase_inr = input.minPurchaseInr
    }
    if (input.referrerRewardInr !== undefined) {
      data.referral_referrer_reward_inr = input.referrerRewardInr
    }
    if (input.refereeRewardInr !== undefined) {
      data.referral_referee_reward_inr = input.refereeRewardInr
    }
    if (input.referrerCreditBucket !== undefined) {
      if (
        input.referrerCreditBucket !== "main" &&
        input.referrerCreditBucket !== "promo"
      ) {
        throw new Error("referrerCreditBucket must be 'main' or 'promo'")
      }
      data.referrer_credit_bucket = input.referrerCreditBucket
    }
    if (input.refereeCreditBucket !== undefined) {
      if (
        input.refereeCreditBucket !== "main" &&
        input.refereeCreditBucket !== "promo"
      ) {
        throw new Error("refereeCreditBucket must be 'main' or 'promo'")
      }
      data.referee_credit_bucket = input.refereeCreditBucket
    }
    if (row) {
      await this.updateCashfreeSettings({ id: row.id, ...data })
    } else {
      await this.createCashfreeSettings({ singleton_key: "default", ...data })
    }
    return this.getReferralSettings()
  }

  // ─── Rewards: promo cap + referral routing + points conversion ──
  // Read by /admin/fees (rewards section) + /store/wallet/convert-points.
  // The cap is what `debitForOrder` consults; routing is what the
  // referral subscriber consults; conversion knobs are what the
  // self-serve points→promo endpoint enforces.

  async getRewardsSettings(): Promise<{
    promo_payment_enabled: boolean
    promo_max_pct_of_subtotal: number /** decimal — 0.02 = 2% */
    promo_max_flat_inr: number /** whole ₹ */
    referrer_credit_bucket: "main" | "promo"
    referee_credit_bucket: "main" | "promo"
    points_conversion_enabled: boolean
    points_per_inr: number
    points_min_convert: number
    points_max_convert: number
  }> {
    const row = (await this.loadSettingRow()) as any
    return {
      promo_payment_enabled: Boolean(row?.promo_payment_enabled ?? true),
      promo_max_pct_of_subtotal: Number(row?.promo_max_pct_of_subtotal ?? 0.02),
      promo_max_flat_inr: Math.floor(Number(row?.promo_max_flat_inr ?? 500)),
      referrer_credit_bucket:
        (row?.referrer_credit_bucket as "main" | "promo") ?? "promo",
      referee_credit_bucket:
        (row?.referee_credit_bucket as "main" | "promo") ?? "promo",
      points_conversion_enabled: Boolean(
        row?.points_conversion_enabled ?? true,
      ),
      points_per_inr: Math.max(1, Math.floor(Number(row?.points_per_inr ?? 100))),
      points_min_convert: Math.max(
        1,
        Math.floor(Number(row?.points_min_convert ?? 100)),
      ),
      points_max_convert: Math.max(
        1,
        Math.floor(Number(row?.points_max_convert ?? 100000)),
      ),
    }
  }

  /** Admin: partial-update of any of the rewards-section knobs. */
  async saveRewardsSettings(input: {
    promo_payment_enabled?: boolean
    /** Decimal (0.02 = 2%). Validated [0, 1]. */
    promo_max_pct_of_subtotal?: number
    /** Whole ₹. Validated >= 0. */
    promo_max_flat_inr?: number
    referrer_credit_bucket?: "main" | "promo"
    referee_credit_bucket?: "main" | "promo"
    points_conversion_enabled?: boolean
    points_per_inr?: number
    points_min_convert?: number
    points_max_convert?: number
  }) {
    const row = await this.loadSettingRow()
    const data: Record<string, unknown> = {}
    if (input.promo_payment_enabled !== undefined) {
      data.promo_payment_enabled = input.promo_payment_enabled
    }
    if (input.promo_max_pct_of_subtotal !== undefined) {
      const p = Number(input.promo_max_pct_of_subtotal)
      if (!Number.isFinite(p) || p < 0 || p > 1) {
        throw new Error("promo_max_pct_of_subtotal must be in [0, 1]")
      }
      data.promo_max_pct_of_subtotal = p
    }
    if (input.promo_max_flat_inr !== undefined) {
      const f = Number(input.promo_max_flat_inr)
      if (!Number.isFinite(f) || f < 0 || !Number.isInteger(f)) {
        throw new Error("promo_max_flat_inr must be a non-negative integer (whole ₹)")
      }
      data.promo_max_flat_inr = f
    }
    if (input.referrer_credit_bucket !== undefined) {
      if (input.referrer_credit_bucket !== "main" && input.referrer_credit_bucket !== "promo") {
        throw new Error("referrer_credit_bucket must be 'main' or 'promo'")
      }
      data.referrer_credit_bucket = input.referrer_credit_bucket
    }
    if (input.referee_credit_bucket !== undefined) {
      if (input.referee_credit_bucket !== "main" && input.referee_credit_bucket !== "promo") {
        throw new Error("referee_credit_bucket must be 'main' or 'promo'")
      }
      data.referee_credit_bucket = input.referee_credit_bucket
    }
    if (input.points_conversion_enabled !== undefined) {
      data.points_conversion_enabled = input.points_conversion_enabled
    }
    if (input.points_per_inr !== undefined) {
      const v = Math.floor(Number(input.points_per_inr))
      if (!Number.isFinite(v) || v < 1) {
        throw new Error("points_per_inr must be a positive integer")
      }
      data.points_per_inr = v
    }
    if (input.points_min_convert !== undefined) {
      const v = Math.floor(Number(input.points_min_convert))
      if (!Number.isFinite(v) || v < 1) {
        throw new Error("points_min_convert must be a positive integer")
      }
      data.points_min_convert = v
    }
    if (input.points_max_convert !== undefined) {
      const v = Math.floor(Number(input.points_max_convert))
      if (!Number.isFinite(v) || v < 1) {
        throw new Error("points_max_convert must be a positive integer")
      }
      data.points_max_convert = v
    }
    if (row) {
      await this.updateCashfreeSettings({ id: row.id, ...data })
    } else {
      await this.createCashfreeSettings({ singleton_key: "default", ...data })
    }
    return this.getRewardsSettings()
  }

  // ─── Referral: can-apply check ──────────────────────────────────

  /**
   * Returns whether the customer can still apply a referral code.
   * Blocked if: already has a referral (any status), or has any completed
   * order, or the referral programme is disabled.
   */
  async canApplyReferral(customer_id: string): Promise<{ canApply: boolean; reason?: string }> {
    const settings = await this.getReferralSettings()
    if (!settings.enabled) {
      return { canApply: false, reason: "referral_program_disabled" }
    }
    // Already has a referral?
    const [existing] = await this.listReferrals(
      { referred_customer_id: customer_id },
      { take: 1 }
    )
    if (existing) {
      return { canApply: false, reason: "already_applied" }
    }
    // Note: first-purchase check would require access to the order module
    // which lives outside this module's container. The API route handler
    // performs that check instead (it has access to req.scope).
    return { canApply: true }
  }

  // ─── Referral: apply (deferred credit) ──────────────────────────

  /**
   * Apply a referral code. Creates a referral row with status="pending".
   * The ₹ credit is deferred until the referee's first purchase is
   * completed (see `creditFirstPurchaseReferral`).
   *
   * Idempotent via the unique constraint on `referred_customer_id`.
   */
  async applyReferralCode(referred_customer_id: string, code: string) {
    const settings = await this.getReferralSettings()
    if (!settings.enabled) {
      throw new Error("referral_program_disabled")
    }

    // 1. Find the referral-code row (the "template" row with null referred_customer_id)
    const [template] = await this.listReferrals(
      { code, referred_customer_id: null },
      { take: 1 }
    )
    if (!template) {
      throw new Error("invalid_referral_code")
    }

    // 2. Prevent self-referral
    if (template.referrer_customer_id === referred_customer_id) {
      throw new Error("cannot_refer_self")
    }

    // 3. Check if this customer was already referred (by anyone)
    const [alreadyReferred] = await this.listReferrals(
      { referred_customer_id },
      { take: 1 }
    )
    if (alreadyReferred) {
      return { referral: alreadyReferred, already_applied: true, status: alreadyReferred.status }
    }

    // 4. Create the referral row as PENDING (credit deferred to first
    //    qualifying purchase). Snapshot the per-side reward + min
    //    purchase from settings — admins can change settings later
    //    without affecting in-flight referrals.
    const referral = await this.createReferrals({
      referrer_customer_id: template.referrer_customer_id,
      referred_customer_id,
      code,
      status: "pending",
      reward_amount_inr: settings.refereeRewardInr,
      referrer_reward_inr: settings.referrerRewardInr,
      referee_reward_inr: settings.refereeRewardInr,
    })

    return {
      referral,
      already_applied: false,
      status: "pending",
      message:
        `Referral applied! Place your first investment of at least ` +
        `₹${settings.minPurchaseInr.toLocaleString("en-IN")} to unlock ` +
        `₹${settings.referrerRewardInr} for your friend and ` +
        `₹${settings.refereeRewardInr} for you.`,
    }
  }

  // ─── Referral: credit on qualifying purchase ──────────────────

  /**
   * Called by the `order.placed` subscriber on every referee order
   * while the referral is still pending. Single shared min-purchase
   * threshold gates BOTH sides; once cleared, each side credits per
   * its own amount + bucket.
   *
   * Idempotency: per-side keys
   * (`REFERRAL_CREDIT:referrer:<id>` / `REFERRAL_CREDIT:referee:<id>`)
   * so this function is safe to call on every order — already-credited
   * sides collapse to no-ops via the wallet ledger's idempotency
   * unique index.
   *
   * Status transitions:
   *   pending  → pending   (subtotal below threshold)
   *   pending  → credited  (subtotal cleared; both sides credited
   *                          per their amount + bucket)
   * Once `credited`, subsequent calls early-return via the
   * listReferrals filter on status="pending".
   *
   * Returns `true` iff a credit fired on this call (i.e. the referee
   * just cleared the threshold and both sides went to wallet).
   */
  /**
   * Internal helper — credits ONE side of a referral row, idempotent
   * via the wallet ledger's unique idempotency_key index. Shared
   * between the referee-side and referrer-side trigger methods so
   * the credit shape stays identical to the historical behaviour.
   */
  private async creditOneReferralSide(
    referralId: string,
    customer_id: string,
    amount_paise: number,
    role: "referrer" | "referee",
    bucket: "main" | "promo",
  ): Promise<void> {
    if (amount_paise <= 0) return
    const idempotency_key = `REFERRAL_CREDIT:${role}:${referralId}`
    const note =
      role === "referrer"
        ? `Referral reward — friend completed qualifying purchase`
        : `Welcome reward — referral verification completed`
    const metadata = { referral_id: referralId, role, bucket }
    if (bucket === "promo") {
      await this.creditPromo({
        customer_id,
        amount_inr: amount_paise,
        kind: "referral_credit",
        reference_type: "manual",
        reference_id: referralId,
        idempotency_key,
        note,
        metadata,
      })
    } else {
      await this.credit({
        customer_id,
        amount_inr: amount_paise,
        kind: "referral_credit",
        reference_type: "manual",
        reference_id: referralId,
        idempotency_key,
        note,
        metadata,
      })
    }
  }

  /**
   * Sum the customer's lifetime item-subtotal (₹) across every non-
   * cancelled order. Used by the referrer-side credit to decide whether
   * the referee has crossed `referral_min_purchase_inr` (the cumulative
   * threshold; default ₹10 000).
   *
   * Includes line-item value only (qty × unit_price). Platform fees +
   * shipping are excluded — same definition as the legacy single-order
   * check, just summed across orders.
   *
   * Cancelled orders are excluded by filtering on the negative
   * (`canceled_at: null` is hard to express in the Medusa listOrders
   * filter so we read every order for the customer and drop cancelled
   * ones in JS). Bounded by per-customer order count; this isn't a
   * hot-path query.
   */
  async computeLifetimeBuyInr(customer_id: string): Promise<number> {
    try {
      const orderModule: any = (this as any).__container__?.resolve?.(
        Modules.ORDER,
      )
      if (!orderModule || typeof orderModule.listOrders !== "function") {
        return 0
      }
      const orders = await orderModule.listOrders(
        { customer_id },
        {
          select: [
            "id",
            "status",
            "canceled_at",
            "items.unit_price",
            "items.quantity",
          ],
          relations: ["items"],
          take: 200,
        },
      )
      if (!Array.isArray(orders)) return 0
      let total = 0
      for (const o of orders) {
        if ((o as any).canceled_at) continue
        const items = Array.isArray((o as any).items) ? (o as any).items : []
        for (const it of items) {
          const qty = Number(it?.quantity ?? 0)
          const unit = Number(it?.unit_price ?? 0)
          if (Number.isFinite(qty) && Number.isFinite(unit)) {
            total += qty * unit
          }
        }
      }
      return total
    } catch {
      return 0
    }
  }

  /**
   * Credit the REFEREE side of a pending referral the moment the
   * referee's KYC reaches `overall='approved'` (PAN + Aadhaar + Bank +
   * Demat all green). Hooked from `fireInvestingReadyIfReady` in
   * utils/onboarding-events.ts — the same event that announces "you
   * can now place your first order".
   *
   * Returns true iff the referee credit fired on this call. Idempotent:
   * subsequent calls early-return because `referee_credited_at` is
   * already set.
   *
   * Decoupled from the referrer-side credit, which fires later (when
   * the referee's cumulative buy crosses the threshold).
   */
  async creditRefereeReferralOnKycComplete(
    referred_customer_id: string,
  ): Promise<boolean> {
    const [referral] = await this.listReferrals(
      { referred_customer_id, status: "pending" },
      { take: 1 },
    )
    if (!referral) return false
    if ((referral as any).referee_credited_at) return false

    const settings = await this.getReferralSettings()
    if (!settings.enabled) return false

    // Defence-in-depth: the caller should already have confirmed
    // overall='approved' before invoking, but re-check here so a stray
    // call from somewhere else can't credit a half-KYC'd customer.
    const kyc = await this.getKycStatus(referred_customer_id)
    if (kyc.overall !== "approved") return false

    const refereeRewardRupees = settings.refereeRewardInr
    const refereeRewardPaise = Math.round(refereeRewardRupees * 100)

    await this.creditOneReferralSide(
      referral.id,
      referred_customer_id,
      refereeRewardPaise,
      "referee",
      settings.refereeCreditBucket,
    )

    await this.updateReferrals({
      id: referral.id,
      referee_credited_at: new Date().toISOString(),
      referee_reward_inr: refereeRewardRupees,
    })
    return true
  }

  /**
   * Credit the REFERRER side of a pending referral when the referee's
   * cumulative lifetime buy crosses `settings.minPurchaseInr` (default
   * ₹10 000). Hooked from the `order.placed` subscriber so every order
   * re-checks the threshold; the credit only fires once.
   *
   * If the referrer credit closes the row (i.e. the referee credit was
   * also already paid) the status flips to `credited`. If the referee
   * credit hasn't fired yet (rare — would require the order subscriber
   * to win the race against the KYC-complete hook), the row stays
   * `pending` with `credited_at` set and `referee_credited_at` null;
   * the next KYC-complete fire will finish the job.
   *
   * Returns true iff the referrer credit fired on this call.
   */
  async creditReferrerReferralOnLifetimeBuy(
    referred_customer_id: string,
  ): Promise<boolean> {
    const [referral] = await this.listReferrals(
      { referred_customer_id, status: "pending" },
      { take: 1 },
    )
    if (!referral) return false
    if ((referral as any).credited_at) return false

    const settings = await this.getReferralSettings()
    if (!settings.enabled) return false

    const cumulativeBuy = await this.computeLifetimeBuyInr(referred_customer_id)

    // Stamp first_trade_at the first time we see ANY order, regardless
    // of threshold — admin uses it to spot "they ordered, just below
    // threshold" customers.
    if (cumulativeBuy > 0 && !(referral as any).first_trade_at) {
      await this.updateReferrals({
        id: referral.id,
        first_trade_at: new Date().toISOString(),
      })
    }

    if (cumulativeBuy < settings.minPurchaseInr) return false

    const referrerRewardRupees = settings.referrerRewardInr
    const referrerRewardPaise = Math.round(referrerRewardRupees * 100)

    await this.creditOneReferralSide(
      referral.id,
      referral.referrer_customer_id,
      referrerRewardPaise,
      "referrer",
      settings.referrerCreditBucket,
    )

    const now = new Date().toISOString()
    // Only flip status='credited' when BOTH sides are paid. If the
    // referee credit hasn't landed yet (rare race), status stays
    // pending and the KYC-complete hook closes the row on its next
    // fire (it checks credited_at independently).
    const refereeAlreadyPaid = Boolean((referral as any).referee_credited_at)
    await this.updateReferrals({
      id: referral.id,
      status: refereeAlreadyPaid ? "credited" : "pending",
      credited_at: now,
      first_order_subtotal_inr: cumulativeBuy,
      referrer_reward_inr: referrerRewardRupees,
    })
    return true
  }

  /**
   * Back-compat shim. Older call sites (and the admin reconcile-
   * referrals script) used `creditFirstPurchaseReferral(referred,
   * subtotal)` when the two credits fired atomically on the referee's
   * first qualifying order. The new model decouples the two credits;
   * this shim invokes them in sequence so any straggler caller still
   * works. Prefer the per-side methods in new code.
   */
  async creditFirstPurchaseReferral(
    referred_customer_id: string,
    /* legacy unused — lifetime buy is computed on demand now */
    _first_order_subtotal_inr?: number,
  ): Promise<boolean> {
    const refereeCredited =
      await this.creditRefereeReferralOnKycComplete(referred_customer_id)
    const referrerCredited =
      await this.creditReferrerReferralOnLifetimeBuy(referred_customer_id)
    return refereeCredited || referrerCredited
  }

  /**
   * Reverse a credited referral. Admin-only action.
   *
   * Subtracts the rewards from both customers' gamification
   * `referral_credit_inr` balances (clamped at 0 — they may have
   * spent some of it at checkout already) and sets
   * `status = "reversed"`.
   */
  async reverseReferral(
    referralId: string
  ): Promise<{ success: boolean; message: string }> {
    const [referral] = await this.listReferrals({ id: referralId }, { take: 1 })
    if (!referral) {
      return { success: false, message: "Referral not found" }
    }
    if ((referral as any).status !== "credited") {
      return {
        success: false,
        message: `Cannot reverse — status is "${(referral as any).status}", expected "credited"`,
      }
    }

    const referrerReward = Number(
      (referral as any).referrer_reward_inr ??
        (referral as any).reward_amount_inr ??
        250,
    )
    const refereeReward = Number(
      (referral as any).referee_reward_inr ??
        (referral as any).reward_amount_inr ??
        250,
    )

    const gamification = (this as any).__container__?.resolve?.(
      "gamification",
    ) as
      | {
          reverseReferralCredit: (args: any) => Promise<any>
        }
      | undefined
    if (!gamification?.reverseReferralCredit) {
      return { success: false, message: "gamification module unavailable" }
    }

    await Promise.all([
      gamification.reverseReferralCredit({
        customer_id: referral.referrer_customer_id,
        amount_inr: referrerReward,
        referral_id: referralId,
        idempotency_key: `REFERRAL_REVERSE:referrer:${referralId}`,
      }),
      gamification.reverseReferralCredit({
        customer_id: (referral as any).referred_customer_id,
        amount_inr: refereeReward,
        referral_id: referralId,
        idempotency_key: `REFERRAL_REVERSE:referee:${referralId}`,
      }),
    ])

    await this.updateReferrals({
      id: referralId,
      status: "reversed",
      reversed_at: new Date().toISOString(),
    })

    return {
      success: true,
      message: "Referral reversed (referral credit clawed back where available)",
    }
  }

  /* ---------------------------------------------------------------- *
   *  Admin audit log + wallet freeze / reason-coded adjust helpers
   * ---------------------------------------------------------------- */

  /**
   * Write an append-only audit log entry. Called from every mutating
   * admin route that touches sensitive customer data.
   */
  async logAdminAction(params: {
    admin_user_id: string
    customer_id?: string | null
    action: string
    target_id?: string | null
    before?: Record<string, unknown> | null
    after?: Record<string, unknown> | null
    note?: string | null
    reason_code?: string | null
  }) {
    return await this.createAdminAuditLogs({
      admin_user_id: params.admin_user_id,
      customer_id: params.customer_id ?? null,
      action: params.action as any,
      target_id: params.target_id ?? null,
      before_json: params.before ?? null,
      after_json: params.after ?? null,
      note: params.note ?? null,
      reason_code: params.reason_code ?? null,
    })
  }

  /** Freeze a customer's wallet. Subsequent credits/debits throw. */
  async freezeWallet(customer_id: string) {
    const wallet = await this.ensureWallet(customer_id)
    await this.updateWallets({ id: wallet.id, status: "frozen" })
    return { status: "frozen" as const }
  }

  /** Unfreeze a customer's wallet. */
  async unfreezeWallet(customer_id: string) {
    const wallet = await this.ensureWallet(customer_id)
    await this.updateWallets({ id: wallet.id, status: "active" })
    return { status: "active" as const }
  }

  /**
   * Manual wallet adjustment with a mandatory reason code + note.
   * Wraps `credit()` / `debit()` with a stamped idempotency key and
   * writes the reason_code into transaction metadata so the ledger
   * can filter on it.
   */
  async adjustWalletWithReason(params: {
    customer_id: string
    amount_inr: number
    direction: "credit" | "debit"
    reason_code: "promo" | "goodwill" | "reconciliation" | "correction" | "other"
    note: string
    admin_user_id: string
    /** Which sub-balance the adjustment hits. Defaults to "main" so
     *  pre-existing callers are unaffected. Promo-bucket debits are
     *  capped at the current promo balance via the underlying
     *  `creditPromo` / a custom debit path; we don't expose a
     *  promo-bucket admin debit yet because the CASA pattern doesn't
     *  exist for promo. Throws on direction=debit + bucket=promo. */
    bucket?: "main" | "promo"
  }) {
    if (!Number.isFinite(params.amount_inr) || params.amount_inr <= 0) {
      throw new Error("adjust_amount_must_be_positive")
    }
    if (!params.note || params.note.trim().length < 20) {
      throw new Error("adjust_note_min_20_chars")
    }

    const bucket = params.bucket ?? "main"
    const idempotency_key = `manual_${bucket}_${params.direction}_${randomUUID()}`
    const metadata = {
      reason_code: params.reason_code,
      admin_user_id: params.admin_user_id,
      bucket,
    }

    if (params.direction === "credit") {
      if (bucket === "promo") {
        return await this.creditPromo({
          customer_id: params.customer_id,
          amount_inr: params.amount_inr,
          kind: "manual_adjust",
          reference_type: "manual",
          reference_id: null,
          idempotency_key,
          note: params.note,
          metadata,
        })
      }
      return await this.credit({
        customer_id: params.customer_id,
        amount_inr: params.amount_inr,
        kind: "manual_adjust",
        reference_type: "manual",
        reference_id: null,
        idempotency_key,
        note: params.note,
        metadata,
      })
    }

    // Debit path. Main bucket goes through the standard `debit()`
    // helper. Promo-bucket debits use a dedicated CAS loop here —
    // promo never has a "held order" branch (you can't add funds to
    // promo via VBA), so an insufficient-funds debit just returns
    // the typed shortfall and the caller decides.
    if (bucket === "promo") {
      const MAX_OPTIMISTIC_RETRIES = 3
      for (let attempt = 0; attempt < MAX_OPTIMISTIC_RETRIES; attempt++) {
        const wallet = await this.ensureWallet(params.customer_id)
        const currentPromo = Number(wallet.promo_balance_inr ?? 0)
        const currentVersion = Number(wallet.version)
        if (wallet.status === "frozen") {
          return { ok: false, reason: "wallet_frozen" }
        }
        if (currentPromo < params.amount_inr) {
          return {
            ok: false,
            reason: "insufficient_funds",
            shortfall: params.amount_inr - currentPromo,
            balance: currentPromo,
            bucket: "promo" as const,
          }
        }
        const newPromo = currentPromo - params.amount_inr
        const updated = await this.updateWallets({
          selector: { id: wallet.id, version: currentVersion },
          data: { promo_balance_inr: newPromo, version: currentVersion + 1 },
        })
        if (!updated || (Array.isArray(updated) && updated.length === 0)) {
          continue
        }
        const tx = await this.createWalletTransactions({
          wallet_id: wallet.id,
          customer_id: params.customer_id,
          direction: "debit",
          amount_inr: params.amount_inr,
          balance_after: newPromo,
          kind: "manual_adjust",
          bucket: "promo",
          reference_type: "manual",
          reference_id: null,
          cashfree_event_id: null,
          idempotency_key,
          note: params.note,
          metadata,
        })
        return { ok: true, balance_after: newPromo, transaction_id: tx.id }
      }
      throw new Error("wallet_debit_conflict")
    }

    return await this.debit({
      customer_id: params.customer_id,
      amount_inr: params.amount_inr,
      kind: "manual_adjust",
      reference_type: "manual",
      reference_id: null,
      idempotency_key,
      note: params.note,
      metadata,
    })
  }

  // ── Global PAN cache (`pan_record` table) ────────────────────
  //
  // The route layer hashes the submitted PAN, calls
  // `lookupPanRecordByHash` first, hits Cashfree only on miss,
  // then `upsertPanRecord` to persist. The table is global —
  // never customer-scoped — so two customers verifying the same
  // PAN share one cached record. The customer-purge SQL block
  // does NOT touch this table; the data is retained permanently.

  /**
   * Read the cached PAN record by hash. Returns null if not yet
   * cached. The hash is the SHA-256 hex of the uppercased,
   * trimmed PAN — the route helper computes it.
   */
  async lookupPanRecordByHash(pan_hash: string): Promise<any | null> {
    if (!pan_hash) return null
    const rows = await this.listPanRecords({ pan_hash }, { take: 1 })
    return rows[0] ?? null
  }

  /**
   * Insert-or-update a PAN record. Keyed on `pan_hash` — the unique
   * partial index on the table guarantees one live row per hash.
   *
   * On INSERT: stamps `first_verified_at` + `last_refreshed_at` to now.
   * On UPDATE (same hash, fresh Cashfree data): merges the new
   * fields into the existing row, bumps `last_refreshed_at` only.
   * `first_verified_at` is preserved so we keep the historical
   * "this PAN entered our system on date X" anchor.
   */
  async upsertPanRecord(input: {
    pan_hash: string
    pan_masked: string
    /** Full 10-character plaintext PAN. Optional — only the storefront
     *  PAN-verify route supplies it (Cashfree never returns the full
     *  PAN to us, so other callers don't have it). Mirror of
     *  `aadhaar_record.aadhaar_full` retention. */
    pan_full?: string | null
    registered_name: string
    name_pan_card?: string | null
    first_name?: string | null
    last_name?: string | null
    pan_type?: string | null
    father_name?: string | null
    pan_status?: string | null
    last_updated_at_itd?: string | null
    aadhaar_linked?: boolean | null
    aadhaar_seeding_status?: string | null
    aadhaar_seeding_status_desc?: string | null
    masked_aadhaar?: string | null
    gender?: string | null
    date_of_birth?: string | null
    email_masked?: string | null
    phone_masked?: string | null
    address?: Record<string, unknown> | null
    name_match_score_initial?: number | null
    name_match_result_initial?: string | null
    cashfree_reference_id?: string | null
    cashfree_verification_id?: string | null
    response_raw?: Record<string, unknown> | null
  }): Promise<any> {
    const existing = await this.lookupPanRecordByHash(input.pan_hash)
    const nowIso = new Date()

    // Build the field set we'll write. Only include keys the caller
    // actually supplied — undefined values shouldn't blow away
    // existing cached data on an update.
    const fields: Record<string, unknown> = {
      pan_masked: input.pan_masked,
      registered_name: input.registered_name,
    }
    const optional = {
      pan_full: input.pan_full,
      name_pan_card: input.name_pan_card,
      first_name: input.first_name,
      last_name: input.last_name,
      pan_type: input.pan_type,
      father_name: input.father_name,
      pan_status: input.pan_status,
      last_updated_at_itd: input.last_updated_at_itd,
      aadhaar_linked: input.aadhaar_linked,
      aadhaar_seeding_status: input.aadhaar_seeding_status,
      aadhaar_seeding_status_desc: input.aadhaar_seeding_status_desc,
      masked_aadhaar: input.masked_aadhaar,
      gender: input.gender,
      date_of_birth: input.date_of_birth,
      email_masked: input.email_masked,
      phone_masked: input.phone_masked,
      address: input.address,
      name_match_score_initial: input.name_match_score_initial,
      name_match_result_initial: input.name_match_result_initial,
      cashfree_reference_id: input.cashfree_reference_id,
      cashfree_verification_id: input.cashfree_verification_id,
      response_raw: input.response_raw,
    }
    for (const [k, v] of Object.entries(optional)) {
      if (v !== undefined) fields[k] = v
    }

    if (existing) {
      // Refresh — preserve first_verified_at, bump last_refreshed_at.
      await this.updatePanRecords({
        selector: { id: existing.id },
        data: { ...fields, last_refreshed_at: nowIso },
      })
      return this.lookupPanRecordByHash(input.pan_hash)
    }

    return this.createPanRecords({
      pan_hash: input.pan_hash,
      first_verified_at: nowIso,
      last_refreshed_at: nowIso,
      ...fields,
    } as any)
  }

  // ── Global Aadhaar cache (`aadhaar_record` table) ────────────
  //
  // Same shape as the PAN equivalents above. Hashed on SHA-256 of
  // the 12-digit Aadhaar — never store the raw number. Survives
  // customer deletion.

  async lookupAadhaarRecordByHash(
    aadhaar_hash: string,
  ): Promise<any | null> {
    if (!aadhaar_hash) return null
    const rows = await this.listAadhaarRecords({ aadhaar_hash }, { take: 1 })
    return rows[0] ?? null
  }

  async upsertAadhaarRecord(input: {
    aadhaar_hash: string
    aadhaar_masked: string
    /** Full 12-digit Aadhaar — stored plaintext per 2026-04-28
     *  operator decision. Surfaced to admins via Reveal toggle;
     *  default-masked. Encryption to be layered on later. */
    aadhaar_full?: string | null
    name: string
    date_of_birth?: string | null
    gender?: string | null
    /** Father's / care-of name from Cashfree's offline-Aadhaar verify
     *  response. Optional: not every UIDAI offline XML carries it. */
    father_name?: string | null
    address?: Record<string, unknown> | null
    has_photo?: boolean | null
    /** Local /static URL of the persisted Aadhaar photo. Set via
     *  the otp-verify route's extractAndPersistAadhaarPhoto helper.
     *  Pass `null` when no photo could be extracted. */
    photo_url?: string | null
    cashfree_ref_id?: string | null
    response_raw?: Record<string, unknown> | null
  }): Promise<any> {
    const existing = await this.lookupAadhaarRecordByHash(input.aadhaar_hash)
    const nowIso = new Date()
    const fields: Record<string, unknown> = {
      aadhaar_masked: input.aadhaar_masked,
      name: input.name,
    }
    const optional = {
      aadhaar_full: input.aadhaar_full,
      date_of_birth: input.date_of_birth,
      gender: input.gender,
      father_name: input.father_name,
      address: input.address,
      has_photo: input.has_photo,
      photo_url: input.photo_url,
      cashfree_ref_id: input.cashfree_ref_id,
      response_raw: input.response_raw,
    }
    for (const [k, v] of Object.entries(optional)) {
      if (v !== undefined) fields[k] = v
    }
    if (existing) {
      await this.updateAadhaarRecords({
        selector: { id: existing.id },
        data: { ...fields, last_refreshed_at: nowIso },
      })
      return this.lookupAadhaarRecordByHash(input.aadhaar_hash)
    }
    return this.createAadhaarRecords({
      aadhaar_hash: input.aadhaar_hash,
      first_verified_at: nowIso,
      last_refreshed_at: nowIso,
      ...fields,
    } as any)
  }

  // ─── Global bank registry ─────────────────────────────────────
  //
  // Mirrors the PAN / Aadhaar registries. Hashed on SHA-256 of
  // `(ifsc + ":" + account_number)` — neither field is unique on its
  // own. Survives customer deletion. Each customer's bank_account
  // row carries a `bank_hash` column linking it back to this row.

  async lookupBankRecordByHash(bank_hash: string): Promise<any | null> {
    if (!bank_hash) return null
    const rows = await this.listBankRecords({ bank_hash }, { take: 1 })
    return rows[0] ?? null
  }

  async upsertBankRecord(input: {
    bank_hash: string
    account_number_masked: string
    account_number_full?: string | null
    ifsc: string
    account_status?: string | null
    account_status_code?: string | null
    name_at_bank?: string | null
    name_match_result?: string | null
    name_match_score?: number | null
    bank_name?: string | null
    branch?: string | null
    city?: string | null
    micr?: string | null
    swift_code?: string | null
    nbin?: string | null
    category?: string | null
    ifsc_details?: Record<string, unknown> | null
    cashfree_ref_id?: string | null
    utr?: string | null
    response_raw?: Record<string, unknown> | null
  }): Promise<any> {
    const existing = await this.lookupBankRecordByHash(input.bank_hash)
    const nowIso = new Date()
    const fields: Record<string, unknown> = {
      account_number_masked: input.account_number_masked,
      ifsc: input.ifsc,
    }
    const optional = {
      account_number_full: input.account_number_full,
      account_status: input.account_status,
      account_status_code: input.account_status_code,
      name_at_bank: input.name_at_bank,
      name_match_result: input.name_match_result,
      name_match_score: input.name_match_score,
      bank_name: input.bank_name,
      branch: input.branch,
      city: input.city,
      micr: input.micr,
      swift_code: input.swift_code,
      nbin: input.nbin,
      category: input.category,
      ifsc_details: input.ifsc_details,
      cashfree_ref_id: input.cashfree_ref_id,
      utr: input.utr,
      response_raw: input.response_raw,
    }
    for (const [k, v] of Object.entries(optional)) {
      if (v !== undefined) fields[k] = v
    }
    if (existing) {
      await this.updateBankRecords({
        selector: { id: existing.id },
        data: { ...fields, last_refreshed_at: nowIso },
      })
      return this.lookupBankRecordByHash(input.bank_hash)
    }
    return this.createBankRecords({
      bank_hash: input.bank_hash,
      first_verified_at: nowIso,
      last_refreshed_at: nowIso,
      ...fields,
    } as any)
  }

  // ─── Global CMR registry ──────────────────────────────────────
  //
  // Mirrors the PAN / Aadhaar / Bank registries. Hashed on SHA-256 of
  // a normalised depository identifier:
  //   CDSL → "cdsl|<boid>"
  //   NSDL → "nsdl|<dp_id>|<client_id>"
  // Survives customer deletion. Each customer's demat_account row
  // carries a `cmr_hash` column linking it back to this row.

  /**
   * Compute the canonical hash for a CMR fingerprint. Returns null
   * when the inputs are insufficient (e.g. CDSL without a BOID, or
   * NSDL without both dp_id and client_id) — callers must skip
   * registry write in that case.
   */
  computeCmrHash(args: {
    depository: "CDSL" | "NSDL"
    boid?: string | null
    dp_id?: string | null
    client_id?: string | null
  }): string | null {
    const { createHash } = require("node:crypto") as typeof import("node:crypto")
    const trim = (s: string | null | undefined) =>
      typeof s === "string" ? s.trim().toUpperCase() : ""
    if (args.depository === "CDSL") {
      const boid = trim(args.boid)
      if (!boid) return null
      return createHash("sha256").update(`cdsl|${boid}`).digest("hex")
    }
    const dp = trim(args.dp_id)
    const cli = trim(args.client_id)
    if (!dp || !cli) return null
    return createHash("sha256").update(`nsdl|${dp}|${cli}`).digest("hex")
  }

  /**
   * Build a display mask for the registry / admin UI. Last 4 digits
   * always visible, rest masked.
   */
  buildCmrMasked(args: {
    depository: "CDSL" | "NSDL"
    boid?: string | null
    dp_id?: string | null
    client_id?: string | null
  }): string {
    const tail = (s: string | null | undefined, keep = 4) => {
      const v = typeof s === "string" ? s.trim() : ""
      if (!v) return ""
      if (v.length <= keep) return v
      return "X".repeat(v.length - keep) + v.slice(-keep)
    }
    if (args.depository === "CDSL") {
      return `CDSL · ${tail(args.boid, 4)}`
    }
    return `NSDL · ${tail(args.dp_id, 4)}/${tail(args.client_id, 4)}`
  }

  async lookupCmrRecordByHash(cmr_hash: string): Promise<any | null> {
    if (!cmr_hash) return null
    const rows = await this.listCmrRecords({ cmr_hash }, { take: 1 })
    return rows[0] ?? null
  }

  /**
   * Insert-or-update a CMR record. Keyed on `cmr_hash`. On INSERT the
   * row stamps `last_refreshed_at` to now and `first_verified_at` only
   * when the inbound `verification_status` is "verified". On UPDATE
   * the row's identifying fields stay frozen (cmr_hash is unique;
   * collision implies same demat) — only mutable fields (file_url,
   * holder_name, name_match_score, verification_status,
   * cashfree_reference_id, verification_raw) get refreshed, and
   * `first_verified_at` is set only on the first transition into
   * "verified".
   */
  async upsertCmrRecord(input: {
    cmr_hash: string
    depository: "CDSL" | "NSDL"
    cmr_masked: string
    dp_id?: string | null
    client_id?: string | null
    boid?: string | null
    dp_name: string
    account_holder_name: string
    cmr_file_url: string
    name_match_score?: number | null
    verification_status?: "pending" | "verified" | "failed" | "name_mismatch"
    cashfree_reference_id?: string | null
    verification_raw?: Record<string, unknown> | null
  }): Promise<any> {
    const existing = await this.lookupCmrRecordByHash(input.cmr_hash)
    const nowIso = new Date()

    if (existing) {
      const data: Record<string, unknown> = {
        last_refreshed_at: nowIso,
      }
      // Always update mutable fields when supplied.
      if (input.cmr_file_url) data.cmr_file_url = input.cmr_file_url
      if (input.dp_name) data.dp_name = input.dp_name
      if (input.account_holder_name)
        data.account_holder_name = input.account_holder_name
      if (input.name_match_score !== undefined)
        data.name_match_score = input.name_match_score
      if (input.cashfree_reference_id !== undefined)
        data.cashfree_reference_id = input.cashfree_reference_id
      if (input.verification_raw !== undefined)
        data.verification_raw = input.verification_raw
      // Status: only stamp `first_verified_at` on the first verified
      // transition, never overwrite it on subsequent refreshes.
      if (input.verification_status) {
        data.verification_status = input.verification_status
        if (
          input.verification_status === "verified" &&
          !existing.first_verified_at
        ) {
          data.first_verified_at = nowIso
        }
      }
      await this.updateCmrRecords({
        selector: { id: existing.id },
        data,
      })
      return this.lookupCmrRecordByHash(input.cmr_hash)
    }

    const status = input.verification_status ?? "pending"
    return this.createCmrRecords({
      cmr_hash: input.cmr_hash,
      depository: input.depository,
      cmr_masked: input.cmr_masked,
      dp_id: input.dp_id ?? null,
      client_id: input.client_id ?? null,
      boid: input.boid ?? null,
      dp_name: input.dp_name,
      account_holder_name: input.account_holder_name,
      cmr_file_url: input.cmr_file_url,
      name_match_score: input.name_match_score ?? null,
      verification_status: status,
      cashfree_reference_id: input.cashfree_reference_id ?? null,
      verification_raw: input.verification_raw ?? null,
      first_verified_at: status === "verified" ? nowIso : null,
      last_refreshed_at: nowIso,
    } as any)
  }
}

export default CashfreeWalletService
