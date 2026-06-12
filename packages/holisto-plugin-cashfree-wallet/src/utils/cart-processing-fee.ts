/**
 * Cart processing-fee reconciler.
 *
 * Why this exists
 * ---------------
 * The storefront cart UI shows a per-scrip processing fee
 * (`min(line_subtotal × rate, max_inr)`) but Medusa's `cart.total`
 * was historically computed off line-item subtotal alone. That gap
 * meant the wallet got debited the un-feed total at checkout, while
 * the customer was promised the with-fee total on the cart page. This
 * helper closes the gap by writing one `cart_line_item_tax_line` row
 * per live cart line item with `code = 'processing_fee'` and a rate
 * derived from the configured percent + per-scrip cap. Medusa's
 * built-in totalizer adds tax_lines into `cart.total`, so the payment
 * collection / payment session / wallet debit all line up with what
 * the storefront displayed.
 *
 * Why a tax line and not an adjustment
 * ------------------------------------
 * `cart_line_item_adjustment` has a CHECK (amount >= 0) and is
 * subtracted from line total — it represents discounts. The only
 * schema path in Medusa V2 that ADDS to `cart.total` per line is
 * `cart_line_item_tax_line`. We deliberately reuse it for the fee
 * with a clear `code` so admin views and downstream consumers can
 * tell it apart from real GST.
 *
 * Cap semantics
 * -------------
 * Cap is per cart line item (per scrip / per ISIN). A cart with two
 * different scrips, each above the cap, pays `cap × 2` total — one
 * cap per line. Multiple line items for the SAME variant in the same
 * cart are separate `cart_line_item` rows; each is capped on its own.
 *
 * The tax_line schema stores a `rate` (real) — not a flat amount.
 * To honour an absolute cap, we compute an EFFECTIVE rate per line:
 *
 *   desired_fee     = min(line_subtotal × base_rate, max_inr)
 *   effective_rate  = desired_fee / line_subtotal   (≤ base_rate)
 *
 * For uncapped or under-cap lines, effective_rate = base_rate.
 *
 * Idempotency
 * -----------
 * Re-running on the same cart is a no-op when nothing has changed.
 * When quantities / unit_price / settings change, the old rows are
 * replaced (soft-deleted) and fresh ones inserted. We key the rows by
 * `(item_id, code = 'processing_fee')`.
 */

import {
  ContainerRegistrationKeys,
  generateEntityId,
} from "@medusajs/framework/utils"
import { CASHFREE_WALLET_MODULE, type CashfreeWalletService } from "../modules/cashfree_wallet"

export type ReconcileResult = {
  cart_id: string
  reconciled_lines: number
  upserted: number
  removed: number
  fee_total_rupees: number
  low_qty_fee_total_rupees: number
  tier_discount_fraction: number
}

const TAX_LINE_CODE_PROCESSING = "processing_fee"
const TAX_LINE_CODE_LOW_QTY = "low_qty_fee"

export async function reconcileCartProcessingFees(
  scope: any,
  cartId: string,
  options: { customerId?: string | null } = {},
): Promise<ReconcileResult> {
  if (!cartId) {
    return {
      cart_id: "",
      reconciled_lines: 0,
      upserted: 0,
      removed: 0,
      fee_total_rupees: 0,
      low_qty_fee_total_rupees: 0,
      tier_discount_fraction: 0,
    }
  }

  const knex: any = scope.resolve(ContainerRegistrationKeys.PG_CONNECTION)
  const walletModule = scope.resolve(CASHFREE_WALLET_MODULE) as CashfreeWalletService

  // Both fee buckets in one shot. low_qty_fee is per-line, flat amount;
  // processing_fee is per-line %; tier discount is per-customer % off
  // the processing-fee component.
  const [pSettings, lqSettings] = await Promise.all([
    walletModule.getProcessingFeeSettings(),
    walletModule.getLowQtyFeeSettings(),
  ])

  // Tier discount removed along with the gamification feature — always 0.
  const tierDiscountFraction = 0

  // Live (not-soft-deleted) line items only. We deliberately do NOT
  // select `subtotal` — Medusa v2 doesn't store that as a column on
  // cart_line_item (it's computed from quantity × unit_price by the
  // totalizer at read time). Selecting it threw
  // `column "subtotal" does not exist` and silently failed every
  // reconcile, leaving cart.total without our fee tax_lines and
  // making checkout debit only the item subtotal.
  const items = await knex("cart_line_item")
    .select(["id", "quantity", "unit_price"])
    .where({ cart_id: cartId })
    .whereNull("deleted_at")

  let upserted = 0
  let removed = 0
  let processingFeeTotal = 0
  let lowQtyFeeTotal = 0
  const now = new Date()

  // Helper: idempotently write/update/remove a single tax_line for a
  // given (itemId, code, desiredRate). Returns deltas to roll up.
  const upsertTaxLine = async (
    itemId: string,
    code: string,
    desiredRate: number,
    description: string,
  ): Promise<{ upserted: number; removed: number }> => {
    const existing = await knex("cart_line_item_tax_line")
      .select(["id", "rate"])
      .where({ item_id: itemId, code })
      .whereNull("deleted_at")
      .first()

    if (desiredRate <= 0) {
      if (existing) {
        await knex("cart_line_item_tax_line")
          .where({ id: existing.id })
          .update({ deleted_at: now })
        return { upserted: 0, removed: 1 }
      }
      return { upserted: 0, removed: 0 }
    }

    if (!existing) {
      await knex("cart_line_item_tax_line").insert({
        id: generateEntityId(undefined, "clitl"),
        item_id: itemId,
        code,
        description,
        rate: desiredRate,
        provider_id: `polemarch-${code.replace(/_/g, "-")}`,
        created_at: now,
        updated_at: now,
      })
      return { upserted: 1, removed: 0 }
    }
    if (Math.abs(Number(existing.rate) - desiredRate) > 1e-9) {
      await knex("cart_line_item_tax_line")
        .where({ id: existing.id })
        .update({ rate: desiredRate, description, updated_at: now })
      return { upserted: 1, removed: 0 }
    }
    return { upserted: 0, removed: 0 }
  }

  for (const row of items) {
    const itemId = row.id as string
    const qty = Number(row.quantity ?? 0)
    const unit = Number(row.unit_price ?? 0)
    // Compute line subtotal from quantity × unit_price. Medusa v2 does
    // not persist `subtotal` on cart_line_item — that column doesn't
    // exist; the totalizer derives it at read time.
    const lineSubtotal = qty * unit

    // ── processing_fee ──────────────────────────────────────────
    // Per scrip: `min(line_subtotal × rate, max_inr) × (1 − tier%)`.
    const wantProcessing =
      pSettings.enabled && lineSubtotal > 0 && pSettings.rate > 0
    const cappedProcessing = wantProcessing
      ? pSettings.max_inr != null
        ? Math.min(lineSubtotal * pSettings.rate, pSettings.max_inr)
        : lineSubtotal * pSettings.rate
      : 0
    const discountedProcessing =
      cappedProcessing * (1 - tierDiscountFraction)
    // Medusa V2's `cart_line_item_tax_line.rate` is interpreted as a
    // PERCENTAGE (0..100), not a fraction (0..1) — the totalizer
    // applies `subtotal × rate / 100`. Storing 0.02 here would yield
    // a 0.02% fee instead of 2%. Multiply by 100 so the on-cart value
    // matches what we computed.
    const processingRate = wantProcessing
      ? (discountedProcessing / lineSubtotal) * 100
      : 0
    processingFeeTotal += discountedProcessing

    const pPctStr = (pSettings.rate * 100).toFixed(2)
    const tierStr =
      tierDiscountFraction > 0
        ? `, ${(tierDiscountFraction * 100).toFixed(2)}% tier discount`
        : ""
    const capStr =
      pSettings.max_inr != null
        ? `, max ₹${pSettings.max_inr.toLocaleString("en-IN")}/scrip`
        : ""
    const pDesc = `Processing fee (${pPctStr}%${capStr}${tierStr})`
    const pResult = await upsertTaxLine(
      itemId,
      TAX_LINE_CODE_PROCESSING,
      processingRate,
      pDesc,
    )
    upserted += pResult.upserted
    removed += pResult.removed

    // ── low_qty_fee ────────────────────────────────────────────
    // Flat ₹ when line subtotal is BELOW threshold. Encoded as a
    // tax_line rate (= amount / subtotal) so Medusa's totalizer picks
    // it up the same way it picks up processing_fee. Without this the
    // cart UI added the fee to its display total but the wallet was
    // never debited it — silent revenue leak on small orders.
    const wantLowQty =
      lqSettings.enabled &&
      lineSubtotal > 0 &&
      lineSubtotal < lqSettings.threshold_inr &&
      lqSettings.amount_inr > 0
    const lowQtyAmount = wantLowQty ? lqSettings.amount_inr : 0
    // Same percentage-not-fraction convention as the processing-fee
    // rate above — Medusa applies `subtotal × rate / 100`.
    const lowQtyRate = wantLowQty ? (lowQtyAmount / lineSubtotal) * 100 : 0
    lowQtyFeeTotal += lowQtyAmount

    const lqDesc = `Low-quantity fee (₹${lqSettings.amount_inr.toLocaleString(
      "en-IN",
    )} per ISIN below ₹${lqSettings.threshold_inr.toLocaleString("en-IN")})`
    const lqResult = await upsertTaxLine(
      itemId,
      TAX_LINE_CODE_LOW_QTY,
      lowQtyRate,
      lqDesc,
    )
    upserted += lqResult.upserted
    removed += lqResult.removed
  }

  // Also reap orphaned tax lines whose underlying line item was soft-
  // deleted — Medusa's FK uses ON DELETE CASCADE only on a hard delete.
  // Sweep BOTH our codes in one query.
  await knex("cart_line_item_tax_line")
    .whereIn("code", [TAX_LINE_CODE_PROCESSING, TAX_LINE_CODE_LOW_QTY])
    .whereNull("deleted_at")
    .whereIn(
      "item_id",
      knex("cart_line_item")
        .select("id")
        .where({ cart_id: cartId })
        .whereNotNull("deleted_at"),
    )
    .update({ deleted_at: now })

  return {
    cart_id: cartId,
    reconciled_lines: items.length,
    upserted,
    removed,
    fee_total_rupees: Math.round(processingFeeTotal * 100) / 100,
    low_qty_fee_total_rupees: Math.round(lowQtyFeeTotal * 100) / 100,
    tier_discount_fraction: tierDiscountFraction,
  }
}
