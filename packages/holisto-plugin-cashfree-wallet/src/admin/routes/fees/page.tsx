import React, { useCallback, useEffect, useState } from "react"
import { defineRouteConfig } from "@medusajs/admin-sdk"
import {
  Button,
  Container,
  Heading,
  Input,
  Label,
  Select,
  StatusBadge,
  Switch,
  Text,
} from "@medusajs/ui"
import { CurrencyDollar } from "@medusajs/icons"

/**
 * /app/fees — admin control for the platform fees shown on every
 * checkout. Two sections, each with its own Save button so an
 * accidental edit on one doesn't trigger a save on the other:
 *
 *   1. Processing fee
 *      - Enabled:  kill switch.
 *      - Percent:  fee as a whole-percent (e.g. 2 for 2%). Stored
 *                  as decimal (0.02) on the backend.
 *
 *   2. Low-quantity flat fee
 *      - Enabled:    kill switch.
 *      - Threshold:  apply the flat fee when the line-item
 *                    subtotal is BELOW this ₹ amount. 0 disables.
 *      - Amount:     flat ₹ added per order when threshold hits.
 *
 * Consumers:
 *   - Storefront /cart page reads `/store/fees` on render and
 *     applies the live values. Previously hard-coded in
 *     `storefront/src/lib/constants.ts` (kept as fallback).
 *   - No effect on orders already placed — only changes apply to
 *     FUTURE cart totals.
 */

type ProcessingFeeView = {
  enabled: boolean
  percent: number
  rate: number
  /** Per-scrip cap in whole ₹. `null` = uncapped. */
  max_inr: number | null
}
type LowQtyFeeView = {
  enabled: boolean
  threshold_inr: number
  amount_inr: number
}

type RewardsView = {
  promo_payment_enabled: boolean
  promo_max_pct_percent: number
  promo_max_pct_decimal: number
  promo_max_flat_inr: number
  referrer_credit_bucket: "main" | "promo"
  referee_credit_bucket: "main" | "promo"
  points_conversion_enabled: boolean
  points_per_inr: number
  points_min_convert: number
  points_max_convert: number
}

const FeesPage = () => {
  // Processing-fee state
  const [pfView, setPfView] = useState<ProcessingFeeView | null>(null)
  const [pfEnabled, setPfEnabled] = useState(true)
  const [pfPercent, setPfPercent] = useState<string>("2")
  // Empty string = no cap (uncapped %-fee). A non-empty string is
  // parsed as whole ₹ on save and clamped at 0.
  const [pfMax, setPfMax] = useState<string>("")
  const [pfSaving, setPfSaving] = useState(false)
  const [pfFlash, setPfFlash] = useState<string | null>(null)

  // Low-qty-fee state
  const [lqView, setLqView] = useState<LowQtyFeeView | null>(null)
  const [lqEnabled, setLqEnabled] = useState(true)
  const [lqThreshold, setLqThreshold] = useState<string>("10000")
  const [lqAmount, setLqAmount] = useState<string>("250")
  const [lqSaving, setLqSaving] = useState(false)
  const [lqFlash, setLqFlash] = useState<string | null>(null)

  // Rewards state — promo cap + points conversion. Referral
  // routing (per-side bucket / amount / min purchase) lives on
  // /app/referral now; we don't bind to it here.
  const [rwView, setRwView] = useState<RewardsView | null>(null)
  const [rwPromoEnabled, setRwPromoEnabled] = useState(true)
  const [rwPromoPctPercent, setRwPromoPctPercent] = useState<string>("2")
  const [rwPromoFlat, setRwPromoFlat] = useState<string>("500")
  const [rwPointsEnabled, setRwPointsEnabled] = useState(true)
  const [rwPointsPerInr, setRwPointsPerInr] = useState<string>("100")
  const [rwPointsMin, setRwPointsMin] = useState<string>("100")
  const [rwPointsMax, setRwPointsMax] = useState<string>("100000")
  const [rwSaving, setRwSaving] = useState(false)
  const [rwFlash, setRwFlash] = useState<string | null>(null)

  // Shared
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch("/admin/fees", { credentials: "include" })
      const body = await res.json()
      if (!res.ok) throw new Error(body.message || "load_failed")

      const pf: ProcessingFeeView = body.processing_fee ?? {
        enabled: !!body.enabled,
        percent: body.percent ?? 2,
        rate: body.rate ?? 0.02,
        max_inr: null,
      }
      setPfView(pf)
      setPfEnabled(!!pf.enabled)
      setPfPercent(String(pf.percent ?? 2))
      setPfMax(pf.max_inr == null ? "" : String(pf.max_inr))

      const lq: LowQtyFeeView = body.low_qty_fee ?? {
        enabled: true,
        threshold_inr: 10000,
        amount_inr: 250,
      }
      setLqView(lq)
      setLqEnabled(!!lq.enabled)
      setLqThreshold(String(lq.threshold_inr ?? 10000))
      setLqAmount(String(lq.amount_inr ?? 250))

      const rw: RewardsView = body.rewards ?? {
        promo_payment_enabled: true,
        promo_max_pct_percent: 2,
        promo_max_pct_decimal: 0.02,
        promo_max_flat_inr: 500,
        referrer_credit_bucket: "promo",
        referee_credit_bucket: "promo",
        points_conversion_enabled: true,
        points_per_inr: 100,
        points_min_convert: 100,
        points_max_convert: 100000,
      }
      setRwView(rw)
      setRwPromoEnabled(!!rw.promo_payment_enabled)
      setRwPromoPctPercent(String(rw.promo_max_pct_percent ?? 2))
      setRwPromoFlat(String(rw.promo_max_flat_inr ?? 500))
      setRwPointsEnabled(!!rw.points_conversion_enabled)
      setRwPointsPerInr(String(rw.points_per_inr ?? 100))
      setRwPointsMin(String(rw.points_min_convert ?? 100))
      setRwPointsMax(String(rw.points_max_convert ?? 100000))
    } catch (e) {
      setError(e instanceof Error ? e.message : "failed")
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  const saveProcessingFee = async () => {
    setPfSaving(true)
    setError(null)
    setPfFlash(null)
    try {
      const pct = Number(pfPercent)
      if (!Number.isFinite(pct) || pct < 0 || pct > 100) {
        throw new Error("Percent must be a number between 0 and 100")
      }
      // Empty input → null (clear the cap). Otherwise parse as
      // non-negative whole ₹. Anything else throws.
      const trimmed = pfMax.trim()
      let maxInr: number | null
      if (trimmed === "") {
        maxInr = null
      } else {
        const n = Math.trunc(Number(trimmed))
        if (!Number.isFinite(n) || n < 0) {
          throw new Error("Max per scrip must be a non-negative whole ₹ amount (or blank for no cap)")
        }
        maxInr = n
      }
      const res = await fetch("/admin/fees", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          enabled: pfEnabled,
          percent: pct,
          max_inr: maxInr,
        }),
      })
      const body = await res.json()
      if (!res.ok) throw new Error(body.message || "save_failed")
      setPfView(body.processing_fee)
      setPfFlash("Saved")
      setTimeout(() => setPfFlash(null), 2500)
    } catch (e) {
      setError(e instanceof Error ? e.message : "failed")
    } finally {
      setPfSaving(false)
    }
  }

  const saveRewards = async () => {
    setRwSaving(true)
    setError(null)
    setRwFlash(null)
    try {
      const promoPct = Number(rwPromoPctPercent)
      const promoFlat = Math.trunc(Number(rwPromoFlat))
      const ppi = Math.trunc(Number(rwPointsPerInr))
      const pMin = Math.trunc(Number(rwPointsMin))
      const pMax = Math.trunc(Number(rwPointsMax))
      if (!Number.isFinite(promoPct) || promoPct < 0 || promoPct > 100) {
        throw new Error("Promo cap percent must be between 0 and 100")
      }
      if (!Number.isFinite(promoFlat) || promoFlat < 0) {
        throw new Error("Promo cap flat ₹ must be a non-negative integer")
      }
      if (!Number.isFinite(ppi) || ppi < 1) {
        throw new Error("Points per ₹ must be ≥ 1")
      }
      if (!Number.isFinite(pMin) || pMin < 1) {
        throw new Error("Points min must be ≥ 1")
      }
      if (!Number.isFinite(pMax) || pMax < pMin) {
        throw new Error("Points max must be ≥ Points min")
      }
      // Note: referrer_credit_bucket / referee_credit_bucket are NOT
      // sent from this page — they're owned by /app/referral now.
      // Including them here would overwrite the operator's choices on
      // every Save Rewards click in this section.
      const res = await fetch("/admin/fees", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          promo_payment_enabled: rwPromoEnabled,
          promo_max_pct_percent: promoPct,
          promo_max_flat_inr: promoFlat,
          points_conversion_enabled: rwPointsEnabled,
          points_per_inr: ppi,
          points_min_convert: pMin,
          points_max_convert: pMax,
        }),
      })
      const body = await res.json()
      if (!res.ok) throw new Error(body.message || "save_failed")
      setRwView(body.rewards)
      setRwFlash("Saved")
      setTimeout(() => setRwFlash(null), 2500)
    } catch (e) {
      setError(e instanceof Error ? e.message : "failed")
    } finally {
      setRwSaving(false)
    }
  }

  const saveLowQtyFee = async () => {
    setLqSaving(true)
    setError(null)
    setLqFlash(null)
    try {
      const threshold = Math.trunc(Number(lqThreshold))
      const amount = Math.trunc(Number(lqAmount))
      if (!Number.isFinite(threshold) || threshold < 0) {
        throw new Error("Threshold must be a non-negative whole ₹ amount")
      }
      if (!Number.isFinite(amount) || amount < 0) {
        throw new Error("Amount must be a non-negative whole ₹ amount")
      }
      const res = await fetch("/admin/fees", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          low_qty_enabled: lqEnabled,
          low_qty_threshold_inr: threshold,
          low_qty_amount_inr: amount,
        }),
      })
      const body = await res.json()
      if (!res.ok) throw new Error(body.message || "save_failed")
      setLqView(body.low_qty_fee)
      setLqFlash("Saved")
      setTimeout(() => setLqFlash(null), 2500)
    } catch (e) {
      setError(e instanceof Error ? e.message : "failed")
    } finally {
      setLqSaving(false)
    }
  }

  return (
    <Container>
      <div className="mb-4 flex items-center gap-2">
        <CurrencyDollar />
        <Heading level="h1">Platform fees</Heading>
      </div>
      <Text size="small" className="text-ui-fg-subtle mb-4">
        Fees applied at checkout. Changes take effect for all future
        carts on the next storefront cache refresh (≤ 5 minutes).
      </Text>

      {error && (
        <div className="mb-4 rounded border border-red-200 bg-red-50 px-3 py-2 text-red-700">
          <Text>{error}</Text>
        </div>
      )}

      {/* ── Processing fee ─────────────────────────────────────── */}
      <div className="bg-ui-bg-base border-ui-border-base mb-6 flex flex-col gap-y-5 rounded-lg border p-6">
        <div>
          <Heading level="h2">Processing fee</Heading>
          <Text size="small" className="text-ui-fg-subtle">
            Shown on the cart summary as &ldquo;Processing fee&rdquo;.
            Applied <strong>per scrip</strong> as
            {" "}<code>min(line subtotal × percent, max ₹)</code>{" "}
            — the cap, if set, is evaluated independently on each cart
            line item.
          </Text>
        </div>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          <div className="flex flex-col gap-y-1">
            <Label size="small" weight="plus">
              Enabled
            </Label>
            <div className="flex items-center gap-2">
              <Switch checked={pfEnabled} onCheckedChange={setPfEnabled} />
              <Text size="small" className="text-ui-fg-subtle">
                Off ⇒ no processing fee added to cart totals.
              </Text>
            </div>
          </div>
          <div className="flex flex-col gap-y-1">
            <div className="flex items-center justify-between gap-2">
              <Label size="small" weight="plus">
                Fee percent
              </Label>
              <Text size="xsmall" className="text-ui-fg-subtle">
                e.g. 2 for 2% — supports decimals (2.5 = 2.5%)
              </Text>
            </div>
            <Input
              type="number"
              inputMode="decimal"
              step="0.01"
              min="0"
              max="100"
              value={pfPercent}
              onChange={(e) => setPfPercent(e.target.value)}
              placeholder="2"
            />
          </div>
          <div className="flex flex-col gap-y-1">
            <div className="flex items-center justify-between gap-2">
              <Label size="small" weight="plus">
                Max per scrip (₹)
              </Label>
              <Text size="xsmall" className="text-ui-fg-subtle">
                Blank ⇒ no cap
              </Text>
            </div>
            <Input
              type="number"
              inputMode="numeric"
              step="1"
              min="0"
              value={pfMax}
              onChange={(e) => setPfMax(e.target.value)}
              placeholder="e.g. 500"
            />
          </div>
        </div>

        <div className="border-ui-border-base flex flex-wrap items-center gap-3 border-t pt-4">
          <Button
            onClick={saveProcessingFee}
            isLoading={pfSaving}
            disabled={pfSaving || loading}
          >
            Save processing fee
          </Button>
          {pfFlash && <StatusBadge color="green">{pfFlash}</StatusBadge>}
          {pfView && (
            <Text size="xsmall" className="text-ui-fg-subtle">
              live: {pfView.enabled ? `${pfView.percent}%` : "disabled"}
              {" · decimal "}
              {pfView.rate.toFixed(4)}
              {" · cap "}
              {pfView.max_inr == null ? "none" : `₹${pfView.max_inr.toLocaleString("en-IN")}`}
            </Text>
          )}
        </div>
      </div>

      {/* ── Low-quantity flat fee ─────────────────────────────── */}
      <div className="bg-ui-bg-base border-ui-border-base flex flex-col gap-y-5 rounded-lg border p-6">
        <div>
          <Heading level="h2">Low-quantity fee</Heading>
          <Text size="small" className="text-ui-fg-subtle">
            Flat ₹ added per order when the investment subtotal is
            below the threshold. Applied per order (not per item).
          </Text>
        </div>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          <div className="flex flex-col gap-y-1">
            <Label size="small" weight="plus">
              Enabled
            </Label>
            <div className="flex items-center gap-2">
              <Switch checked={lqEnabled} onCheckedChange={setLqEnabled} />
              <Text size="small" className="text-ui-fg-subtle">
                Off ⇒ no low-qty fee added.
              </Text>
            </div>
          </div>

          <div className="flex flex-col gap-y-1">
            <div className="flex items-center justify-between gap-2">
              <Label size="small" weight="plus">
                Threshold (₹)
              </Label>
              <Text size="xsmall" className="text-ui-fg-subtle">
                Apply when subtotal &lt; this
              </Text>
            </div>
            <Input
              type="number"
              inputMode="numeric"
              step="1"
              min="0"
              value={lqThreshold}
              onChange={(e) => setLqThreshold(e.target.value)}
              placeholder="10000"
            />
          </div>

          <div className="flex flex-col gap-y-1">
            <div className="flex items-center justify-between gap-2">
              <Label size="small" weight="plus">
                Flat amount (₹)
              </Label>
              <Text size="xsmall" className="text-ui-fg-subtle">
                Per order, not per item
              </Text>
            </div>
            <Input
              type="number"
              inputMode="numeric"
              step="1"
              min="0"
              value={lqAmount}
              onChange={(e) => setLqAmount(e.target.value)}
              placeholder="250"
            />
          </div>
        </div>

        <div className="border-ui-border-base flex flex-wrap items-center gap-3 border-t pt-4">
          <Button
            onClick={saveLowQtyFee}
            isLoading={lqSaving}
            disabled={lqSaving || loading}
          >
            Save low-quantity fee
          </Button>
          {lqFlash && <StatusBadge color="green">{lqFlash}</StatusBadge>}
          {lqView && (
            <Text size="xsmall" className="text-ui-fg-subtle">
              live:{" "}
              {lqView.enabled
                ? `₹${lqView.amount_inr} when subtotal < ₹${lqView.threshold_inr.toLocaleString("en-IN")}`
                : "disabled"}
            </Text>
          )}
        </div>
      </div>

      {/* ── Rewards ─────────────────────────────────────────────── */}
      <div className="bg-ui-bg-base border-ui-border-base mt-6 flex flex-col gap-y-6 rounded-lg border p-6">
        <div>
          <Heading level="h2">Rewards</Heading>
          <Text size="small" className="text-ui-fg-subtle">
            Controls the promo balance — a non-withdrawable wallet sub-balance
            funded by referrals + points conversion. Promo drains first at
            checkout (capped per-tx); refunds go back to source bucket.
          </Text>
          <Text size="xsmall" className="text-ui-fg-muted mt-2">
            Per-side referral controls (amount, min purchase, bucket) live
            on{" "}
            <a className="underline" href="/app/referral">
              /app/referral
            </a>
            .
          </Text>
        </div>

        {/* Promo cap */}
        <div className="border-ui-border-base flex flex-col gap-y-4 border-b pb-6">
          <div>
            <Heading level="h3">Promo utilisation cap</Heading>
            <Text size="small" className="text-ui-fg-subtle">
              Max promo ₹ usable per checkout. Cap is the HIGHER of (% of
              investment subtotal, flat ₹). e.g. 2% × ₹50,000 = ₹1,000 vs flat
              ₹500 → ₹1,000 cap. Customer can spend up to this from promo bucket
              per order.
            </Text>
          </div>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
            <div className="flex flex-col gap-y-1">
              <Label size="small" weight="plus">
                Promo payments enabled
              </Label>
              <div className="flex items-center gap-2">
                <Switch
                  checked={rwPromoEnabled}
                  onCheckedChange={setRwPromoEnabled}
                />
                <Text size="small" className="text-ui-fg-subtle">
                  Off ⇒ promo is never spent at checkout (still creditable).
                </Text>
              </div>
            </div>
            <div className="flex flex-col gap-y-1">
              <div className="flex items-center justify-between gap-2">
                <Label size="small" weight="plus">
                  Cap — % of subtotal
                </Label>
                <Text size="xsmall" className="text-ui-fg-subtle">
                  e.g. 2 = 2%
                </Text>
              </div>
              <Input
                type="number"
                inputMode="decimal"
                step="0.01"
                min="0"
                max="100"
                value={rwPromoPctPercent}
                onChange={(e) => setRwPromoPctPercent(e.target.value)}
                placeholder="2"
              />
            </div>
            <div className="flex flex-col gap-y-1">
              <div className="flex items-center justify-between gap-2">
                <Label size="small" weight="plus">
                  Cap — flat ₹ floor
                </Label>
                <Text size="xsmall" className="text-ui-fg-subtle">
                  e.g. 500 = ₹500
                </Text>
              </div>
              <Input
                type="number"
                inputMode="numeric"
                step="1"
                min="0"
                value={rwPromoFlat}
                onChange={(e) => setRwPromoFlat(e.target.value)}
                placeholder="500"
              />
            </div>
          </div>
        </div>

        {/* Referral routing controls have moved to /app/referral —
          * each side (referrer, referee) gets its own column with
          * amount, min-purchase, and bucket selector. Keeping a single
          * "rewards" surface in this page would have hidden those
          * options; the operator now configures referrals together
          * with their amounts and gating in one place. */}

        {/* Points conversion */}
        <div className="flex flex-col gap-y-4">
          <div>
            <Heading level="h3">Points → promo conversion</Heading>
            <Text size="small" className="text-ui-fg-subtle">
              Self-serve customer flow on the wallet dashboard. Customer spends
              redeemable points; the equivalent ₹ lands in their promo bucket.
              Rate + bounds below — bounds are inclusive.
            </Text>
          </div>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-4">
            <div className="flex flex-col gap-y-1">
              <Label size="small" weight="plus">
                Conversion enabled
              </Label>
              <div className="flex items-center gap-2">
                <Switch
                  checked={rwPointsEnabled}
                  onCheckedChange={setRwPointsEnabled}
                />
                <Text size="small" className="text-ui-fg-subtle">
                  Off ⇒ /store/wallet/convert-points returns 403.
                </Text>
              </div>
            </div>
            <div className="flex flex-col gap-y-1">
              <Label size="small" weight="plus">
                Points per ₹
              </Label>
              <Input
                type="number"
                inputMode="numeric"
                step="1"
                min="1"
                value={rwPointsPerInr}
                onChange={(e) => setRwPointsPerInr(e.target.value)}
                placeholder="100"
              />
              <Text size="xsmall" className="text-ui-fg-subtle">
                100 ⇒ 100 points = ₹1
              </Text>
            </div>
            <div className="flex flex-col gap-y-1">
              <Label size="small" weight="plus">
                Min points / convert
              </Label>
              <Input
                type="number"
                inputMode="numeric"
                step="1"
                min="1"
                value={rwPointsMin}
                onChange={(e) => setRwPointsMin(e.target.value)}
                placeholder="100"
              />
            </div>
            <div className="flex flex-col gap-y-1">
              <Label size="small" weight="plus">
                Max points / convert
              </Label>
              <Input
                type="number"
                inputMode="numeric"
                step="1"
                min="1"
                value={rwPointsMax}
                onChange={(e) => setRwPointsMax(e.target.value)}
                placeholder="100000"
              />
            </div>
          </div>
        </div>

        <div className="border-ui-border-base flex flex-wrap items-center gap-3 border-t pt-4">
          <Button
            onClick={saveRewards}
            isLoading={rwSaving}
            disabled={rwSaving || loading}
          >
            Save rewards
          </Button>
          {rwFlash && <StatusBadge color="green">{rwFlash}</StatusBadge>}
          {rwView && (
            <Text size="xsmall" className="text-ui-fg-subtle">
              live cap:{" "}
              {rwView.promo_payment_enabled
                ? `max(${rwView.promo_max_pct_percent}% of subtotal, ₹${rwView.promo_max_flat_inr.toLocaleString(
                    "en-IN",
                  )})`
                : "promo disabled"}
              {" · "}
              {rwView.points_conversion_enabled
                ? `${rwView.points_per_inr} pts = ₹1, range ${rwView.points_min_convert}–${rwView.points_max_convert}`
                : "conversion disabled"}
            </Text>
          )}
        </div>
      </div>
    </Container>
  )
}

export const config = defineRouteConfig({
  label: "Platform fees",
  icon: CurrencyDollar,
})

export default FeesPage
