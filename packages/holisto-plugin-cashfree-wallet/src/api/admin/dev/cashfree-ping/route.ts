import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { CashfreeApiError } from "../../../../modules/cashfree_wallet/cashfree/client"
import {
  CASHFREE_WALLET_MODULE,
  CashfreeWalletService,
} from "../../../../modules/cashfree_wallet"
import type { CashfreeProduct } from "../../../../modules/cashfree_wallet/service"

/**
 * GET /admin/dev/cashfree-ping?product=<product>
 *
 * Smoke test: confirms the live Cashfree credentials for a product reach
 * the API. Reads creds via the wallet service (DB row first, env-var
 * fallback) so it tests exactly what production code paths would see.
 *
 * For verification_suite we hit /verification/pan with an intentionally
 * bad PAN — Cashfree responds 422 when auth is accepted (creds work) or
 * 401/403 when auth is rejected. For every other product we fall back to
 * a credential-readiness check (we don't want to accidentally call a
 * money-moving endpoint in prod).
 *
 * Default product is `verification_suite` to preserve the old URL
 * semantics for any existing admin bookmarks.
 *
 * Output is secrets-free (only configured booleans + env + ping result),
 * safe to call in production to verify a key rotation landed.
 */
const VALID_PRODUCTS: readonly CashfreeProduct[] = [
  "payment_gateway",
  "payouts",
  "subscriptions",
  "cross_border",
  "verification_suite",
]

export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const walletModule = req.scope.resolve(
    CASHFREE_WALLET_MODULE
  ) as CashfreeWalletService
  const productParam = (req.query.product as string) || "verification_suite"
  const product = (VALID_PRODUCTS as readonly string[]).includes(productParam)
    ? (productParam as CashfreeProduct)
    : null

  if (!product) {
    return res
      .status(400)
      .json({ message: `unknown product '${productParam}'` })
  }

  const hasEncKey = !!(
    process.env.AT_REST_ENCRYPTION_KEY || process.env.WALLET_ENCRYPTION_KEY
  )
  const view = await walletModule.getCashfreeProductView(product)
  const activeEnv = view.active_env
  const envView = view.envs[activeEnv]
  const configured = {
    enabled: view.enabled,
    client_id: !!envView.client_id,
    client_secret: envView.client_secret_set,
    webhook_secret: envView.webhook_secret_set,
    encryption_key: hasEncKey,
  }

  if (!view.enabled) {
    return res.json({
      product,
      env: activeEnv,
      configured,
      ping: { ok: false, reason: "product_disabled" },
    })
  }
  if (!envView.client_id || !envView.client_secret_set) {
    return res.json({
      product,
      env: activeEnv,
      configured,
      ping: { ok: false, reason: "credentials_missing" },
    })
  }

  // Active probe — currently only implemented for verification_suite. For
  // other products we stop at "credentials present" to avoid invoking
  // money-moving endpoints during a ping.
  if (product !== "verification_suite") {
    return res.json({
      product,
      env: activeEnv,
      configured,
      ping: {
        ok: true,
        message: "credentials present — active probe not implemented for this product",
      },
    })
  }

  let pingOk = false
  let pingMessage = ""
  try {
    const client = await walletModule.getCashfreeClientForProduct(
      "verification_suite"
    )
    await client.request({
      method: "POST",
      path: "/verification/pan",
      body: { pan: "AAAAA0000A", name: "ping" },
      timeoutMs: 8000,
    })
    pingOk = true
    pingMessage = "verification.pan accepted"
  } catch (err) {
    if (err instanceof CashfreeApiError) {
      if (err.status === 401 || err.status === 403) {
        pingOk = false
        pingMessage = `auth_rejected: ${err.status}`
      } else {
        pingOk = true
        pingMessage = `creds_ok (api responded ${err.status})`
      }
    } else {
      pingOk = false
      pingMessage = `network_error: ${(err as Error).message}`
    }
  }

  res.json({
    product,
    env: activeEnv,
    configured,
    ping: { ok: pingOk, message: pingMessage },
  })
}
