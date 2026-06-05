import { model } from "@medusajs/framework/utils"

/**
 * Tracks a referral relationship: who referred whom, which code was used,
 * and whether the ₹250 reward has been credited to both wallets.
 *
 * Schema shape — one row per (referrer, referred_customer_id) pairing:
 *   - The "template" row: referrer set, referred_customer_id NULL,
 *     status "pending". Created once per referrer the first time
 *     `ensureReferralCode` runs.
 *   - The "application" rows: referrer + referred_customer_id both
 *     set, status pending → credited (or reversed). Created on every
 *     successful applyReferralCode call.
 *
 * `code` is INTENTIONALLY NOT UNIQUE — one referrer's master code is
 * reused across the template + every application row that consumed it.
 * `referred_customer_id` is unique among non-null values (enforced at
 * the application layer in applyReferralCode for now; see
 * IDX_referral_referred_customer_id_uq for the partial-unique index).
 */
export const Referral = model.define("referral", {
  id: model.id().primaryKey(),
  /** The customer who shared their code. */
  referrer_customer_id: model.text().index(),
  /** The customer who signed up with the code. NULL on the template
   *  row; populated on every application row. Application-layer
   *  uniqueness check in applyReferralCode prevents double-dipping. */
  referred_customer_id: model.text().nullable(),
  /** 8-char uppercase alphanumeric code, e.g. "PMR4K7XB". Generated
   *  once per referrer and reused across the template + every
   *  application row keyed off this code. NOT unique by design. */
  code: model.text().index(),
  status: model
    .enum(["pending", "credited", "expired", "reversed"])
    .default("pending"),
  /** Legacy single-amount column. Retained for read-back on rows
   *  created before the per-side split landed. */
  reward_amount_inr: model.number().default(250),
  /** ₹ credited to the referrer's referral_credit balance at the
   *  moment the reward was granted. Snapshot, not a reference. */
  referrer_reward_inr: model.number().default(0),
  /** ₹ credited to the referee's referral_credit balance at the
   *  moment the reward was granted. Snapshot, not a reference. */
  referee_reward_inr: model.number().default(0),
  /** First-order item-subtotal (₹) at the moment the gate passed,
   *  recorded for audit. Null until credited. */
  first_order_subtotal_inr: model.number().nullable(),

  // ── Lifecycle timestamps (nullable — set as each stage is reached) ──
  /** When the referred friend placed their first order. */
  first_trade_at: model.text().nullable(),
  /**
   * When the REFEREE bonus was credited. Fires the moment the referee's
   * KYC completes (kyc.overall='approved' — PAN + Aadhaar + Bank + Demat).
   * Decoupled from `credited_at` (which now means the REFERRER side
   * was credited, i.e. the cumulative-buy threshold was met). The two
   * fire at different times: referee credit at KYC done, referrer
   * credit when lifetime buy ≥ `referral_min_purchase_inr` (whose
   * semantic shifted from "first-order minimum" to "cumulative-
   * lifetime threshold" on the same date — default ₹10 000).
   *
   * `status='credited'` = BOTH sides credited (both timestamps set).
   * `status='pending'` + `referee_credited_at` set = partial state
   * (referee paid, waiting on referrer's threshold).
   */
  referee_credited_at: model.text().nullable(),
  /**
   * When the REFERRER bonus was credited. Historically (pre-2026-05-15)
   * this also implied the referee credit fired in the same atomic
   * transaction. Now it strictly means the referrer side cleared the
   * cumulative-buy threshold; the referee side is tracked separately
   * by `referee_credited_at`.
   */
  credited_at: model.text().nullable(),
  /** When an admin reversed the credited reward. */
  reversed_at: model.text().nullable(),
})
