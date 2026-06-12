import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { logger } from "../../../../utils/logger"

/**
 * GET /store/ifsc/:code   — e.g. /store/ifsc/SBIN0000300
 *
 * Proxy to Razorpay's free IFSC lookup API
 * (https://github.com/razorpay/ifsc/wiki/API). The storefront calls
 * this in the first step of the add-bank wizard so the user can
 * confirm the branch ("Is this your bank?") before typing their
 * account number twice + sending to Cashfree.
 *
 * Why proxied through our backend rather than the storefront fetching
 * Razorpay directly:
 *   1. Avoid mixing third-party network calls into the customer's
 *      browser request waterfall — keeps our CSP narrow.
 *   2. Single rate-limit / abuse surface (medusa rate-limit on the
 *      authenticated route, not "anyone hitting the storefront").
 *   3. Easy to swap the upstream later without re-shipping the
 *      storefront.
 *
 * Razorpay's API is unauthenticated, ETag-cached, and serves
 * `Cache-Control: public, max-age=86400`. We forward without further
 * caching — Cloudflare in front already absorbs hot IFSCs. 404 from
 * upstream → 404 from us.
 */
const IFSC_REGEX = /^[A-Z]{4}0[A-Z0-9]{6}$/

export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const customerId = (req as any).auth_context?.app_metadata?.customer_id as
    | string
    | undefined
  if (!customerId) {
    return res.status(401).json({ message: "Not authenticated" })
  }

  const codeParam = (req.params.code as string | undefined) ?? ""
  const ifsc = codeParam.trim().toUpperCase()
  if (!IFSC_REGEX.test(ifsc)) {
    return res.status(400).json({
      ok: false,
      message:
        "IFSC must be 11 characters: 4 letters, then 0, then 6 alphanumeric.",
    })
  }

  try {
    const ac = new AbortController()
    const timer = setTimeout(() => ac.abort(), 6_000)
    const upstream = await fetch(`https://ifsc.razorpay.com/${ifsc}`, {
      signal: ac.signal,
      headers: {
        // Be a polite caller — Razorpay's lookup is free but they do
        // log User-Agent on weird traffic spikes.
        "User-Agent": "Polemarch/1.0 (+https://polemarch.in)",
        Accept: "application/json",
      },
    }).catch((err) => {
      throw new Error(`upstream_fetch_failed: ${(err as Error).message}`)
    })
    clearTimeout(timer)

    if (upstream.status === 404) {
      return res.status(404).json({
        ok: false,
        message:
          "IFSC not found. Double-check the code on your cheque or passbook.",
      })
    }
    if (!upstream.ok) {
      logger.warn("ifsc lookup upstream failed", {
        ifsc,
        status: upstream.status,
      })
      return res.status(502).json({
        ok: false,
        message: "IFSC directory unavailable. Try again in a moment.",
      })
    }

    const data = (await upstream.json().catch(() => null)) as
      | Record<string, unknown>
      | null
    if (!data || typeof data !== "object") {
      return res.status(502).json({
        ok: false,
        message: "IFSC directory returned an empty payload.",
      })
    }

    // Razorpay returns BANK / IFSC / BRANCH / ADDRESS / CITY /
    // DISTRICT / STATE / MICR / CONTACT / UPI / RTGS / NEFT / IMPS /
    // BANKCODE / CENTRE / SWIFT (sometimes). We pass them through
    // verbatim — the storefront renders whatever fields land.
    return res.json({
      ok: true,
      ifsc,
      branch: {
        bank: (data as any).BANK as string | undefined,
        ifsc: (data as any).IFSC as string | undefined,
        branch: (data as any).BRANCH as string | undefined,
        address: (data as any).ADDRESS as string | undefined,
        city: (data as any).CITY as string | undefined,
        district: (data as any).DISTRICT as string | undefined,
        state: (data as any).STATE as string | undefined,
        centre: (data as any).CENTRE as string | undefined,
        contact: (data as any).CONTACT as string | undefined,
        micr: (data as any).MICR as string | undefined,
        bank_code: (data as any).BANKCODE as string | undefined,
        swift: (data as any).SWIFT as string | undefined,
        upi: Boolean((data as any).UPI),
        rtgs: Boolean((data as any).RTGS),
        neft: Boolean((data as any).NEFT),
        imps: Boolean((data as any).IMPS),
        nach: Boolean((data as any).NACH),
        iso3166: (data as any).ISO3166 as string | undefined,
      },
    })
  } catch (err) {
    logger.warn("ifsc lookup failed", {
      ifsc,
      error: (err as Error).message,
    })
    return res.status(502).json({
      ok: false,
      message: "IFSC directory unreachable. Try again in a moment.",
    })
  }
}
