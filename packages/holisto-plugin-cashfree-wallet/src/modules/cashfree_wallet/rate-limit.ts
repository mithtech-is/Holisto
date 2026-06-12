/**
 * Per-customer rate limit for expensive Secure ID / penny-drop endpoints.
 *
 * In-memory counter keyed by (customer_id, bucket). One instance per Node
 * process — with a single backend replica this is authoritative. When we
 * horizontally scale Medusa, swap this for a Redis-backed version (module
 * can stay the same shape — only the storage backend changes).
 */

type Counter = { count: number; windowStart: number }

const store = new Map<string, Counter>()

export type RateLimitDecision =
  | { allowed: true; remaining: number; reset_at: number }
  | { allowed: false; remaining: 0; reset_at: number; reason: string }

/**
 * Check + increment the rate counter atomically.
 *
 * @param key     A stable key, e.g. `pan:cus_123` or `aadhaar_otp_send:cus_123`.
 * @param limit   Max hits per window.
 * @param windowMs Rolling window length in milliseconds.
 * @param dryRun  If true, only check; do not increment.
 */
export function hitRateLimit(
  key: string,
  limit: number,
  windowMs: number,
  dryRun = false
): RateLimitDecision {
  const now = Date.now()
  const existing = store.get(key)
  if (!existing || now - existing.windowStart > windowMs) {
    if (dryRun) return { allowed: true, remaining: limit, reset_at: now + windowMs }
    store.set(key, { count: 1, windowStart: now })
    return { allowed: true, remaining: limit - 1, reset_at: now + windowMs }
  }
  if (existing.count >= limit) {
    return {
      allowed: false,
      remaining: 0,
      reset_at: existing.windowStart + windowMs,
      reason: `limit_exceeded ${existing.count}/${limit}`,
    }
  }
  if (!dryRun) existing.count += 1
  return {
    allowed: true,
    remaining: limit - existing.count,
    reset_at: existing.windowStart + windowMs,
  }
}

/** Bucket presets by Secure ID kind. */
export const SECURE_ID_LIMITS = {
  pan: { limit: 5, windowMs: 24 * 60 * 60 * 1000 }, // 5 per day
  aadhaar_otp_send_hour: { limit: 3, windowMs: 60 * 60 * 1000 },
  aadhaar_otp_send_day: { limit: 5, windowMs: 24 * 60 * 60 * 1000 },
  aadhaar_otp_verify_per_ref: { limit: 5, windowMs: 15 * 60 * 1000 },
  bank_penny: { limit: 10, windowMs: 24 * 60 * 60 * 1000 },
  cmr: { limit: 10, windowMs: 24 * 60 * 60 * 1000 },
} as const

/** Wallet-side limits — separate bucket so a customer hammering the
 *  manual "Check for new deposits" button can't exhaust the Secure ID
 *  budget, and ops can tune them independently. */
export const WALLET_LIMITS = {
  /** Customer-driven sync ("Check for new deposits"). 1 hit per 30s
   *  is plenty — Cashfree settlement latency is in seconds, not
   *  milliseconds, so polling tighter than this only burns API
   *  quota. The 20-per-day cap stops a stuck-button retry loop from
   *  silently DoSing Cashfree on a customer's behalf. */
  manual_sync_short: { limit: 1, windowMs: 30 * 1000 },
  manual_sync_daily: { limit: 20, windowMs: 24 * 60 * 60 * 1000 },
} as const

/** Admin-initiated verification has its own, more generous bucket so
 *  ops re-running a verification doesn't eat the customer's storefront
 *  quota — and an admin hammering "Run PAN verify" on a flaky day can't
 *  DoS Cashfree either. Keys are `admin_<kind>:<admin_user_id>` so each
 *  ops user gets their own counter. */
export const ADMIN_SECURE_ID_LIMITS = {
  pan: { limit: 50, windowMs: 24 * 60 * 60 * 1000 },
  aadhaar_otp_send: { limit: 30, windowMs: 60 * 60 * 1000 },
  aadhaar_otp_verify: { limit: 50, windowMs: 60 * 60 * 1000 },
  bank_penny: { limit: 100, windowMs: 24 * 60 * 60 * 1000 },
  cmr: { limit: 100, windowMs: 24 * 60 * 60 * 1000 },
} as const
