# @holisto/medusa-plugin-ovo

**OVO — Online Visibility Optimization** for Medusa v2. One admin control
surface for every channel a brand can be found in: traditional search (SEO),
AI answer engines (AEO), generative search (GEO/SGE), LLM training & retrieval
(LLMO), knowledge graphs (Entity & KG), plus real Search-Console / Bing
metrics, on-site SEO audits, keyword tracking, and AI-citation monitoring.

> Reusable, brand-neutral plugin. A clean install ships **no** client identity
> and **no** fabricated data — every surface shows an honest setup-required or
> empty state until you configure your brand and credentials.

## What OVO does

- **General / Brand identity** — master switch, per-channel toggles, brand name,
  legal name, alternate names, logo, slogan, site identity.
- **SEO** — robots policy, sitemap shard toggles + live counts, default meta,
  brand block, robots preview.
- **GEO / SGE** — canonical summary paragraph, question-intent keywords, source
  attribution.
- **AEO** — site-wide FAQs + FAQ JSON-LD, E-E-A-T fields, default page/category FAQs.
- **LLMO** — `llms.txt` / `llms-full.txt`, retrieval/training/scraper bot policy + overrides.
- **Entity & KG** — `sameAs` links, `knowsAbout` topics, service catalog,
  Organization schema preview.
- **Retrieval** — H2 chunking preference, chunk size, JSONL export flag, preview.
- **Pages** — focus pages + per-URL overrides (title/meta/canonical/JSON-LD/FAQ/robots).
- **Submit** — IndexNow / GSC / Bing status, push to all, submission log.
- **Metrics** — real GSC Search Analytics + Bing rows; graphs from stored rows only.
- **Audit** — real on-site audits (status, title, meta, canonical, H1, schema,
  noindex, robots, image alt, response time) with runs, regressions, quality score.
- **Keywords / Groups perf / Opportunities / Cannibalisation / Indexability** —
  keyword targets, group rollups, derived opportunities, cannibalisation, GSC URL inspection.
- **AI Citation** — ask OpenAI / Anthropic / Perplexity / Gemini your prompts;
  store answers and compute mention rate, citation rate, provider/prompt coverage,
  and citation rank (only when a provider exposes ordered citations).

## Installation

```bash
npm install @holisto/medusa-plugin-ovo
```

### Register in `medusa-config.ts`

Register OVO in the **`plugins` array only**. Medusa auto-loads the plugin's
module, API routes, admin UI, jobs, subscribers, and workflows from there.

> Do **not** also add the OVO module to the `modules` array — the plugin
> registers its own module, and a manual `modules` entry pointing at the
> compiled module path makes Medusa's config loader `require()` it at
> config-eval time and fail. `plugins`-only is the correct, tested setup.

```ts
import { defineConfig } from "@medusajs/framework/utils"

module.exports = defineConfig({
  // ...
  plugins: [
    {
      resolve: "@holisto/medusa-plugin-ovo",
      options: {
        enable_admin: true,
        enable_jobs: true,
        enable_ai_citations: true,
        enable_gsc: true,
        enable_bing: true,
        enable_indexnow: true,
        demo_mode: false,
        max_audit_urls: 500,
        max_inspection_urls: 200,
        max_ai_prompts_per_run: 50,
      },
    },
  ],
})
```

After registering, run `npx medusa db:migrate` then `npx medusa develop`.
(In an npm-workspaces monorepo, ensure the package resolves from the repo-root
`node_modules` — Medusa's framework resolves plugin modules from there.)

### Plugin options

| Option | Default | Purpose |
|---|---|---|
| `enable_admin` | `true` | Show the OVO admin UI |
| `enable_jobs` | `true` | Run the scheduled OVO crons |
| `enable_ai_citations` | `true` | Enable the weekly AI-citation scan |
| `enable_gsc` / `enable_bing` / `enable_indexnow` | `true` | Enable those integrations |
| `demo_mode` | `false` | Seed generic example data (NEVER use in production) |
| `max_audit_urls` | `500` | Cap URLs per audit run |
| `max_inspection_urls` | `200` | Cap URLs per indexability run |
| `max_ai_prompts_per_run` | `50` | Soft cap for AI-citation prompts |

### Environment variables

All credentials can be set in the admin UI (encrypted) **or** via env (fallback).

```dotenv
OVO_DEMO_MODE=false
OVO_ENCRYPTION_KEY=          # 32+ random chars — REQUIRED in production
OVO_SITE_URL=                # https://your-domain.example (for audits/sitemap)

OVO_GSC_SERVICE_ACCOUNT_JSON=
OVO_GSC_PROPERTY=            # sc-domain:your-domain.example or https URL
OVO_BING_API_KEY=
OVO_BING_SITE_URL=
OVO_INDEXNOW_KEY=

OVO_OPENAI_API_KEY=
OVO_ANTHROPIC_API_KEY=
OVO_PERPLEXITY_API_KEY=
OVO_GEMINI_API_KEY=

# optional
OVO_ENABLE_JOBS=true                 # set "false" to disable all OVO crons
OVO_STOREFRONT_REVALIDATE_URL=
OVO_REVALIDATE_SECRET=
```

### Migrations

```bash
npx medusa db:migrate
```

Creates all `ovo_*` tables. The migrations have **no dependency** on any
Polemarch / wallet / KYC / order / product table and run on a clean Medusa DB.

### Open in the admin

Start Medusa and open `/app`. OVO appears in the sidebar under
**Extensions → OVO**. All 17 tabs are available immediately.

## First-setup checklist

1. **Brand** (General tab) — set brand name, legal name, logo, slogan.
2. **Site URL** — set `OVO_SITE_URL` so audits/indexability know your domain.
3. **Encryption** — set `OVO_ENCRYPTION_KEY` before saving any credential.
4. **GSC** — paste a service-account JSON + property; verify "Connected".
5. **Bing** — add a Bing Webmaster API key + site URL.
6. **IndexNow** — add an IndexNow key.
7. **AI providers** — add at least one provider key and create prompts.
8. **First audit** — Audit tab → "Run audit".
9. **First AI scan** — AI Citation tab → "Run now".

### GSC setup
Create a Google Cloud service account with the **Search Console API** enabled,
add it as a user on your Search Console property, paste the JSON into the GSC
credential, and set the property (`sc-domain:your-domain.example`).

### Bing setup
Get a Bing Webmaster Tools API key (Settings → API access) and set it plus your
verified site URL.

### IndexNow setup
Generate an IndexNow key, host the `<key>.txt` file on your domain, and set the
key in OVO. Submissions notify Bing and Yandex.

### AI provider setup
Add any of OpenAI / Anthropic / Perplexity / Gemini keys, then create prompts in
the AI Citation tab. The weekly cron (or "Run now") asks each prompt across all
configured providers and stores answers + extracted brand/competitor signals.

## Credentials & security
- Stored AES-256-GCM encrypted (keyed by `OVO_ENCRYPTION_KEY`).
- Never returned in plaintext after save — the API/UI show only `configured`,
  `source` (db/env), and `last4`.
- Can be cleared (forces env fallback) and connection-tested.
- If `OVO_ENCRYPTION_KEY` is unset the module logs a warning and uses an
  insecure dev key — **always set it in production.**

## Scheduled jobs
`ovo-daily-gsc-sync` (03:00), `ovo-daily-bing-sync` (04:00),
`ovo-daily-audit` (02:00), `ovo-daily-indexability` (04:30),
`ovo-weekly-ai-citations` (Mon 05:00), `ovo-keyword-rollup` (01:00).
Each checks `enable_jobs`, self-skips when its integration isn't configured, and
never throws — one failing provider can't crash Medusa. The manual UI buttons
call the same service methods.

## Troubleshooting
- **OVO not in sidebar** → confirm the plugin is in `plugins` and you rebuilt the
  admin (`medusa build` / restart in dev).
- **Routes fail to resolve the OVO service** → make sure the plugin is in the
  `plugins` array and resolves from the repo-root `node_modules` (re-run
  `npm install`, then restart). Do not add it to the `modules` array.
- **`Cannot use import statement outside a module` on boot** → you're on an
  older build; reinstall the latest package (the compiled server output is
  CommonJS).
- **"Connect Google Search Console…"** → add GSC credentials (expected until then).
- **Saved credential won't decrypt** → `OVO_ENCRYPTION_KEY` changed; re-save it.

## Known limitations
- **Core Web Vitals (CrUX)** and **Yandex Webmaster** ingestion are **not
  bundled** in this version — their endpoints/buttons return honest no-ops
  (zero), never fabricated numbers.
- **Cannibalisation** needs GSC query×page pair data, which this version does
  not ingest — the tab shows its "run GSC dimension sync" setup state.
- **Citation rank** is only computed when a provider returns ordered citations;
  otherwise reported as unavailable (never faked).

## Development
See [`docs/local-testing.md`](docs/local-testing.md) and
[`docs/manual-qa-checklist.md`](docs/manual-qa-checklist.md). Audit and cleanup
notes: [`docs/source-audit.md`](docs/source-audit.md),
[`docs/hardcoded-values-cleanup.md`](docs/hardcoded-values-cleanup.md).
