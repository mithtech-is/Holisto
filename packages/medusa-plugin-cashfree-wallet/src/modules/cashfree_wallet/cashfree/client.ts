/**
 * Thin HTTP client for the Cashfree REST APIs (Verification a.k.a. Secure ID,
 * and Payouts/Virtual Accounts). One client per "audience" — Verification and
 * Payouts have separate API key pairs.
 *
 * We deliberately avoid pulling in a heavy SDK; the call surface we use is
 * small and the SDKs are mostly Node-12-era callback wrappers.
 */

import { setTimeout as wait } from "node:timers/promises"

export type CashfreeAudience = "verification" | "payouts"

export type CashfreeEnv = "sandbox" | "production"

export type CashfreeRequestOpts = {
  method?: "GET" | "POST" | "PUT" | "DELETE"
  path: string
  query?: Record<string, string | number | boolean | undefined>
  body?: unknown
  /** Override default 15s timeout */
  timeoutMs?: number
  /** Idempotency key for write operations (Cashfree forwards via header). */
  idempotencyKey?: string
  /** Per-request header overrides. Mostly used to set a different
   *  `x-api-version` for endpoints whose version differs from the
   *  client-default (e.g. /pg/vba is on 2024-07-10). */
  headers?: Record<string, string>
}

export type CashfreeResponse<T = unknown> = {
  status: number
  ok: boolean
  data: T
  raw: string
}

export class CashfreeApiError extends Error {
  readonly status: number
  readonly body: unknown
  constructor(status: number, body: unknown, message?: string) {
    super(
      message ??
        `Cashfree API error ${status}: ${
          typeof body === "string" ? body : JSON.stringify(body)
        }`
    )
    this.status = status
    this.body = body
  }
}

export type CashfreeClientConfig = {
  env: CashfreeEnv
  clientId: string
  clientSecret: string
  audience: CashfreeAudience
  /** Override base URL — useful for tests/mocks */
  baseUrl?: string
  apiVersion?: string
}

const DEFAULT_API_VERSION = "2023-08-01"

const BASE_URLS: Record<CashfreeEnv, Record<CashfreeAudience, string>> = {
  sandbox: {
    verification: "https://sandbox.cashfree.com",
    payouts: "https://sandbox.cashfree.com",
  },
  production: {
    verification: "https://api.cashfree.com",
    payouts: "https://api.cashfree.com",
  },
}

export class CashfreeClient {
  private readonly cfg: CashfreeClientConfig
  private readonly baseUrl: string
  private readonly apiVersion: string

  constructor(cfg: CashfreeClientConfig) {
    if (!cfg.clientId || !cfg.clientSecret) {
      throw new Error(
        `CashfreeClient: missing credentials for audience=${cfg.audience}`
      )
    }
    this.cfg = cfg
    this.baseUrl = cfg.baseUrl ?? BASE_URLS[cfg.env][cfg.audience]
    this.apiVersion = cfg.apiVersion ?? DEFAULT_API_VERSION
  }

  /**
   * Single round-trip with one inline retry on 5xx / network failure.
   * 4xx errors throw immediately (no retry — the caller's input is wrong).
   */
  async request<T = unknown>(opts: CashfreeRequestOpts): Promise<CashfreeResponse<T>> {
    const url = this.buildUrl(opts.path, opts.query)
    const method = opts.method ?? (opts.body ? "POST" : "GET")
    const headers: Record<string, string> = {
      "x-client-id": this.cfg.clientId,
      "x-client-secret": this.cfg.clientSecret,
      "x-api-version": this.apiVersion,
      Accept: "application/json",
    }
    if (opts.body !== undefined) headers["Content-Type"] = "application/json"
    if (opts.idempotencyKey) headers["x-idempotency-key"] = opts.idempotencyKey
    if (opts.headers) Object.assign(headers, opts.headers)

    const body = opts.body !== undefined ? JSON.stringify(opts.body) : undefined
    const timeoutMs = opts.timeoutMs ?? 15_000

    let lastErr: unknown
    for (let attempt = 0; attempt < 2; attempt++) {
      const ac = new AbortController()
      const timer = setTimeout(() => ac.abort(), timeoutMs)
      try {
        const res = await fetch(url, {
          method,
          headers,
          body,
          signal: ac.signal,
        })
        clearTimeout(timer)
        const raw = await res.text()
        let parsed: unknown
        try {
          parsed = raw ? JSON.parse(raw) : null
        } catch {
          parsed = raw
        }
        if (res.status >= 500) {
          lastErr = new CashfreeApiError(res.status, parsed)
          if (attempt === 0) {
            await wait(250)
            continue
          }
          throw lastErr
        }
        if (!res.ok) {
          throw new CashfreeApiError(res.status, parsed)
        }
        return { status: res.status, ok: true, data: parsed as T, raw }
      } catch (err) {
        clearTimeout(timer)
        // Re-throw 4xx — only retry network/timeout/5xx
        if (err instanceof CashfreeApiError && err.status < 500) throw err
        lastErr = err
        if (attempt === 0) {
          await wait(250)
          continue
        }
        throw err
      }
    }
    throw lastErr instanceof Error
      ? lastErr
      : new Error("CashfreeClient: unknown error")
  }

  private buildUrl(
    path: string,
    query?: Record<string, string | number | boolean | undefined>
  ): string {
    const u = new URL(path.startsWith("/") ? path : `/${path}`, this.baseUrl)
    if (query) {
      for (const [k, v] of Object.entries(query)) {
        if (v === undefined) continue
        u.searchParams.set(k, String(v))
      }
    }
    return u.toString()
  }
}

/**
 * @deprecated Use `CashfreeWalletService.getCashfreeClient("verification")`
 * instead — that path reads the live DB-backed credentials and falls back
 * to env vars. These standalone factories ignore the DB row entirely.
 *
 * Kept temporarily for one release cycle to avoid breaking any straggling
 * callers; will be deleted in a future cleanup.
 */
export function getVerificationClient(): CashfreeClient {
  return new CashfreeClient({
    env: (process.env.CASHFREE_ENV as CashfreeEnv) || "sandbox",
    clientId: process.env.CASHFREE_CLIENT_ID || "",
    clientSecret: process.env.CASHFREE_CLIENT_SECRET || "",
    audience: "verification",
  })
}

/** @deprecated See `getVerificationClient` above. */
export function getPayoutsClient(): CashfreeClient {
  return new CashfreeClient({
    env: (process.env.CASHFREE_ENV as CashfreeEnv) || "sandbox",
    clientId:
      process.env.CASHFREE_PAYOUTS_CLIENT_ID ||
      process.env.CASHFREE_CLIENT_ID ||
      "",
    clientSecret:
      process.env.CASHFREE_PAYOUTS_CLIENT_SECRET ||
      process.env.CASHFREE_CLIENT_SECRET ||
      "",
    audience: "payouts",
  })
}
