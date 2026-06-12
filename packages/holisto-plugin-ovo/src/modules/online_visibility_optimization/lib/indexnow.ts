/**
 * IndexNow push — Bing + Yandex pick up URL changes within ~10 minutes.
 *
 * Storefront has its own `submitToIndexNow()` fired on every revalidate
 * webhook. This server-side mirror lets the OVO admin trigger a manual
 * "push everything" sweep across an arbitrary URL list, with structured
 * results that feed the SubmissionLog.
 *
 * Google does NOT participate in IndexNow. Use the GSC API for Google
 * — see `./gsc.ts`.
 *
 * Spec: https://www.indexnow.org/documentation
 */

import type { IndexNowConfig, SubmissionResult } from "./types"

const ENDPOINT = "https://api.indexnow.org/indexnow"
const MAX_URLS_PER_REQUEST = 10_000
const TIMEOUT_MS = 8_000

export async function pushUrlsToIndexNow(
  cfg: IndexNowConfig,
  urls: string[],
): Promise<SubmissionResult> {
  const startedAt = Date.now()

  // Filter to absolute http(s) URLs only — IndexNow rejects relative
  // paths with a 422.
  const cleaned = Array.from(
    new Set(urls.filter((u) => /^https?:\/\//.test(u))),
  ).slice(0, MAX_URLS_PER_REQUEST)

  if (cleaned.length === 0) {
    return {
      destination: "indexnow",
      action: "submit-urls",
      target: cfg.host,
      url_count: 0,
      status: "skipped",
      http_status: null,
      error_message: "no_urls",
      duration_ms: Date.now() - startedAt,
    }
  }

  const body = {
    host: cfg.host,
    key: cfg.key,
    keyLocation: cfg.keyLocation,
    urlList: cleaned,
  }

  try {
    const res = await fetch(ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        Accept: "application/json",
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
    return {
      destination: "indexnow",
      action: "submit-urls",
      target: cfg.host,
      url_count: cleaned.length,
      status: res.ok ? "success" : "error",
      http_status: res.status,
      error_message: res.ok ? null : await safeReadText(res),
      duration_ms: Date.now() - startedAt,
    }
  } catch (err) {
    return {
      destination: "indexnow",
      action: "submit-urls",
      target: cfg.host,
      url_count: cleaned.length,
      status: "error",
      http_status: null,
      error_message: (err as Error).message,
      duration_ms: Date.now() - startedAt,
    }
  }
}

async function safeReadText(res: Response): Promise<string> {
  try {
    const text = (await res.text()).slice(0, 500)
    return text || `http_${res.status}`
  } catch {
    return `http_${res.status}`
  }
}
