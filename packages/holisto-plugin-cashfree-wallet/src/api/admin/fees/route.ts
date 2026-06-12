import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { z } from "zod"
import {
  CASHFREE_WALLET_MODULE,
  CashfreeWalletService,
} from "../../../modules/cashfree_wallet"
import { logger } from "../../../utils/logger"

/**
 * GET  /admin/fees
 * POST /admin/fees
 *
 * Admin surface for the platform fees shown in checkout. Two knobs:
 *
 *   processing_fee — percentage of investment subtotal.
 *     Persistence: decimal (0.02 = 2%).
 *     API: whole-percent (2) for UI friendliness; the service layer
 *          normalises to decimal.
 *
 *   low_qty_fee — flat ₹ added when the investment subtotal is BELOW
 *                 a configurable threshold. Per order, not per item.
 *     Persistence + API: whole ₹ (integer).
 *
 * Auth is bound in src/api/middlewares.ts (admin session cookie).
 */

const SaveSchema = z.object({
  // processing_fee
  enabled: z.boolean().optional(),
  // Percent form (0-100). Accepts floats (e.g. 2.5).
  percent: z.number().min(0).max(100).optional(),
  // Per-scrip cap in whole ₹. Send `null` to clear the cap (uncapped
  // %-fee); omit to leave unchanged. 0 effectively disables the fee
  // while leaving the configured percent intact.
  max_inr: z.number().int().min(0).max(100_000_000).nullable().optional(),

  // low_qty_fee
  low_qty_enabled: z.boolean().optional(),
  // Whole ₹ — integer. 10_000 by default; 0 disables in practice.
  low_qty_threshold_inr: z.number().int().min(0).max(100_000_000).optional(),
  // Whole ₹ — integer. 250 by default; 0 disables in practice.
  low_qty_amount_inr: z.number().int().min(0).max(100_000_000).optional(),

  // ── Rewards section ──────────────────────────────────────────
  // Promo balance utilisation cap (per-tx). Floor of pct×subtotal vs flat.
  promo_payment_enabled: z.boolean().optional(),
  // UI sends whole-percent (e.g. 2 for 2%). Service stores as decimal.
  promo_max_pct_percent: z.number().min(0).max(100).optional(),
  promo_max_flat_inr: z.number().int().min(0).max(100_000_000).optional(),
  // Referral routing — per side, 'main' or 'promo'.
  referrer_credit_bucket: z.enum(["main", "promo"]).optional(),
  referee_credit_bucket: z.enum(["main", "promo"]).optional(),
  // Points → promo conversion.
  points_conversion_enabled: z.boolean().optional(),
  points_per_inr: z.number().int().min(1).max(100_000).optional(),
  points_min_convert: z.number().int().min(1).max(100_000_000).optional(),
  points_max_convert: z.number().int().min(1).max(100_000_000).optional(),
})

export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const walletModule = req.scope.resolve(
    CASHFREE_WALLET_MODULE
  ) as CashfreeWalletService
  try {
    const [pf, lq, rw] = await Promise.all([
      walletModule.getProcessingFeeSettings(),
      walletModule.getLowQtyFeeSettings(),
      walletModule.getRewardsSettings(),
    ])
    res.json({
      // Top-level fields kept for backward-compat with the existing
      // /app/fees page that reads `enabled` + `percent` + `rate`.
      enabled: pf.enabled,
      percent: pf.rate * 100,
      rate: pf.rate,
      // Nested groups carry the canonical shape.
      processing_fee: {
        enabled: pf.enabled,
        percent: pf.rate * 100,
        rate: pf.rate,
        max_inr: pf.max_inr,
      },
      low_qty_fee: {
        enabled: lq.enabled,
        threshold_inr: lq.threshold_inr,
        amount_inr: lq.amount_inr,
      },
      rewards: {
        // Promo cap. UI shows percent for friendliness; we send decimal too.
        promo_payment_enabled: rw.promo_payment_enabled,
        promo_max_pct_percent: rw.promo_max_pct_of_subtotal * 100,
        promo_max_pct_decimal: rw.promo_max_pct_of_subtotal,
        promo_max_flat_inr: rw.promo_max_flat_inr,
        // Referral routing.
        referrer_credit_bucket: rw.referrer_credit_bucket,
        referee_credit_bucket: rw.referee_credit_bucket,
        // Points conversion.
        points_conversion_enabled: rw.points_conversion_enabled,
        points_per_inr: rw.points_per_inr,
        points_min_convert: rw.points_min_convert,
        points_max_convert: rw.points_max_convert,
      },
    })
  } catch (err) {
    logger.error("getFees failed", { error: err })
    res
      .status(500)
      .json({ message: (err as Error).message ?? "fees_load_failed" })
  }
}

export const POST = async (req: MedusaRequest, res: MedusaResponse) => {
  const parsed = SaveSchema.safeParse(req.body)
  if (!parsed.success) {
    return res
      .status(400)
      .json({ message: "Invalid input", errors: parsed.error.flatten() })
  }
  const walletModule = req.scope.resolve(
    CASHFREE_WALLET_MODULE
  ) as CashfreeWalletService
  try {
    // Either bucket may be omitted from a request — only update what
    // the caller actually sent. Mirrors the partial-update contract
    // already used by the processing-fee path.
    const pfTouched =
      parsed.data.enabled !== undefined ||
      parsed.data.percent !== undefined ||
      parsed.data.max_inr !== undefined
    if (pfTouched) {
      await walletModule.saveProcessingFeeSettings({
        enabled: parsed.data.enabled,
        rate:
          parsed.data.percent !== undefined
            ? parsed.data.percent / 100
            : undefined,
        max_inr: parsed.data.max_inr,
      })
    }
    const lqTouched =
      parsed.data.low_qty_enabled !== undefined ||
      parsed.data.low_qty_threshold_inr !== undefined ||
      parsed.data.low_qty_amount_inr !== undefined
    if (lqTouched) {
      await walletModule.saveLowQtyFeeSettings({
        enabled: parsed.data.low_qty_enabled,
        threshold_inr: parsed.data.low_qty_threshold_inr,
        amount_inr: parsed.data.low_qty_amount_inr,
      })
    }
    const rwTouched =
      parsed.data.promo_payment_enabled !== undefined ||
      parsed.data.promo_max_pct_percent !== undefined ||
      parsed.data.promo_max_flat_inr !== undefined ||
      parsed.data.referrer_credit_bucket !== undefined ||
      parsed.data.referee_credit_bucket !== undefined ||
      parsed.data.points_conversion_enabled !== undefined ||
      parsed.data.points_per_inr !== undefined ||
      parsed.data.points_min_convert !== undefined ||
      parsed.data.points_max_convert !== undefined
    if (rwTouched) {
      await walletModule.saveRewardsSettings({
        promo_payment_enabled: parsed.data.promo_payment_enabled,
        promo_max_pct_of_subtotal:
          parsed.data.promo_max_pct_percent !== undefined
            ? parsed.data.promo_max_pct_percent / 100
            : undefined,
        promo_max_flat_inr: parsed.data.promo_max_flat_inr,
        referrer_credit_bucket: parsed.data.referrer_credit_bucket,
        referee_credit_bucket: parsed.data.referee_credit_bucket,
        points_conversion_enabled: parsed.data.points_conversion_enabled,
        points_per_inr: parsed.data.points_per_inr,
        points_min_convert: parsed.data.points_min_convert,
        points_max_convert: parsed.data.points_max_convert,
      })
    }
    const [pf, lq, rw] = await Promise.all([
      walletModule.getProcessingFeeSettings(),
      walletModule.getLowQtyFeeSettings(),
      walletModule.getRewardsSettings(),
    ])
    res.json({
      enabled: pf.enabled,
      percent: pf.rate * 100,
      rate: pf.rate,
      processing_fee: {
        enabled: pf.enabled,
        percent: pf.rate * 100,
        rate: pf.rate,
        max_inr: pf.max_inr,
      },
      low_qty_fee: {
        enabled: lq.enabled,
        threshold_inr: lq.threshold_inr,
        amount_inr: lq.amount_inr,
      },
      rewards: {
        promo_payment_enabled: rw.promo_payment_enabled,
        promo_max_pct_percent: rw.promo_max_pct_of_subtotal * 100,
        promo_max_pct_decimal: rw.promo_max_pct_of_subtotal,
        promo_max_flat_inr: rw.promo_max_flat_inr,
        referrer_credit_bucket: rw.referrer_credit_bucket,
        referee_credit_bucket: rw.referee_credit_bucket,
        points_conversion_enabled: rw.points_conversion_enabled,
        points_per_inr: rw.points_per_inr,
        points_min_convert: rw.points_min_convert,
        points_max_convert: rw.points_max_convert,
      },
    })

    // Bust the storefront's Next Data Cache for the fee-dependent
    // surfaces (BuyBox on every product page + cart) so admin changes
    // propagate within seconds. Without this:
    //   - /store/fees has Cache-Control max-age=60 + SWR=300 → stale
    //     for up to 6 min at the HTTP layer
    //   - The storefront keeps a 5-min in-memory + sessionStorage cache
    //     of the fee values
    //   - Combined window: ~10 min where the BuyBox + cart UI show
    //     OLD rates while the backend reconciler (which always reads
    //     fresh) writes the NEW rate at checkout. Cart total ≠ checkout
    //     total during the window.
    // Triggering revalidate on the storefront re-fetches /store/fees and
    // also re-renders product pages with the new BuyBox math. Sessionstorage
    // TTL we can't bust server-side, but its window is much smaller than
    // the HTTP cache.
    void revalidateStorefront([
      "/invest",
      "/cart",
      "/checkout",
    ]).catch((err) => {
      logger.warn("fees: storefront revalidate failed (non-fatal)", { err: (err as Error).message })
    })
  } catch (err) {
    logger.error("saveFees failed", { error: err })
    res
      .status(500)
      .json({ message: (err as Error).message ?? "fees_save_failed" })
  }
}

async function revalidateStorefront(paths: string[]) {
  const url = process.env.STOREFRONT_REVALIDATE_URL
  const secret =
    process.env.REVALIDATE_SECRET || process.env.CALCULA_WEBHOOK_SECRET
  if (!url || !secret) return
  await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-revalidate-secret": secret,
    },
    body: JSON.stringify({ paths }),
  })
}
