/**
 * Fetch every URL listed across all storefront sitemap shards.
 *
 * Used by the "push everything to IndexNow now" admin action. We
 * deliberately HIT THE LIVE SITEMAP rather than enumerate Medusa
 * products directly — that way the URL list IS the public sitemap
 * (single source of truth, no drift) and we automatically pick up
 * static + taxonomy + knowledge entries the admin button is about.
 *
 * Tolerates failures: returns whatever it could parse + an error
 * count. A single bad shard never blocks the rest.
 */

const TIMEOUT_MS = 8_000

export type SitemapFetchResult = {
  urls: string[]
  shards_attempted: number
  shards_ok: number
  shards_failed: number
  errors: string[]
}

export async function fetchAllSitemapUrls(
  sitemapIndexUrl: string,
): Promise<SitemapFetchResult> {
  const out: SitemapFetchResult = {
    urls: [],
    shards_attempted: 0,
    shards_ok: 0,
    shards_failed: 0,
    errors: [],
  }

  // 1. Pull the sitemap-index. Extract <sitemap><loc>...</loc> entries.
  const indexXml = await fetchText(sitemapIndexUrl)
  if (!indexXml) {
    out.errors.push(`index_unreachable: ${sitemapIndexUrl}`)
    return out
  }

  const shardLocs = matchAll(indexXml, /<sitemap>\s*<loc>([^<]+)<\/loc>/gi)

  // Some sitemaps are flat <urlset>s, not <sitemapindex>s. If the index
  // fetch returned URL entries directly, treat it as a single shard.
  if (shardLocs.length === 0 && /<url>/i.test(indexXml)) {
    shardLocs.push(sitemapIndexUrl)
  }

  out.shards_attempted = shardLocs.length

  // 2. Pull each shard, extract <url><loc>.
  for (const shardUrl of shardLocs) {
    const xml = await fetchText(shardUrl)
    if (!xml) {
      out.shards_failed += 1
      out.errors.push(`shard_unreachable: ${shardUrl}`)
      continue
    }
    const urls = matchAll(xml, /<url>\s*<loc>([^<]+)<\/loc>/gi)
    out.urls.push(...urls)
    out.shards_ok += 1
  }

  // Dedupe + decode XML-escapes for safety.
  out.urls = Array.from(new Set(out.urls.map(unescapeXml)))
  return out
}

/**
 * Like `fetchAllSitemapUrls` but also extracts `<lastmod>` per entry.
 * Used by the crawl-freshness check that compares sitemap-claimed
 * update times against Google's last-crawl timestamp from URL
 * Inspection — surfacing "we updated this but Googlebot doesn't know
 * yet" cases.
 *
 * Entries without a `<lastmod>` come back with `lastmod: null`. We
 * deliberately keep them — many of our routes (like product pages)
 * don't emit lastmod and that's not a freshness problem in itself.
 */
export type SitemapEntry = {
  url: string
  lastmod: string | null
}

export type SitemapEntriesResult = {
  entries: SitemapEntry[]
  shards_attempted: number
  shards_ok: number
  shards_failed: number
  errors: string[]
}

export async function fetchAllSitemapEntries(
  sitemapIndexUrl: string,
): Promise<SitemapEntriesResult> {
  const out: SitemapEntriesResult = {
    entries: [],
    shards_attempted: 0,
    shards_ok: 0,
    shards_failed: 0,
    errors: [],
  }

  const indexXml = await fetchText(sitemapIndexUrl)
  if (!indexXml) {
    out.errors.push(`index_unreachable: ${sitemapIndexUrl}`)
    return out
  }

  const shardLocs = matchAll(indexXml, /<sitemap>\s*<loc>([^<]+)<\/loc>/gi)
  if (shardLocs.length === 0 && /<url>/i.test(indexXml)) {
    shardLocs.push(sitemapIndexUrl)
  }
  out.shards_attempted = shardLocs.length

  // Each shard is a <urlset> of <url> entries; match each <url>…</url>
  // block, then pull loc + optional lastmod from inside.
  const URL_BLOCK = /<url>\s*([\s\S]*?)\s*<\/url>/gi
  const LOC = /<loc>\s*([^<]+)\s*<\/loc>/i
  const LASTMOD = /<lastmod>\s*([^<]+)\s*<\/lastmod>/i

  const dedupe = new Map<string, SitemapEntry>()
  for (const shardUrl of shardLocs) {
    const xml = await fetchText(shardUrl)
    if (!xml) {
      out.shards_failed += 1
      out.errors.push(`shard_unreachable: ${shardUrl}`)
      continue
    }
    URL_BLOCK.lastIndex = 0
    let block: RegExpExecArray | null
    while ((block = URL_BLOCK.exec(xml)) !== null) {
      const body = block[1]
      const locM = LOC.exec(body)
      if (!locM || !locM[1]) continue
      const url = unescapeXml(locM[1].trim())
      const lastmodM = LASTMOD.exec(body)
      const lastmod = lastmodM ? lastmodM[1].trim() : null
      // First occurrence wins on dedupe; if a later shard repeats the
      // URL with a more-recent lastmod, prefer the newer one.
      const existing = dedupe.get(url)
      if (!existing) {
        dedupe.set(url, { url, lastmod })
      } else if (lastmod && (!existing.lastmod || lastmod > existing.lastmod)) {
        dedupe.set(url, { url, lastmod })
      }
    }
    out.shards_ok += 1
  }

  out.entries = Array.from(dedupe.values())
  return out
}

/**
 * Per-shard URL counts. Powers the SEO admin tab's "this shard has N
 * URLs" badge so operators can see at a glance whether a shard is
 * empty (off / misconfigured / nothing to publish yet) without
 * eyeballing the raw XML.
 *
 * We keep this separate from `fetchAllSitemapUrls` because that
 * function flattens shards into a single deduplicated URL list — fine
 * for IndexNow pushes, useless for "show me per-shard counts."
 */
export type SitemapShardCount = {
  shard: string
  url: string
  count: number
  ok: boolean
  error?: string
}

export type SitemapShardCountsResult = {
  index_url: string
  shards: SitemapShardCount[]
  total: number
  duration_ms: number
  errors: string[]
}

export async function fetchSitemapShardCounts(
  sitemapIndexUrl: string,
): Promise<SitemapShardCountsResult> {
  const started = Date.now()
  const out: SitemapShardCountsResult = {
    index_url: sitemapIndexUrl,
    shards: [],
    total: 0,
    duration_ms: 0,
    errors: [],
  }

  const indexXml = await fetchText(sitemapIndexUrl)
  if (!indexXml) {
    out.errors.push(`index_unreachable: ${sitemapIndexUrl}`)
    out.duration_ms = Date.now() - started
    return out
  }

  let shardLocs = matchAll(indexXml, /<sitemap>\s*<loc>([^<]+)<\/loc>/gi)
  if (shardLocs.length === 0 && /<url>/i.test(indexXml)) {
    // Single flat <urlset> — the index URL itself is the shard.
    shardLocs = [sitemapIndexUrl]
  }

  for (const shardUrl of shardLocs) {
    const xml = await fetchText(shardUrl)
    const shardName = deriveShardName(shardUrl)
    if (!xml) {
      out.shards.push({
        shard: shardName,
        url: shardUrl,
        count: 0,
        ok: false,
        error: "shard_unreachable",
      })
      out.errors.push(`shard_unreachable: ${shardUrl}`)
      continue
    }
    const urls = matchAll(xml, /<url>\s*<loc>([^<]+)<\/loc>/gi)
    out.shards.push({
      shard: shardName,
      url: shardUrl,
      count: urls.length,
      ok: true,
    })
    out.total += urls.length
  }
  out.duration_ms = Date.now() - started
  return out
}

/**
 * Extract a human-readable shard name from a shard URL. We expect
 * routes like `/sitemap/products.xml` — strip dir + ".xml" to get
 * "products". Falls back to the raw pathname for unfamiliar shapes.
 */
function deriveShardName(url: string): string {
  try {
    const u = new URL(url)
    const base = u.pathname.split("/").pop() ?? u.pathname
    return base.replace(/\.xml$/i, "") || u.pathname
  } catch {
    return url
  }
}

async function fetchText(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, {
      headers: { Accept: "application/xml" },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
    if (!res.ok) return null
    return await res.text()
  } catch {
    return null
  }
}

function matchAll(input: string, pattern: RegExp): string[] {
  const out: string[] = []
  let match: RegExpExecArray | null
  // Reset lastIndex defensively (caller might reuse the regex).
  pattern.lastIndex = 0
  while ((match = pattern.exec(input)) !== null) {
    if (match[1]) out.push(match[1].trim())
  }
  return out
}

function unescapeXml(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
}
