/**
 * Shared, client-side metadata for the Audit tab:
 *   - `ISSUE_DOCS` — per-finding-code human explainer + fix recipe.
 *   - `resolveStorefrontSource(url)` — best-effort URL → source-file
 *     path lookup so operators can jump straight to the offending
 *     file in their editor.
 *
 * Kept in a separate module from `AuditTab.tsx` so the dictionary and
 * the resolver can be unit-tested or shared with future tooling (CLI
 * lint, PR-time check) without dragging in React.
 */

export type IssueDoc = {
  /** One-sentence what the finding means. */
  meaning: string
  /** Concrete action the operator should take. */
  fix: string
  /** Why the underlying engine cares about this signal. */
  why: string
  /** External reference URL (Google docs, schema.org, etc.) for the
   *  "Learn more" link. */
  learn?: string
}

export const ISSUE_DOCS: Record<string, IssueDoc> = {
  fetch_failed: {
    meaning: "The auditor couldn't reach the URL at all (DNS, TLS, or socket error).",
    fix: "Check the storefront container is up and serving the URL. Reproduce with `curl -sS <url> -o /dev/null -w '%{http_code}\\n'`.",
    why: "If the auditor can't see the page, Googlebot probably can't either — the URL falls out of the index over time.",
  },
  non_2xx: {
    meaning: "The page responded with a non-2xx HTTP status (404, 500, etc.).",
    fix: "If the URL shouldn't exist, remove it from the sitemap shards. If it should, fix the route handler.",
    why: "Search engines drop URLs that 4xx for more than a few weeks.",
  },
  slow_response: {
    meaning: "Time-to-first-byte exceeded 5 seconds.",
    fix: "Profile the page's data-fetch chain; consider `revalidate` ISR. Check for blocking external API calls.",
    why: "Googlebot's crawl budget shrinks for slow sites — pages get visited less often, indexed later.",
    learn: "https://web.dev/articles/ttfb",
  },
  title_missing: {
    meaning: "No <title> tag emitted by the page.",
    fix: "Add a `metadata.title` export to the route's `page.tsx` or `layout.tsx`, or call `pageMetadata()` from `lib/seo/pageMeta.ts`.",
    why: "Without a title, Google fabricates one from page content — usually a worse CTR.",
  },
  title_short: {
    meaning: "Title is fewer than 30 characters once the template (` | <Brand>`) is applied.",
    fix: "Extend the title with a head-keyword phrase (e.g. add `— <brand> primary keyword`).",
    why: "Short titles convey less context to both users and the ranking heuristic.",
    learn: "https://developers.google.com/search/docs/appearance/title-link",
  },
  title_long: {
    meaning: "Title is 60–90 characters. Google's SERP soft-truncates after ~60.",
    fix: "Trim the title to the most query-relevant phrase. Drop generic boilerplate phrasing.",
    why: "Truncated titles look unprofessional and lose CTR.",
    learn: "https://developers.google.com/search/docs/appearance/title-link",
  },
  title_too_long: {
    meaning: "Title is over 90 characters. Google hard-truncates with an ellipsis.",
    fix: "Same as title_long — but urgent. Drop redundant parenthetical aliases and suffixes.",
    why: "Past 90 chars Google replaces your title with a fabricated one based on H1 + body text.",
  },
  meta_description_missing: {
    meaning: "No <meta name=\"description\"> on the page.",
    fix: "Set `metadata.description` on the page. For pages using `pageMetadata()`, edit `lib/seo/pageMeta.ts`.",
    why: "Without a description Google synthesizes one from the body — usually less compelling than a written one.",
  },
  meta_description_short: {
    meaning: "Meta description shorter than 50 characters.",
    fix: "Expand to a 1-2 sentence summary including head terms.",
    why: "Short descriptions waste the SERP snippet real estate.",
  },
  meta_description_long: {
    meaning: "Meta description over 160 characters. Google truncates with an ellipsis.",
    fix: "Trim to 140-155 characters. Lead with the head keyword, then add a differentiator.",
    why: "Truncated descriptions look messy and reduce CTR.",
    learn: "https://developers.google.com/search/docs/appearance/snippet",
  },
  canonical_missing: {
    meaning: "No <link rel=\"canonical\"> on the page.",
    fix: "Add `alternates: { canonical: \"/path\" }` to the page's metadata.",
    why: "Without a canonical, Google guesses which variant to index. With query-strings and trailing-slash variants this often splits ranking signal.",
    learn: "https://developers.google.com/search/docs/crawling-indexing/consolidate-duplicate-urls",
  },
  canonical_mismatch: {
    meaning: "Canonical URL doesn't point at this page.",
    fix: "If the canonical is correct (this URL is a duplicate), expected. If not, fix the `alternates.canonical` value.",
    why: "Tells Google to consolidate ranking signal to the canonical, away from this URL.",
  },
  h1_missing: {
    meaning: "No <h1> tag found in the rendered HTML.",
    fix: "Add a server-rendered <h1> to the route. Avoid putting it in a client-only component unless the SSR pass emits it.",
    why: "Google uses H1 + title together to understand page intent. Missing H1 = weaker semantic signal.",
  },
  h1_multiple: {
    meaning: "More than one <h1> tag found.",
    fix: "Demote redundant <h1>s to <h2>/<h3>. Or remove duplicates emitted from layout + page.",
    why: "Multiple H1s dilute the semantic signal of the page's main topic.",
  },
  img_missing_alt: {
    meaning: "At least one <img> tag lacks an `alt` attribute.",
    fix: "Add `alt=\"…\"` to every <img>. Decorative-only images get `alt=\"\"` (explicit empty).",
    why: "Image alt text feeds Image Search ranking and is an accessibility requirement.",
    learn: "https://developers.google.com/search/docs/appearance/google-images",
  },
  jsonld_invalid: {
    meaning: "A <script type=\"application/ld+json\"> block failed JSON.parse.",
    fix: "Open the offending route, inspect the JSON-LD output. Often a stray newline or unescaped quote in interpolated data.",
    why: "Invalid JSON-LD blocks are silently dropped by Google's Rich Results validator — you get zero schema benefit.",
    learn: "https://search.google.com/test/rich-results",
  },
  schema_missing_required: {
    meaning: "A JSON-LD block parses but is missing one of Google's required fields for its rich-result type (e.g. Product without an image, Article without an author).",
    fix: "Open the resolved source file (link above), find the JSON-LD emitter, and add the missing field. The audit message names the exact field(s). For Product, the OR-group means you need at least ONE of offers/review/aggregateRating.",
    why: "Google silently disqualifies the block from rich results when a required field is absent — the page renders but loses the visual SERP enhancement. Doesn't affect ranking, but tanks CTR.",
    learn: "https://developers.google.com/search/docs/appearance/structured-data",
  },
  broken_internal_link: {
    meaning: "An outbound internal `<a href>` on this page returns a 4xx/network error when probed via HEAD.",
    fix: "Search the source file for the href shown in the message. Either update it to the new path, remove the link, or fix the destination page. Repeats across the site usually point to a renamed route the navbar/footer wasn't updated for.",
    why: "404 dead-ends waste Googlebot's crawl budget, dilute internal PageRank, and frustrate users. Search engines downrank sites with high broken-link density.",
    learn: "https://developers.google.com/search/docs/crawling-indexing/sitemaps/build-sitemap",
  },
  og_title_missing: {
    meaning: "No `og:title` meta tag.",
    fix: "Set `metadata.openGraph.title` on the page (or rely on the root layout's cascade by not overriding `openGraph`).",
    why: "Social shares fall back to the <title>, which often isn't optimal for previews.",
  },
  og_image_missing: {
    meaning: "No `og:image` meta tag.",
    fix: "Either drop the page-level `openGraph` override (lets root layout cascade) or add `images: [{ url: \"/opengraph-image\" }]` explicitly.",
    why: "Social previews render without a card image — way lower CTR on LinkedIn, Twitter, WhatsApp.",
    learn: "https://ogp.me/",
  },
  thin_content: {
    meaning: "Body has fewer than 100 visible words.",
    fix: "Expand the page's body copy. If this is a hub/listing page, that's fine — but make sure it's not a stub.",
    why: "Sub-100-word pages get classified as 'thin content' and deprioritised.",
    learn: "https://developers.google.com/search/docs/essentials",
  },
  not_https: {
    meaning: "Page is served over HTTP, not HTTPS.",
    fix: "Migrate the route to HTTPS. Your reverse proxy should terminate TLS — check for a stray http:// redirect or an HSTS misconfig.",
    why: "Google uses HTTPS as a ranking signal and Chrome marks HTTP pages as 'Not secure'. CTR craters.",
  },
  robots_noindex: {
    meaning: "Page emits <meta name=\"robots\" content=\"noindex\">.",
    fix: "If intentional (auth pages, internal dashboards), ignore. If not, remove the directive.",
    why: "Pages with noindex are excluded from Google's index. Unintentional noindex is a self-inflicted ranking wound.",
    learn: "https://developers.google.com/search/docs/crawling-indexing/block-indexing",
  },
  viewport_missing: {
    meaning: "No <meta name=\"viewport\"> tag.",
    fix: "Add `<meta name=\"viewport\" content=\"width=device-width, initial-scale=1\">` to the page's <head>. Next.js's default app router includes this — missing means a route override.",
    why: "Google flags pages without a viewport as not mobile-friendly. Direct ranking impact on mobile SERPs.",
    learn: "https://developers.google.com/search/docs/crawling-indexing/mobile/mobile-sites-mobile-first-indexing",
  },
  lang_missing: {
    meaning: "<html> tag lacks a `lang` attribute.",
    fix: "Set `<html lang=\"en-IN\">` (or appropriate). Root layout already does this for most routes.",
    why: "Required for hreflang signals + screen-reader pronunciation. Cheap to add.",
  },
  h2_missing: {
    meaning: "Page has body content but no <h2> subheadings.",
    fix: "Break long-form pages into sections with semantic <h2>. Improves scannability + ranking heuristics.",
    why: "Long pages without H2s look like wall-of-text to ranking heuristics + are unreadable for users.",
  },
  img_dim_missing: {
    meaning: "Some <img> tags don't have explicit width + height attributes.",
    fix: "Add `width=\"…\" height=\"…\"` to every <img>. Next.js's <Image> component handles this automatically; raw <img> tags need it manually.",
    why: "Missing dimensions trigger Cumulative Layout Shift (CLS) — a Core Web Vital + ranking signal.",
    learn: "https://web.dev/articles/cls",
  },
  page_too_heavy: {
    meaning: "HTML response is over 1500 KB.",
    fix: "Likely an inlined data blob (long product list, large JSON-LD, base-64 image). Move to a separate request or hide behind interaction.",
    why: "Page weight directly impacts LCP on mobile networks. Mobile Lighthouse score plummets past 1 MB.",
  },
  too_many_external_scripts: {
    meaning: "More than 30 <script src=…> tags on the page.",
    fix: "Audit third-party tags. Lazy-load via `next/script` strategy=\"lazyOnload\" or remove unused analytics.",
    why: "Each external script blocks main-thread on parse + can fetch its own dependencies. Big LCP/INP regression source.",
  },
  low_internal_links: {
    meaning: "Body has fewer than 3 internal links.",
    fix: "Add 3+ contextual internal links per page (e.g. to related articles, parent category, or hub).",
    why: "Pages without internal links are dead ends for crawlers + drag down site-wide ranking.",
  },
  schema_missing: {
    meaning: "Route should ship a specific JSON-LD @type but doesn't.",
    fix: "Add the missing JSON-LD block to the route's `layout.tsx` or `page.tsx`. For /products/[id] = Product; for /knowledge/articles/[slug] = Article.",
    why: "Rich Results in SERP + AI answer engines depend on the right schema. Wrong/absent schema = invisible rich snippets.",
    learn: "https://developers.google.com/search/docs/appearance/structured-data",
  },
  keyword_missing_in_title: {
    meaning: "Operator-declared target keyword does not appear in the page <title>.",
    fix: "Edit the page's `metadata.title` to include the target keyword. Use the Keywords tab to see what's targeted.",
    why: "Title is the strongest ranking signal for the exact-phrase match. Keyword missing = page won't rank for it.",
  },
  keyword_missing_in_h1: {
    meaning: "Operator-declared target keyword does not appear in the page <h1>.",
    fix: "Rewrite the H1 to include the target keyword (or a close variation).",
    why: "H1 is the second-strongest on-page signal after the title. Missing keyword in H1 = weaker topical relevance.",
  },
  keyword_missing_in_body: {
    meaning: "Operator-declared target keyword does not appear anywhere on the page body.",
    fix: "Add a paragraph that uses the keyword naturally. Body copy is what ranking models embed and compare against the query.",
    why: "If the keyword isn't on the page at all, no amount of metadata will rank it. This is the deepest content miss.",
  },
}

/**
 * Best-effort URL → path hint.
 *
 * The plugin is storefront-agnostic — it can't know the operator's
 * framework or directory layout — so this simply returns the URL's path
 * (e.g. `/products/abc`). The UI renders it as a "path" hint the
 * operator can map to their own source file. Kept as a function (rather
 * than inlining) so a future host integration can override the mapping.
 */
export function resolveStorefrontSource(url: string): {
  path: string
  isDynamic: boolean
} {
  try {
    const pathname = new URL(url).pathname.replace(/\/$/, "")
    return { path: pathname === "" ? "/" : pathname, isDynamic: false }
  } catch {
    return { path: "/", isDynamic: false }
  }
}

/**
 * Build deep-links to common external SEO validators for a URL. Each
 * link opens in a new tab and pre-fills the URL — operators don't
 * have to copy-paste.
 */
export function externalValidatorLinks(url: string): Array<{
  label: string
  href: string
  hint: string
}> {
  const enc = encodeURIComponent(url)
  return [
    {
      label: "Google Rich Results",
      href: `https://search.google.com/test/rich-results?url=${enc}`,
      hint: "Validates structured data + previews the rich snippet Google would render.",
    },
    {
      label: "PageSpeed Insights",
      href: `https://pagespeed.web.dev/analysis?url=${enc}`,
      hint: "Real-user (CrUX) + Lighthouse score for LCP, INP, CLS.",
    },
    {
      label: "schema.org validator",
      href: `https://validator.schema.org/#url=${enc}`,
      hint: "Independent schema.org JSON-LD validator (catches things Google's tool overlooks).",
    },
    {
      label: "Mobile-Friendly Test",
      href: `https://search.google.com/test/mobile-friendly?url=${enc}`,
      hint: "Does the page render correctly on a phone?",
    },
    {
      label: "URL Inspection (GSC)",
      href: `https://search.google.com/search-console/inspect?id=${enc}`,
      hint: "Live Google index status for this URL.",
    },
  ]
}

/** Tone (Medusa Badge `color`) for a given severity. */
export function severityTone(
  severity: "error" | "warn" | undefined,
): "red" | "orange" | "green" | "grey" {
  if (severity === "error") return "red"
  if (severity === "warn") return "orange"
  return "grey"
}
