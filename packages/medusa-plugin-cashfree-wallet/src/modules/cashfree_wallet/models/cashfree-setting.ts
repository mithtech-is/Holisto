import { model } from "@medusajs/framework/utils"

/**
 * Singleton row holding all Cashfree integration credentials + module-wide
 * config.
 *
 * Cashfree exposes five products we care about, each with its own API key
 * pair and (usually) its own webhook signing secret:
 *
 *   1. Payment Gateway (`pg`)       — checkout + Auto-Collect VBA
 *   2. Payouts (`payouts`)          — outbound disbursements
 *   3. Subscriptions (`subscriptions`)
 *   4. Cross-border (`cross_border`)
 *   5. Verification Suite (`verification`) — Secure ID (KYC)
 *
 * Storage model: each product has its own `<env>_<product>_<field>` triple,
 * plus a `<product>_active_env` pointer and `<product>_enabled` flag. This
 * lets the admin configure sandbox AND production credentials and flip the
 * active env without losing either set.
 *
 * Verification Suite has no sandbox key-issuance in the Cashfree dashboard,
 * so its `active_env` is forced to 'production' at the service layer and
 * the admin UI hides the env picker. The sandbox slot exists for future
 * affordance.
 *
 * `*_encrypted` columns are AES-256-GCM ciphertext (see `cashfree/crypto.ts`).
 * `AT_REST_ENCRYPTION_KEY` env var must be set.
 *
 * Legacy columns (flat `client_*` / `payouts_*` and the first-generation
 * `{sandbox,production}_client_*` / `{sandbox,production}_payouts_*`) are
 * retained as a read-only fallback for the Verification Suite and Payouts
 * products respectively.
 */
export const CashfreeSetting = model.define("cashfree_setting", {
  id: model.id().primaryKey(),
  singleton_key: model.text().default("default"),

  // ── Global module config ───────────────────────────────────────────
  /** Legacy global env pointer. Superseded by per-product `<p>_active_env`
   *  but kept for backwards compatibility with old callers. */
  env: model.enum(["sandbox", "production"]).default("sandbox"),
  /** Default beneficiary name shown to remitters on their bank's
   *  transfer screen when no per-customer override applies (e.g. a
   *  marketing landing-page VBA). Per-customer VBAs created via
   *  `provisionVirtualAccountForCustomer` always override this with
   *  the customer's PAN-verified name. Renamed from `vba_prefix` on
   *  2026-05-04 — the old name implied a string concatenation that
   *  never happened; this is the literal beneficiary name. */
  beneficiary_name: model.text().nullable(),
  /** Name of the Cashfree Auto-Collect notification group to attach to
   *  every VBA we provision via `/pg/vba`. Required by Cashfree's 2024-
   *  07-10 API version; without it VBA creation fails with
   *  `notif_group_not_exists`. The name must match a group the merchant
   *  has pre-created in Cashfree dashboard → Auto-Collect →
   *  Notifications. One name works across sandbox + production as long
   *  as the merchant has created it in both envs. */
  pg_notification_group: model.text().nullable(),
  updated_by_user_id: model.text().nullable(),
  // ── Referral programme ───────────────────────────────────────────
  // Rewards are NOT credited to the wallet. They top up
  // `gamification_customer_profile.referral_credit_inr` (paise) for
  // both parties when the referee's first qualifying purchase clears
  // `referral_min_purchase_inr`.
  referral_enabled: model.boolean().default(true),
  /** Minimum cart item-subtotal (₹) for a referee's qualifying order
   *  to trigger the reward. Single shared threshold — both sides
   *  credit once cleared. */
  referral_min_purchase_inr: model.number().default(1000),
  /** Legacy per-side min-purchase columns. Kept on the table to
   *  avoid a destructive migration on a live DB; no longer read or
   *  written by service code (see `getReferralSettings` /
   *  `creditFirstPurchaseReferral`). The simpler model has one
   *  shared threshold above; only reward amount + bucket vary per
   *  side. Drop in a future cleanup migration. */
  referral_referrer_min_purchase_inr: model.number().nullable(),
  referral_referee_min_purchase_inr: model.number().nullable(),
  /** ₹ awarded to the referrer's referral_credit balance. */
  referral_referrer_reward_inr: model.number().default(250),
  /** ₹ awarded to the referee's referral_credit balance. */
  referral_referee_reward_inr: model.number().default(250),
  /** Legacy: previously the single reward amount applied to both
   *  sides. Retained read-only as a fallback for old rows; new
   *  callers use the per-side fields above. */
  referral_reward_amount_inr: model.number().default(250),

  // ── Platform fee ─────────────────────────────────────────────
  // Storefront reads these via `GET /store/fees`. Decimal form
  // (0.02 = 2%). Admin UI shows/collects as percent — conversion
  // happens at the API layer.
  //
  // `processing_fee_max_inr` is an OPTIONAL per-scrip cap in whole
  // rupees. The fee for each line item is `min(line_subtotal × rate,
  // max_inr)`. NULL = no cap (uncapped %-fee). 0 effectively disables
  // the fee (semantically same as `enabled = false`). The cap is
  // per scrip — i.e. evaluated independently on each cart line item
  // — so a cart with multiple scrips bills `cap × N`, not one cap
  // across the whole cart.
  processing_fee_enabled: model.boolean().default(true),
  processing_fee_rate: model.number().default(0.02),
  processing_fee_max_inr: model.number().nullable(),

  // ── Low-quantity flat fee ────────────────────────────────────
  // A flat ₹X added to small orders to make them economic.
  //   threshold_inr — apply the flat fee whenever investment
  //                   subtotal is BELOW this number (₹).
  //   amount_inr    — flat ₹ to add (per order, not per item).
  // Storefront reads these via `GET /store/fees` alongside the
  // processing fee. Same admin UI at /app/fees.
  low_qty_fee_enabled: model.boolean().default(true),
  low_qty_fee_threshold_inr: model.number().default(10000),
  low_qty_fee_amount_inr: model.number().default(250),

  // ── Promo balance utilisation cap (per-transaction) ────────────
  // Promo balance is funded by referrals + points conversion. At
  // checkout, the wallet provider drains promo first, then main —
  // but capped per transaction at:
  //
  //   max(promo_max_pct_of_subtotal × cart_subtotal, promo_max_flat_inr)
  //
  // where cart_subtotal is the line-item investment value BEFORE
  // processing / low-qty fees. Default cap: 2% of investment OR ₹500,
  // whichever is HIGHER.
  promo_payment_enabled: model.boolean().default(true),
  /** Decimal — 0.02 = 2%. Admin UI shows / collects as percent. */
  promo_max_pct_of_subtotal: model.number().default(0.02),
  /** Whole ₹ floor. Default 500 = ₹500. */
  promo_max_flat_inr: model.number().default(500),

  // ── Referral routing (per-side: main or promo bucket) ──────────
  // Existing referral programme credits a fixed ₹ to both referrer
  // and referee on the referee's first qualifying order. Operator
  // chooses which bucket each side's reward lands in.
  /** "main" or "promo". Defaults to promo (incentive-style). */
  referrer_credit_bucket: model.enum(["main", "promo"]).default("promo"),
  referee_credit_bucket: model.enum(["main", "promo"]).default("promo"),

  // ── Points → Promo balance conversion ──────────────────────────
  // Customer-clicked self-serve conversion. Admin sets the rate +
  // limits; storefront /dashboard/wallet renders the form.
  points_conversion_enabled: model.boolean().default(true),
  /** Points required for ₹1. Default 100 → 100 points = ₹1. */
  points_per_inr: model.number().default(100),
  /** Minimum points per single conversion. Default 100 = ₹1. */
  points_min_convert: model.number().default(100),
  /** Maximum points per single conversion. Default 100_000 = ₹1000. */
  points_max_convert: model.number().default(100000),

  // ── Per-product toggles & active-env pointers ─────────────────────
  pg_enabled: model.boolean().default(false),
  pg_active_env: model.enum(["sandbox", "production"]).default("sandbox"),
  payouts_enabled: model.boolean().default(false),
  payouts_active_env: model.enum(["sandbox", "production"]).default("sandbox"),
  subscriptions_enabled: model.boolean().default(false),
  subscriptions_active_env: model
    .enum(["sandbox", "production"])
    .default("sandbox"),
  cross_border_enabled: model.boolean().default(false),
  cross_border_active_env: model
    .enum(["sandbox", "production"])
    .default("sandbox"),
  /** Verification Suite has no active_env column — always production. */
  verification_enabled: model.boolean().default(false),
  /** Per-kind toggles for Verification Suite. Each kind is independently
   *  togglable within the umbrella `verification_enabled` master switch.
   *  Default TRUE so existing installs that had the master flag on keep
   *  the same behavior. Each per-kind flag gates the corresponding store
   *  route AND is mirrored to the storefront via /store/kyc/status so
   *  the UI can skip/hide the step cleanly.
   *
   *  Semantics: a kind is "live" iff verification_enabled && <kind>_verification_enabled.
   *  - pan_verification_enabled     — /store/kyc/pan/verify
   *  - aadhaar_verification_enabled — /store/kyc/aadhaar/{otp-send,otp-verify}
   *  - bank_verification_enabled    — penny-drop on /store/bank-accounts
   *  - cmr_verification_enabled     — CMR verify on /store/demat-accounts
   */
  pan_verification_enabled: model.boolean().default(true),
  aadhaar_verification_enabled: model.boolean().default(true),
  bank_verification_enabled: model.boolean().default(true),
  cmr_verification_enabled: model.boolean().default(true),

  // ── Legacy flat columns (Verification Suite + Payouts read-fallback) ──
  client_id: model.text().nullable(),
  client_secret_encrypted: model.text().nullable(),
  payouts_client_id: model.text().nullable(),
  payouts_client_secret_encrypted: model.text().nullable(),
  webhook_secret_encrypted: model.text().nullable(),
  verify_webhook_secret_encrypted: model.text().nullable(),

  // ── Per-env columns for Verification Suite (legacy naming, bound to VS) ──
  sandbox_client_id: model.text().nullable(),
  sandbox_client_secret_encrypted: model.text().nullable(),
  production_client_id: model.text().nullable(),
  production_client_secret_encrypted: model.text().nullable(),
  sandbox_verify_webhook_secret_encrypted: model.text().nullable(),
  production_verify_webhook_secret_encrypted: model.text().nullable(),

  // ── Per-env columns for Payouts ───────────────────────────────────
  sandbox_payouts_client_id: model.text().nullable(),
  sandbox_payouts_client_secret_encrypted: model.text().nullable(),
  production_payouts_client_id: model.text().nullable(),
  production_payouts_client_secret_encrypted: model.text().nullable(),
  sandbox_webhook_secret_encrypted: model.text().nullable(),
  production_webhook_secret_encrypted: model.text().nullable(),

  // ── Per-env columns for Payment Gateway (new) ─────────────────────
  sandbox_pg_client_id: model.text().nullable(),
  sandbox_pg_client_secret_encrypted: model.text().nullable(),
  sandbox_pg_webhook_secret_encrypted: model.text().nullable(),
  production_pg_client_id: model.text().nullable(),
  production_pg_client_secret_encrypted: model.text().nullable(),
  production_pg_webhook_secret_encrypted: model.text().nullable(),

  // ── Per-env columns for Subscriptions (new) ───────────────────────
  sandbox_subscriptions_client_id: model.text().nullable(),
  sandbox_subscriptions_client_secret_encrypted: model.text().nullable(),
  sandbox_subscriptions_webhook_secret_encrypted: model.text().nullable(),
  production_subscriptions_client_id: model.text().nullable(),
  production_subscriptions_client_secret_encrypted: model.text().nullable(),
  production_subscriptions_webhook_secret_encrypted: model.text().nullable(),

  // ── Per-env columns for Cross-border (new) ────────────────────────
  sandbox_cross_border_client_id: model.text().nullable(),
  sandbox_cross_border_client_secret_encrypted: model.text().nullable(),
  sandbox_cross_border_webhook_secret_encrypted: model.text().nullable(),
  production_cross_border_client_id: model.text().nullable(),
  production_cross_border_client_secret_encrypted: model.text().nullable(),
  production_cross_border_webhook_secret_encrypted: model.text().nullable(),
})
