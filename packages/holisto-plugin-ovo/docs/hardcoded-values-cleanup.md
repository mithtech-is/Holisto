# Hardcoded-values Cleanup

Every hardcoded Polemarch / MithTech / internal value found in the source was
removed or made config-driven. On a clean install (`demo_mode=false`) the
plugin contains **no client identity** — brand, domain, prompts, sitemap, and
all content come from the operator's settings / credentials.

## What was searched
`polemarch`, `polemarch.in`, `Mithtech`, `Mithtech Innovative Solutions Pvt Ltd`,
`unlisted shares`, `pre-IPO`, `ESOP`, `CDSL/NSDL/SEBI/demat`, `zepto`,
`/invest`, `CALCULA_WEBHOOK_SECRET`, `example.com`, `mock`, `fake`, `demo`.

## Backend module (`src/modules/online_visibility_optimization`)

| Location | Before | After |
|---|---|---|
| `service.ts` crypto import | `../cashfree_wallet/cashfree/crypto` | self-contained `lib/crypto.ts` (`OVO_ENCRYPTION_KEY`) |
| `service.ts` site URL ×4 | `\|\| "https://polemarch.in"` | `resolveDefaultSiteUrl()` (env-only, `""` when unset) |
| `service.ts` GSC/Bing property | `process.env.GSC_SITE_URL` / `BING_SITE_URL` | prefers `OVO_GSC_PROPERTY` / `OVO_BING_SITE_URL` |
| `service.ts` credential env fallbacks | `OPENAI_API_KEY`, `GOOGLE_GSC_SERVICE_ACCOUNT_JSON`, … | prefer `OVO_*` names, legacy kept as fallback |
| `service.ts` AI signals | `mentions_polemarch` / `links_polemarch` | `mentions_brand` / `links_brand` (brand from settings) |
| `lib/ai-citation/extract.ts` | regex `\bpolemarch\b`, hardcoded `COMPETITORS` | `extractSignals(answer, brand)` — name/domains/competitors from settings |
| `lib/intent-classifier.ts` | navigational marker `\bpolemarch\b`, `contact us\|polemarch` | brand marker removed; `contact us` kept |
| `lib/seo-auditor.ts` / `lib/image-alt-suggester.ts` | User-Agent `Polemarch-OVO-Auditor (+polemarch.in)` | neutral `OVO-SEO-Auditor` / `OvoAltSuggester` |
| `seed/default-ovo.ts` | full Polemarch brand/meta/FAQ/llms.txt | **neutral empty** `DEFAULT_OVO`; generic `DEMO_OVO` ("Acme Store") |
| `seed/default-ai-prompts.ts` | Polemarch/unlisted-shares prompts | **empty** `DEFAULT_AI_PROMPTS`; generic `DEMO_AI_PROMPTS` |
| `models/ovo-ai-citation.ts`, `migrations/Migration20260515300000.ts` | columns `mentions_polemarch`/`links_polemarch` | `mentions_brand`/`links_brand` |
| `migrations/.snapshot-medusa_polemarch.json` | Polemarch-named ORM snapshot | **deleted** |

## API routes (`src/api/admin/ovo`)

| Location | Before | After |
|---|---|---|
| `route.ts`, `overrides/.../route.ts` revalidate | `REVALIDATE_SECRET \|\| CALCULA_WEBHOOK_SECRET`; paths incl. `/invest`, `/methodology`, `/about` | `OVO_REVALIDATE_SECRET \|\| REVALIDATE_SECRET`; universal SEO paths only |
| `seo/audit/url`, `seo/url-index` SSRF guard | host hardcoded `polemarch.in` | host derived from `OVO_SITE_URL`; honest setup-required when unset |
| `seo/image-alt/suggest` allowlist | `["polemarch.in", "www.polemarch.in"]` | derived from `OVO_SITE_URL` (+ `OVO_ALT_SUGGEST_HOSTS`) |

## Admin UI (`src/admin/routes/ovo`)

| Location | Before | After |
|---|---|---|
| `AiCitationsTab.tsx` | `mentions_polemarch`, labels "Mentions Polemarch", "links polemarch.in" | `mentions_brand`, "Mentions brand", "links brand domain" |
| GSC deep-links (`audit-meta.ts`, `IndexabilityTab.tsx`) | `resource_id=sc-domain%3Apolemarch.in` | param dropped (Google prompts for the property) |
| `audit-meta.ts` `resolveStorefrontSource` | Next.js `apps/storefront/...` + `/invest/[id]` map | storefront-agnostic (returns URL path) |
| `AuditTab.tsx` | download `polemarch-seo-audit-…`, `/invest/` product regex | `ovo-seo-audit-…`, `/products/` |
| `MetricsTab.tsx` | "Times polemarch.in appeared…" | "Times your site appeared…" |
| `IntegrationsCard.tsx` | `gsc_site_url \|\| "polemarch.in"` | `\|\| "not configured"` |
| placeholders / CSV examples (Keywords/Submit/Geo) | `polemarch.in/invest/zepto`, "unlisted shares" | `your-domain.example/products/…`, neutral terms |

## Verification
- `grep -rinE "polemarch|mithtech" src/` → **0 matches** (excluding the word in
  this cleanup log).
- Automated test `no seed contains the original Polemarch identity` asserts the
  seeds are clean (`test/ovo.test.ts`).
- `demo_mode` default is **false**; demo data only appears with
  `OVO_DEMO_MODE=true` or the plugin option `demo_mode: true`.
