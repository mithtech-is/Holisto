import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import {
  CASHFREE_WALLET_MODULE,
  CashfreeWalletService,
} from "../../../modules/cashfree_wallet"

/**
 * GET /store/fees
 *
 * Public endpoint the storefront reads on every cart render so the
 * displayed fees match what the admin has configured.
 *
 * Response shape:
 *   {
 *     "processing_fee": {
 *       "enabled": true,
 *       "rate":    0.02,   // decimal form, storefront multiplies
 *       "percent": 2       // %-form, for display
 *     },
 *     "low_qty_fee": {
 *       "enabled":       true,
 *       "threshold_inr": 10000,   // apply when investment subtotal < this
 *       "amount_inr":    250      // flat ₹ added when threshold is hit
 *     }
 *   }
 *
 * Cached at the HTTP layer for 30s + 60s SWR. Aggressive enough that
 * an admin fee change propagates within ~30s without forced
 * invalidation, conservative enough to amortise repeat reads from a
 * single product-page session. The /admin/fees POST handler ALSO fires
 * a Next-side revalidate for `/invest`, `/cart`, `/checkout` so the
 * Data Cache flushes immediately for SSR — this Cache-Control is the
 * fallback for anything the revalidate didn't reach (CSR fetches +
 * other tabs / browser HTTP cache).
 */
export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const walletModule = req.scope.resolve(
    CASHFREE_WALLET_MODULE
  ) as CashfreeWalletService
  try {
    const [pf, lq] = await Promise.all([
      walletModule.getProcessingFeeSettings(),
      walletModule.getLowQtyFeeSettings(),
    ])
    res.setHeader(
      "Cache-Control",
      "public, max-age=30, stale-while-revalidate=60"
    )
    res.json({
      processing_fee: {
        enabled: pf.enabled,
        rate: pf.rate,
        percent: pf.rate * 100,
        // Per-scrip cap in whole ₹. `null` ⇒ no cap. Storefront applies
        // `min(line_subtotal × rate, max_inr)` per cart line item.
        max_inr: pf.max_inr,
      },
      low_qty_fee: {
        enabled: lq.enabled,
        threshold_inr: lq.threshold_inr,
        amount_inr: lq.amount_inr,
      },
    })
  } catch (err) {
    // Return defaults on failure so checkout never hard-fails for a
    // transient DB blip; the storefront will treat a missing response
    // the same way.
    res.status(500).json({
      processing_fee: { enabled: true, rate: 0.02, percent: 2, max_inr: null },
      low_qty_fee: { enabled: true, threshold_inr: 10000, amount_inr: 250 },
      error: (err as Error).message,
    })
  }
}
