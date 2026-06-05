# OVO Plugin — Source Audit

Audit performed before copying any source into the plugin, to confirm the
real mapping of the three OVO source folders and record what existed,
what was broken, and what had to be created.

## Confirmed folder mapping

| Source folder | Role | Evidence |
|---|---|---|
| `online_visibility_optimization/` | **Backend module** | `index.ts` (`Module(...)`), 127 KB `service.ts` (`extends MedusaService`), `lib/`, `models/` (18), `migrations/` (18 + snapshot), `seed/` (2) |
| `OVO2/` | **Admin API routes** | `route.ts` files under `seo/`, `ai/`, `submissions/`, `credentials/`, `overrides/`, `keyword-*/` resolving to `/admin/ovo/*` (matches the required endpoint list) |
| `ovo1/` | **Admin UI** | `page.tsx` with `defineRouteConfig({ label: "OVO" })` + `_components/` containing all 16 tab components |

The expected mapping in the brief was **correct**.

### Note on OVO2
`OVO2/` contained **two** route generations:
- The **flat routes** at the repo root (`OVO2/seo/...`, `OVO2/ai/...`) →
  these match the required `/admin/ovo/*` endpoint list and were copied.
- A newer **multi-tenant** generation under
  `OVO2/apps/ovo-backend/.../sites/[site_id]/...` that depends on a separate
  `site` module (`SITE_MODULE`). This is **out of scope** (no `site` module is
  shipped) and was **not** copied.

## Module inventory (`online_visibility_optimization/`)

| Item | Present? | Notes |
|---|---|---|
| `index.ts` | ✅ | `Module(ONLINE_VISIBILITY_OPTIMIZATION_MODULE, { service })` |
| `service.ts` | ✅ | ~3,800 lines; `OvoService extends MedusaService({...15 models})` |
| `lib/` | ✅ | gsc, bing, indexnow, seo-auditor, sitemap-fetcher, image-alt-suggester, keyword-normalizer, intent-classifier, ai-citation/* |
| `models/` | ✅ | 18 `model.define(...)` files |
| `migrations/` | ✅ | 18 migration files (+ a MikroORM snapshot, removed) |
| `seed/` | ✅ | `default-ovo.ts`, `default-ai-prompts.ts` |

## API routes inventory (`OVO2/` flat routes)
47 `route.ts` files copied to `src/api/admin/ovo/**`, covering all required
endpoints (`/admin/ovo`, `/credentials`, `/seo/*`, `/ai/*`, `/submissions/*`,
`/overrides/*`, `/keyword-*`). `page.tsx` present in `ovo1/`.

## Findings that required fixes

### Broken / cross-module imports
- `service.ts` imported crypto from **`../cashfree_wallet/cashfree/crypto`**
  (a Polemarch wallet module) — **broken in a standalone plugin**.
  → Replaced with a self-contained `lib/crypto.ts` (AES-256-GCM, keyed by
  `OVO_ENCRYPTION_KEY`).
- Every API route imported **`../../../utils/logger`** (host-app util).
  → Provided as `src/utils/logger.ts`.
- API routes imported **`INTENT_VALUES` from `lib/intent`** — **the file did
  not exist** in the module. → Created `lib/intent.ts`.
- The admin `PagesTab` imported **`../../../components/OvoOverrideForm`** —
  **the source did not exist** in `ovo1/` (only a stale compiled `.js` from a
  prior build). → Re-implemented as `src/admin/components/OvoOverrideForm.tsx`.

### Newer-generation routes calling missing service methods
The flat routes referenced methods absent from this (older) service:
- `detectCannibalization`, `detectKeywordOpportunities` (required tabs) →
  **implemented for real** from stored snapshot / dimension data.
- `getSitemapShardCounts` → implemented (live sitemap fetch, storefront-agnostic).
- `ingestCwvMetrics`, `ingestYandexMetrics`, `ingestYandexQueryRollup`,
  `discoverAndCacheYandexIds`, `pushSitemapToYandex` → **honest no-ops**
  (CrUX / Yandex are not bundled in this version; see README limitations).

### Hardcoded Polemarch / MithTech / internal values
Found extensively across `service.ts`, `seed/*`, `lib/*`, all route revalidate
helpers, and most UI tabs. Full inventory + remediation in
[`hardcoded-values-cleanup.md`](./hardcoded-values-cleanup.md).

### Mock / demo / fake data
- `seed/default-ovo.ts` and `seed/default-ai-prompts.ts` were **entirely
  Polemarch data** seeded on first run. → Replaced with **neutral** defaults;
  generic "Acme" demo data is now gated behind `demo_mode` / `OVO_DEMO_MODE`.
- No fabricated metrics/graphs were found in the service — charts render from
  stored rows only (preserved).

### Duplicate files (copy artifact)
The first (failed) `Copy-Item` flattened `lib/*` into the module root. The stray
root-level duplicates (`bing.ts`, `gsc.ts`, `ai-citation/`, …) were verified
byte-identical to `lib/` and **deleted**; `lib/` is canonical.

### Missing files required for plugin packaging — created
`lib/crypto.ts`, `lib/intent.ts`, `lib/options.ts`, `lib/site.ts`,
`src/utils/logger.ts`, `src/utils/ovo-job.ts`, `src/index.ts`,
`src/admin/index.ts`, `src/admin/components/OvoOverrideForm.tsx`,
6 jobs, 1 workflow, 1 subscriber, plus `package.json` / `tsconfig.json` fixes.
