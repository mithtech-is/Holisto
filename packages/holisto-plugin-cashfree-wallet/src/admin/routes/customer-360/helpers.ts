/**
 * Shared helpers for Customer 360 admin tabs.
 */

/** Thin wrapper around fetch that handles 401/5xx and JSON parsing. */
export async function adminFetch<T = any>(
  url: string,
  init: RequestInit = {}
): Promise<T> {
  const res = await fetch(url, {
    credentials: "include",
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init.headers || {}),
    },
  })
  const body = await res.json().catch(() => ({}))
  if (!res.ok) {
    throw new Error((body as any)?.message || `${res.status} ${res.statusText}`)
  }
  return body as T
}

/**
 * Format a paise amount as ₹ with en-IN grouping.
 *
 * Most polemarch tables store money in PAISE (`balance_inr`,
 * `amount_inr`, `claimed_amount_inr`, …) — the `_inr` suffix is
 * historical and misleading. This helper divides by 100. The matching
 * `/app/wallets` page has its own correctly-implemented copy of this
 * function (admin/routes/wallets/page.tsx:116) — they're now aligned.
 *
 * Callers that already have a RUPEES value (Medusa's `order.total` is
 * one such — Medusa stores order totals in major units) must scale up
 * by 100 before calling, or use `formatInrFromRupees`.
 *
 * Accepts string inputs as well as numbers — Mikro-ORM serializes
 * `bigint` columns as strings to preserve precision over JSON, and
 * `wallet_transaction.amount_inr` / `balance_after` are bigints, so
 * the admin API returns them as `"60000"` not `60000`.
 */
export function formatInr(paise: number | string | null | undefined): string {
  if (paise === null || paise === undefined) return "—"
  const n = typeof paise === "number" ? paise : Number(paise)
  if (!Number.isFinite(n)) return "—"
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 2,
  }).format(n / 100)
}

/** Convenience for callers that already hold a rupees value (Medusa's
 *  `order.total`, etc.). Avoids the `× 100` dance at the call site. */
export function formatInrFromRupees(
  rupees: number | string | null | undefined,
): string {
  if (rupees === null || rupees === undefined) return "—"
  const n = typeof rupees === "number" ? rupees : Number(rupees)
  if (!Number.isFinite(n)) return "—"
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 2,
  }).format(n)
}

export function formatDate(iso: string | null | undefined): string {
  if (!iso) return "—"
  try {
    return new Date(iso).toLocaleString("en-IN", {
      day: "2-digit",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    })
  } catch {
    return iso
  }
}

export function statusBadgeColor(
  status: string | null | undefined
): "green" | "red" | "orange" | "grey" | "blue" {
  if (!status) return "grey"
  const s = status.toLowerCase()
  if (
    s === "verified" ||
    s === "approved" ||
    s === "active" ||
    s === "credited" ||
    s === "captured"
  )
    return "green"
  if (
    s === "rejected" ||
    s === "failed" ||
    s === "frozen" ||
    s === "cancelled" ||
    s === "reversed"
  )
    return "red"
  if (
    s === "pending" ||
    s === "awaiting_funds" ||
    s === "name_mismatch"
  )
    return "orange"
  return "grey"
}
