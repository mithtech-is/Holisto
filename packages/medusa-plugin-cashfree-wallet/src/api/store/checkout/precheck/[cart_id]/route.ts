import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import {
  CASHFREE_WALLET_MODULE,
  CashfreeWalletService,
} from "../../../../../modules/cashfree_wallet"
import { logger } from "../../../../../utils/logger"
import { reconcileCartProcessingFees } from "../../../../../utils/cart-processing-fee"

/**
 * GET /store/checkout/precheck/:cart_id
 *
 * Returns wallet + cart totals so the checkout UI can render whether the
 * purchase will debit wallet or hold the order pending a VBA deposit.
 *
 * Response:
 * {
 *   wallet_balance_inr: number,        // paise
 *   cart_total_inr: number,            // paise
 *   shortfall_inr: number,             // paise (0 if covered)
 *   will_be_held: boolean,             // true if shortfall > 0
 *   virtual_account: {...} | null,     // present when will_be_held
 *   kyc_approved: boolean,             // gate for enabling "Pay" button
 *   processing_fee: {                  // platform fee snapshot
 *     base_rate: number,               // 0.02 = 2% (admin-configured)
 *     tier_discount_pct: number,       // 0..100 (gamification tier perk)
 *     effective_rate: number,          // base_rate × (1 - tier_discount/100)
 *   }
 * }
 */
export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const customerId = (req as any).auth_context?.app_metadata?.customer_id as
    | string
    | undefined
  if (!customerId) return res.status(401).json({ message: "Not authenticated" })

  const { cart_id } = req.params

  const cartModule = req.scope.resolve("cart") as any
  // Reconcile the per-scrip processing fee + low-qty fee BEFORE reading
  // cart.total so the precheck total matches what the storefront cart
  // UI displays AND what the wallet will be debited. Pass customerId so
  // the reconciler can apply the gamification tier discount on the
  // processing-fee component — without this, a tier-eligible user
  // would see a discounted fee on the product page and a higher fee on
  // the cart/checkout, then be debited the higher amount. Non-fatal —
  // if reconciliation fails we still serve the precheck with the
  // un-feed total so checkout doesn't hard-fail on a transient DB blip.
  await reconcileCartProcessingFees(req.scope, cart_id, { customerId }).catch((err) => {
    logger.warn("precheck: processing-fee reconcile failed (non-fatal)", {
      cart_id,
      err: (err as Error).message,
    })
  })

  const cart = await cartModule.retrieveCart(cart_id, {
    select: ["id", "customer_id", "total"],
    relations: ["items"],
  }).catch((err: unknown) => {
    logger.warn("precheck: cart lookup failed", { cart_id, err })
    return null
  })

  if (!cart) return res.status(404).json({ message: "Cart not found" })
  if (cart.customer_id && cart.customer_id !== customerId) {
    return res.status(403).json({ message: "Forbidden" })
  }

  const walletModule = req.scope.resolve(
    CASHFREE_WALLET_MODULE
  ) as CashfreeWalletService

  // Tier discount removed along with the gamification feature — always 0.
  const [summary, kyc, feeSettings, tierDiscount] = await Promise.all([
    walletModule.getWalletSummary(customerId),
    walletModule.getKycStatus(customerId),
    walletModule.getProcessingFeeSettings(),
    Promise.resolve(0),
  ])

  // Medusa cart totals are in major units (rupees). Convert to paise.
  const cartTotalRupees = Number(cart.total ?? 0)
  const cartTotalPaise = Math.round(cartTotalRupees * 100)

  // Compute the cart's line-item subtotal (qty × unit_price summed)
  // — needed for the per-tx promo cap (`max(pct × subtotal, flat)`).
  // Same math as /store/gamification/checkout-credit so the promo
  // coverage figure here matches what the wallet provider applies at
  // authorize time.
  const items = Array.isArray(cart?.items) ? cart.items : []
  const itemSubtotalRupees = items.reduce((sum: number, it: any) => {
    const qty = Number(it?.quantity ?? 0)
    const unit = Number(it?.unit_price ?? 0)
    return sum + qty * unit
  }, 0)
  const itemSubtotalPaise = Math.round(itemSubtotalRupees * 100)
  const promoCap = await walletModule.getPromoCapForCart(itemSubtotalPaise)
  const promoUsable = Math.min(
    Number(summary.promo_balance_inr ?? 0),
    promoCap,
  )
  const combinedAvailable = Number(summary.balance_inr) + promoUsable
  // Shortfall measured against the COMBINED bucket — matches what the
  // wallet provider will actually do at authorize. The storefront uses
  // `will_be_held` to render the "add funds first" branch, so an
  // accurate combined-balance check here prevents a spurious hold
  // warning when promo would cover the gap.
  const shortfall = Math.max(0, cartTotalPaise - combinedAvailable)

  // Tier discount is a fraction (0..1). Effective rate is base × (1−d).
  // We expose all three values so the storefront can render the
  // discount line item without re-deriving the math.
  const baseRate = feeSettings.enabled ? feeSettings.rate : 0
  const tierDiscountFraction = Math.max(0, Math.min(1, tierDiscount))
  const effectiveRate = baseRate * (1 - tierDiscountFraction)

  res.json({
    /** Combined main + capped-promo. Naming retained for back-compat;
     *  the storefront's existing UI references this single field. */
    wallet_balance_inr: combinedAvailable,
    main_balance_inr: Number(summary.balance_inr),
    promo_balance_inr: Number(summary.promo_balance_inr ?? 0),
    promo_usable_inr: promoUsable,
    promo_cap_inr: promoCap,
    cart_total_inr: cartTotalPaise,
    item_subtotal_inr: itemSubtotalPaise,
    shortfall_inr: shortfall,
    will_be_held: shortfall > 0,
    // The customer may have multiple VBAs (one per linked bank). The
    // checkout UX shows all of them with a hint that any can be used to
    // add funds the shortfall.
    virtual_accounts: summary.virtual_accounts,
    kyc_approved: kyc.overall === "approved",
    kyc: kyc,
    processing_fee: {
      base_rate: baseRate,
      tier_discount_pct: Math.round(tierDiscountFraction * 100 * 100) / 100,
      effective_rate: effectiveRate,
    },
  })
}
