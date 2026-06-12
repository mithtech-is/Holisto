import {
  AbstractPaymentProvider,
  MedusaError,
} from "@medusajs/framework/utils"
import { MedusaModule } from "@medusajs/framework/modules-sdk"
import type {
  AuthorizePaymentInput,
  AuthorizePaymentOutput,
  CancelPaymentInput,
  CancelPaymentOutput,
  CapturePaymentInput,
  CapturePaymentOutput,
  DeletePaymentInput,
  DeletePaymentOutput,
  GetPaymentStatusInput,
  GetPaymentStatusOutput,
  InitiatePaymentInput,
  InitiatePaymentOutput,
  PaymentSessionStatus,
  ProviderWebhookPayload,
  RefundPaymentInput,
  RefundPaymentOutput,
  RetrievePaymentInput,
  RetrievePaymentOutput,
  UpdatePaymentInput,
  UpdatePaymentOutput,
  WebhookActionResult,
} from "@medusajs/framework/types"
import {
  CASHFREE_WALLET_MODULE,
  CashfreeWalletService,
} from "../../modules/cashfree_wallet"

// Note: the payment-provider's `cradle` is the Medusa payment
// module's narrow sub-container. It DOES NOT have any sibling
// modules (cashfree_wallet, cart, gamification, …) registered. Any
// `cradle[<module>]` access throws `Could not resolve '<module>'`
// from Awilix's strict proxy mode, which Medusa's error-handler
// surfaces as the generic 500 "An unknown error occurred." in
// production.
//
// All cross-module access in this file is done lazily via
// `MedusaModule.getModuleInstance(<MODULE_NAME>)` — that talks to
// the global module registry which IS populated for every loaded
// module by the time checkout fires. See `getWalletModule` /
// `resolveCartModule` below.
type Dependencies = Record<string, unknown>

/**
 * Polemarch internal wallet payment provider (id: `cashfree-wallet`).
 *
 * Flow:
 *   - initiatePayment: computes the wallet-vs-cart shortfall and records a
 *     PaymentAttempt. No external call.
 *   - authorizePayment: debits the wallet atomically (optimistic-CAS retries
 *     in the service). If the wallet covers the amount → `authorized`.
 *     Otherwise → `pending` with the shortfall in `data.hold_state`, and the
 *     checkout workflow keeps the Order on hold. The capture-held-orders
 *     workflow (phase 10) drains these holds on VBA webhook credits.
 *   - capturePayment: no-op; the debit happened at authorize.
 *   - cancelPayment: reverses the wallet debit if any.
 *   - refundPayment: credits wallet (the wallet is the custodial account).
 *
 * `data.payment_attempt_id` is the link back to our `PaymentAttempt` row
 * across all lifecycle methods.
 */
export class CashfreeWalletPaymentProviderService extends AbstractPaymentProvider {
  static identifier = "cashfree-wallet"

  /**
   * Lazy proxy for the cashfree_wallet module. NOT held as a field
   * because reading `cradle[CASHFREE_WALLET_MODULE]` in the
   * constructor throws (see Dependencies comment above).
   * `MedusaModule.getModuleInstance` returns the singleton from the
   * global module registry — populated for every loaded module by
   * the time any payment-provider method is actually called.
   */
  protected get walletModule_(): CashfreeWalletService {
    // `MedusaModule.getModuleInstance` returns the `services` map
    // bootstrap built — `{ [moduleKey]: <ServiceInstance> }` — NOT the
    // bare service. We have to unwrap by moduleKey. Some Medusa
    // versions skip the wrapper and return the service directly, so we
    // accept either shape.
    const raw = MedusaModule.getModuleInstance(CASHFREE_WALLET_MODULE) as
      | CashfreeWalletService
      | Record<string, CashfreeWalletService>
      | undefined
    const w =
      raw && typeof (raw as CashfreeWalletService).ensureWallet === "function"
        ? (raw as CashfreeWalletService)
        : (raw as Record<string, CashfreeWalletService> | undefined)?.[
            CASHFREE_WALLET_MODULE
          ]
    if (!w || typeof w.ensureWallet !== "function") {
      throw new MedusaError(
        MedusaError.Types.UNEXPECTED_STATE,
        "cashfree-wallet provider can't reach the cashfree_wallet module — " +
          "is it registered in medusa-config.ts?",
      )
    }
    return w
  }

  constructor(cradle: Dependencies, _config?: Record<string, unknown>) {
    super(cradle as unknown as Record<string, unknown>, _config)
    // No eager dependency resolution here. Provider construction
    // happens INSIDE the payment-provider sub-container scope where
    // sibling modules aren't visible. Real resolution is deferred
    // to method-call time via `MedusaModule.getModuleInstance`.
  }

  /**
   * Best-effort cart-module resolution. Same lazy pattern as
   * `walletModule_` — uses the global module registry rather than
   * the payment-provider's narrow Awilix scope. Wrapped in try /
   * catch because `getModuleInstance` returns undefined for modules
   * that aren't loaded; we treat that as "fall through to the
   * attempt-gross subtotal fallback" in `getCartSubtotalPaise`.
   */
  private resolveCartModule(): any | null {
    try {
      // Same wrap-or-bare shape as `walletModule_`: prefer the bare
      // service, fall back to `instance[moduleKey]`.
      const raw = MedusaModule.getModuleInstance("cart") as any
      if (!raw) return null
      if (typeof raw.retrieveCart === "function") return raw
      if (raw.cart && typeof raw.cart.retrieveCart === "function") return raw.cart
      return null
    } catch {
      return null
    }
  }

  /**
   * Compute the cart's line-item subtotal in paise (qty × unit_price
   * summed across items, processing/low-qty fees excluded). Mirrors
   * the math in /store/gamification/checkout-credit so the promo cap
   * is anchored to the same "investment value" the storefront shows.
   *
   * Falls back to the gross attempt amount if the cart can't be loaded
   * — over-reports the cap by the fee delta but keeps the flow alive.
   */
  private async getCartSubtotalPaise(
    cartId: string | null | undefined,
    fallbackPaise: number,
  ): Promise<number> {
    if (!cartId) return fallbackPaise
    const cartModule = this.resolveCartModule()
    if (!cartModule) return fallbackPaise
    try {
      const cart = await cartModule.retrieveCart(cartId, {
        select: ["id"],
        relations: ["items"],
      })
      const items = Array.isArray(cart?.items) ? cart.items : []
      const rupees = items.reduce((sum: number, it: any) => {
        const qty = Number(it?.quantity ?? 0)
        const unit = Number(it?.unit_price ?? 0)
        return sum + qty * unit
      }, 0)
      return Math.round(rupees * 100)
    } catch {
      return fallbackPaise
    }
  }

  private toPaise(amount: unknown): number {
    // Medusa passes amounts in major units (rupees) as BigNumberInput.
    const n =
      typeof amount === "number"
        ? amount
        : typeof amount === "string"
        ? Number(amount)
        : typeof amount === "bigint"
        ? Number(amount)
        : Number((amount as { numeric?: number })?.numeric ?? NaN)
    if (!Number.isFinite(n)) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        `cashfree-wallet: invalid amount ${String(amount)}`
      )
    }
    return Math.round(n * 100)
  }

  private customerId(input: AuthorizePaymentInput | InitiatePaymentInput): string | undefined {
    // Medusa's `createPaymentSessionsWorkflow` does NOT reliably populate
    // `context.customer.id` for our provider — the cart→customer link
    // isn't guaranteed at session-init time. We accept a fallback from
    // `input.data.customer_id`, which the storefront passes through the
    // /payment-sessions request body.
    const ctxId = (input as InitiatePaymentInput).context?.customer?.id as
      | string
      | undefined
    if (ctxId) return ctxId
    const dataId = (input.data as { customer_id?: string } | undefined)?.customer_id
    return dataId
  }

  async initiatePayment(
    input: InitiatePaymentInput
  ): Promise<InitiatePaymentOutput> {
    // `input.amount` is sourced from Medusa's `payment_collection.amount`
    // which mirrors `cart.total`. The per-scrip processing fee is
    // injected into `cart.total` via `cart_line_item_tax_line` rows by
    // `reconcileCartProcessingFees`, called from
    // `/store/checkout/precheck/:cart_id` BEFORE the storefront initiates
    // a payment session. That precheck call is part of the checkout
    // contract — see apps/storefront/src/app/checkout/page.tsx. If a
    // client bypasses precheck the wallet will be debited the un-feed
    // total, but the storefront cart UI won't reach this method without
    // running precheck first.
    const customerId = this.customerId(input)
    if (!customerId) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        "cashfree-wallet: customer required (login before checkout)"
      )
    }
    const amount = this.toPaise(input.amount)
    const wallet = await this.walletModule_.ensureWallet(customerId)

    // Fabricate a cart id from context — this provider is cart-scoped, and
    // Medusa stores the cart id in the session context when available.
    // Same fallback story as customer_id: `input.data.cart_id` ships from
    // the storefront because the workflow doesn't always set context.cart_id.
    const cartId =
      ((input.context as unknown as Record<string, unknown>)?.cart_id as
        | string
        | undefined) ??
      ((input.data as { cart_id?: string } | undefined)?.cart_id) ??
      ""

    // Combined-funds shortfall: main + min(promo, per-tx cap).
    const cartSubtotal = await this.getCartSubtotalPaise(cartId, amount)
    const promoCap = await this.walletModule_.getPromoCapForCart(cartSubtotal)
    const promoUsable = Math.min(Number(wallet.promo_balance_inr ?? 0), promoCap)

    // Customer's promo-spend choice from the storefront slider. Clamp
    // to legal range — the storefront UI does this too but we re-check
    // here because input.data is untrusted.
    const rawOverride = (input.data as { promo_amount_inr?: number | string } | undefined)
      ?.promo_amount_inr
    const parsedOverride =
      rawOverride == null || rawOverride === ""
        ? null
        : Math.max(0, Math.floor(Number(rawOverride)))
    const promoOverride =
      parsedOverride == null
        ? null
        : Math.min(parsedOverride, promoUsable, amount)

    // Shortfall calculation respects the override: if the customer
    // opted to use less promo, we may need bank funds even though
    // promo + main would have covered it.
    const promoForShortfall = promoOverride == null ? promoUsable : promoOverride
    const combinedAvailable = Number(wallet.balance_inr) + promoForShortfall
    const shortfall = Math.max(0, amount - combinedAvailable)

    const attempt = await this.walletModule_.createPaymentAttempts({
      cart_id: cartId,
      customer_id: customerId,
      payment_session_id: null,
      amount_inr: amount,
      wallet_balance_at_init: wallet.balance_inr,
      shortfall_inr: shortfall,
      promo_amount_override_inr: promoOverride,
      status: "initiated",
    })

    return {
      id: attempt.id,
      status: "pending" as PaymentSessionStatus,
      data: {
        payment_attempt_id: attempt.id,
        customer_id: customerId,
        amount_inr: amount,
        wallet_balance_inr: combinedAvailable,
        main_balance_inr: Number(wallet.balance_inr),
        promo_balance_inr: Number(wallet.promo_balance_inr ?? 0),
        promo_usable_inr: promoUsable,
        promo_override_inr: promoOverride,
        shortfall_inr: shortfall,
      },
    }
  }

  /**
   * authorizePayment — always returns `authorized` so the cart can be
   * completed and the Order created. Two outcomes determine what actually
   * happens to the money:
   *
   *   1) Customer is KYC-approved AND wallet covers the total → debit the
   *      wallet now. Order is fully paid.
   *   2) Otherwise → don't debit. Record the attempt as `held` with the
   *      missing conditions (KYC, funds, or both). The Order still gets
   *      created; share fulfillment is gated on the hold clearing.
   *
   * The drain workflow (`captureHeldPaymentAttempts`) re-checks both
   * conditions on every wallet credit and debits/captures the attempts
   * whose conditions are fully met.
   */
  async authorizePayment(
    input: AuthorizePaymentInput
  ): Promise<AuthorizePaymentOutput> {
    const attemptId = (input.data as { payment_attempt_id?: string })
      ?.payment_attempt_id
    if (!attemptId) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        "cashfree-wallet: missing payment_attempt_id"
      )
    }
    const attempt = await this.walletModule_.retrievePaymentAttempt(attemptId)
    if (attempt.status === "debited" || attempt.status === "captured") {
      return {
        status: "authorized" as PaymentSessionStatus,
        data: {
          payment_attempt_id: attempt.id,
          wallet_debit_tx_id: attempt.wallet_debit_tx_id,
        },
      }
    }

    const kyc = await this.walletModule_.getKycStatus(attempt.customer_id)
    const wallet = await this.walletModule_.ensureWallet(attempt.customer_id)
    // Combined-funds check across both buckets. Promo drains first
    // (bounded by the per-tx cap) and main covers the rest, so we
    // need (main + min(promo, cap)) >= amount. We pre-compute the
    // cap to avoid surprising the customer with a held-order they
    // could ostensibly cover from promo balance.
    const cartSubtotal = await this.getCartSubtotalPaise(
      attempt.cart_id,
      attempt.amount_inr,
    )
    const promoCap = await this.walletModule_.getPromoCapForCart(cartSubtotal)
    const promoUsable = Math.min(Number(wallet.promo_balance_inr ?? 0), promoCap)
    // Honor the customer's promo-spend choice persisted at init time.
    // `combinedAvailable` reflects what main + the CHOSEN promo cover —
    // not the max-possible promo — so a customer who slid the promo
    // down to 0 and lacks main funds correctly lands on the held path.
    const promoOverride = (attempt as { promo_amount_override_inr?: number | null })
      ?.promo_amount_override_inr
    const promoCommitted = promoOverride == null ? promoUsable : Math.min(promoOverride, promoUsable)
    const combinedAvailable = Number(wallet.balance_inr) + promoCommitted
    const walletHasFunds = combinedAvailable >= attempt.amount_inr
    const kycApproved = kyc.overall === "approved"
    const allConditionsMet = walletHasFunds && kycApproved

    if (allConditionsMet) {
      const debit = await this.walletModule_.debitForOrder({
        customer_id: attempt.customer_id,
        amount_inr: attempt.amount_inr,
        cart_subtotal_inr: cartSubtotal,
        reference_type: "cart",
        reference_id: attempt.cart_id,
        idempotency_key: `attempt_${attempt.id}`,
        note: `checkout debit for cart ${attempt.cart_id}`,
        promo_override_inr: promoOverride ?? null,
      })
      if (debit.ok === true) {
        // Prefer the main-side tx id as the canonical "debit tx" so
        // existing reversals + admin tooling keyed on a single id
        // keep working. Promo-only orders (no main debit) record the
        // promo tx id instead.
        const canonicalTxId =
          debit.main_transaction_id ?? debit.promo_transaction_id ?? null
        const totalBalanceAfter =
          Number(debit.main_balance_after) + Number(debit.promo_balance_after)
        await this.walletModule_.updatePaymentAttempts({
          selector: { id: attempt.id },
          data: {
            status: "debited",
            wallet_debit_tx_id: canonicalTxId,
          },
        })
        return {
          status: "authorized" as PaymentSessionStatus,
          data: {
            payment_attempt_id: attempt.id,
            wallet_debit_tx_id: canonicalTxId,
            wallet_balance_after_inr: totalBalanceAfter,
            promo_amount_inr: debit.promo_amount_inr,
            main_amount_inr: debit.main_amount_inr,
            hold_state: null,
          },
        }
      }
      // If debit unexpectedly failed (race on balance), fall through to the
      // held path so the order still goes through.
    }

    // Held path — order is created, money isn't moved yet.
    const shortfall = Math.max(0, attempt.amount_inr - combinedAvailable)
    await this.walletModule_.updatePaymentAttempts({
      selector: { id: attempt.id },
      data: { status: "held", shortfall_inr: shortfall },
    })
    return {
      // Medusa needs `authorized` to proceed with order creation. We
      // honestly represent the state via the `data.hold_state` field so
      // storefront + admin UIs can render "awaiting KYC / funds".
      status: "authorized" as PaymentSessionStatus,
      data: {
        payment_attempt_id: attempt.id,
        hold_state: {
          awaiting_kyc: !kycApproved,
          awaiting_funds: !walletHasFunds,
          shortfall_inr: shortfall,
          /** Combined main + capped-promo. Naming retained for back-compat
           *  with admin UI; the storefront uses the breakdown below. */
          wallet_balance_inr: combinedAvailable,
          main_balance_inr: Number(wallet.balance_inr),
          promo_balance_inr: Number(wallet.promo_balance_inr ?? 0),
          promo_usable_inr: promoUsable,
          required_total_inr: attempt.amount_inr,
        },
      },
    }
  }

  async capturePayment(
    input: CapturePaymentInput
  ): Promise<CapturePaymentOutput> {
    // Wallet debit == capture. Nothing to do, just pass the data through.
    return { data: input.data ?? {} }
  }

  async cancelPayment(input: CancelPaymentInput): Promise<CancelPaymentOutput> {
    const attemptId = (input.data as { payment_attempt_id?: string })
      ?.payment_attempt_id
    if (!attemptId) return { data: input.data ?? {} }
    const attempt = await this.walletModule_
      .retrievePaymentAttempt(attemptId)
      .catch(() => null)
    if (!attempt) return { data: input.data ?? {} }

    if (attempt.status === "debited" && attempt.cart_id) {
      // Reverse ALL debit rows tied to this cart — handles both the
      // main + promo splits when a split debit happened. Each bucket
      // reverses to its source so promo can never become bank-money.
      await this.walletModule_.reverseOrderDebits({
        reference_id: attempt.cart_id,
        reason: "order_cancelled",
      })
    } else if (attempt.status === "debited" && attempt.wallet_debit_tx_id) {
      // Legacy fallback: pre-split-debit rows have no cart-keyed
      // debit pair, just one tx id.
      await this.walletModule_.reverseDebit({
        original_transaction_id: attempt.wallet_debit_tx_id,
        reason: "order_cancelled",
      })
    }
    await this.walletModule_.updatePaymentAttempts({
      selector: { id: attempt.id },
      data: { status: "cancelled" },
    })
    return { data: { ...(input.data as Record<string, unknown>), cancelled: true } }
  }

  async deletePayment(input: DeletePaymentInput): Promise<DeletePaymentOutput> {
    // Treat delete-session the same as cancel: if debited, reverse.
    await this.cancelPayment(input as unknown as CancelPaymentInput)
    return { data: input.data ?? {} }
  }

  async refundPayment(
    input: RefundPaymentInput
  ): Promise<RefundPaymentOutput> {
    const attemptId = (input.data as { payment_attempt_id?: string })
      ?.payment_attempt_id
    if (!attemptId) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        "cashfree-wallet: missing payment_attempt_id on refund"
      )
    }
    const attempt = await this.walletModule_.retrievePaymentAttempt(attemptId)
    const refundPaise = this.toPaise(input.amount)

    // Refund routing: promo-paid splits must go BACK to promo (promo
    // can never become bank-money). Look up the original debit rows
    // for this cart; refund up to `promo_amount_inr` to promo, the
    // remainder to main. Conservative — if no promo debit exists on
    // record, the whole refund goes to main (matches legacy behaviour).
    const debits = attempt.cart_id
      ? await this.walletModule_.listWalletTransactions(
          {
            reference_id: attempt.cart_id,
            direction: "debit",
            kind: "order_debit",
          } as any,
          { take: 10 },
        )
      : []
    const promoDebited = debits
      .filter((d: any) => d.bucket === "promo")
      .reduce((s: number, d: any) => s + Number(d.amount_inr ?? 0), 0)
    const refundToPromo = Math.min(refundPaise, promoDebited)
    const refundToMain = refundPaise - refundToPromo
    const ts = Date.now()

    if (refundToPromo > 0) {
      await this.walletModule_.creditPromo({
        customer_id: attempt.customer_id,
        amount_inr: refundToPromo,
        kind: "refund",
        reference_type: "order",
        reference_id: attempt.cart_id,
        idempotency_key: `refund_${attempt.id}_promo_${refundToPromo}_${ts}`,
        note: "admin refund (promo split)",
      })
    }
    if (refundToMain > 0) {
      await this.walletModule_.credit({
        customer_id: attempt.customer_id,
        amount_inr: refundToMain,
        kind: "refund",
        reference_type: "order",
        reference_id: attempt.cart_id,
        idempotency_key: `refund_${attempt.id}_main_${refundToMain}_${ts}`,
        note: "admin refund (main split)",
      })
    }
    return {
      data: {
        ...(input.data as Record<string, unknown>),
        refunded: refundPaise,
        refunded_to_promo: refundToPromo,
        refunded_to_main: refundToMain,
      },
    }
  }

  async retrievePayment(
    input: RetrievePaymentInput
  ): Promise<RetrievePaymentOutput> {
    const attemptId = (input.data as { payment_attempt_id?: string })
      ?.payment_attempt_id
    if (!attemptId) return { data: input.data ?? {} }
    const attempt = await this.walletModule_
      .retrievePaymentAttempt(attemptId)
      .catch(() => null)
    if (!attempt) return { data: input.data ?? {} }
    return {
      data: {
        payment_attempt_id: attempt.id,
        status: attempt.status,
        shortfall_inr: attempt.shortfall_inr,
        wallet_debit_tx_id: attempt.wallet_debit_tx_id,
      },
    }
  }

  async updatePayment(input: UpdatePaymentInput): Promise<UpdatePaymentOutput> {
    // Cart totals may change mid-checkout. Rescore the attempt's shortfall
    // against the new amount.
    const attemptId = (input.data as { payment_attempt_id?: string })
      ?.payment_attempt_id
    if (!attemptId) return { data: input.data ?? {} }
    const attempt = await this.walletModule_
      .retrievePaymentAttempt(attemptId)
      .catch(() => null)
    if (!attempt || attempt.status === "debited" || attempt.status === "captured") {
      return { data: input.data ?? {} }
    }
    const newAmount = this.toPaise(input.amount)
    const wallet = await this.walletModule_.ensureWallet(attempt.customer_id)
    // Combined-funds shortfall calc — promo bucket counts toward
    // covering the cart up to the per-tx cap, same as authorize.
    const cartSubtotal = await this.getCartSubtotalPaise(
      attempt.cart_id,
      newAmount,
    )
    const promoCap = await this.walletModule_.getPromoCapForCart(cartSubtotal)
    const promoUsable = Math.min(Number(wallet.promo_balance_inr ?? 0), promoCap)
    const combinedAvailable = Number(wallet.balance_inr) + promoUsable
    const shortfall = Math.max(0, newAmount - combinedAvailable)
    await this.walletModule_.updatePaymentAttempts({
      selector: { id: attempt.id },
      data: {
        amount_inr: newAmount,
        wallet_balance_at_init: wallet.balance_inr,
        shortfall_inr: shortfall,
      },
    })
    return {
      data: {
        payment_attempt_id: attempt.id,
        amount_inr: newAmount,
        shortfall_inr: shortfall,
        wallet_balance_inr: combinedAvailable,
      },
    }
  }

  async getPaymentStatus(
    input: GetPaymentStatusInput
  ): Promise<GetPaymentStatusOutput> {
    const attemptId = (input.data as { payment_attempt_id?: string })
      ?.payment_attempt_id
    if (!attemptId) {
      return { status: "pending" as PaymentSessionStatus }
    }
    const attempt = await this.walletModule_
      .retrievePaymentAttempt(attemptId)
      .catch(() => null)
    if (!attempt) return { status: "pending" as PaymentSessionStatus }
    const map: Record<typeof attempt.status, PaymentSessionStatus> = {
      initiated: "pending",
      debited: "authorized",
      held: "pending",
      captured: "captured",
      cancelled: "canceled",
    }
    return { status: map[attempt.status] ?? "pending" }
  }

  async getWebhookActionAndData(
    _payload: ProviderWebhookPayload["payload"]
  ): Promise<WebhookActionResult> {
    // VBA credits arrive on /webhooks/cashfree/vba, not via Medusa's payment
    // webhook router. Nothing for the provider to do here.
    return { action: "not_supported" } as WebhookActionResult
  }
}
