# Changelog

## 0.1.0

Initial release of **@holisto/medusa-plugin-ovo** — Online Visibility
Optimization for Medusa v2.

### Added
- **Module** `online_visibility_optimization` — `OvoService` over 15 models,
  18 migrations, self-contained AES-256-GCM credential encryption
  (`OVO_ENCRYPTION_KEY`).
- **Admin API** — 47 routes under `/admin/ovo/**` (settings, credentials,
  SEO metrics/dimensions/audit/keywords, AI prompts/citations/run/trend,
  submissions, overrides, opportunities, cannibalisation, indexability).
- **Admin UI** — `Extensions → OVO` page with 17 tabs.
- **Jobs** — daily GSC / Bing / audit / indexability, weekly AI-citations,
  daily keyword roll-up. Each is credential-aware and crash-safe.
- **Workflow** — `ovo-run-ai-citation-scan`. **Subscriber** — `ovo.config.updated` example.
- Real implementations for keyword **Opportunities**, sitemap **shard counts**;
  honest setup-state for **Cannibalisation**.

### Changed (from the original internal source)
- Removed the Polemarch wallet/cashfree crypto dependency → standalone `lib/crypto.ts`.
- Brand-neutralised AI-citation detection (`mentions_brand`/`links_brand`,
  brand from settings).
- Replaced Polemarch seeds with neutral defaults; generic demo data gated behind
  `demo_mode` / `OVO_DEMO_MODE`.
- Removed all hardcoded Polemarch / MithTech / internal values (see
  `docs/hardcoded-values-cleanup.md`).

### Fixed (caught by clean-install runtime test)
- Server build now emits **CommonJS** (`tsconfig` `module: Node16`) so Medusa can
  `require()` the compiled modules (ESM output broke config loading).
- Declared the OpenAI / Anthropic / Perplexity / Gemini credential columns on the
  `ovo_setting` model (they existed only in the migration, so saves were silently
  dropped).
- Documented that the plugin must be registered via the **`plugins` array only**
  (a manual `modules` entry breaks Medusa's config loader).

### Verified
Clean install into a fresh Medusa v2 app: `db:migrate` creates all 15 `ovo_*`
tables; server boots; `/admin/ovo` returns neutral settings (no client data);
settings save/load; credentials encrypt (AES-256-GCM) + mask (`last4`);
setup-required/empty states everywhere on a clean install.

### Known limitations
- Core Web Vitals (CrUX) and Yandex Webmaster ingestion are not bundled
  (honest no-ops). Cannibalisation requires query×page GSC data not yet ingested.
