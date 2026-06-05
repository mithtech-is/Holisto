# Manual QA Checklist

Run in a clean Medusa backend with the plugin installed and migrated.
`demo_mode=false` unless noted.

## Install / boot
- [ ] `npx medusa db:migrate` creates `ovo_*` tables with no errors.
- [ ] Medusa starts; no OVO errors in logs.
- [ ] Sidebar shows **Extensions → OVO** (Sparkles icon).

## Tabs open (no console errors)
- [ ] General · SEO · GEO/SGE · AEO · LLMO · Entity & KG · Retrieval · Pages ·
      Submit · Metrics · Audit · Keywords · Groups perf · Opportunities ·
      Cannibalisation · Indexability · AI citation

## Settings persistence
- [ ] General: set brand name/legal name/slogan → Save → refresh → values persist.
- [ ] Channel toggles persist.
- [ ] SEO: robots disallow + sitemap override persist; robots preview updates.
- [ ] LLMO: edit `llms.txt`; bot policy persists.
- [ ] Entity & KG: `sameAs` / `knowsAbout` / services persist; schema preview renders.

## Credentials (security)
- [ ] Save a GSC service-account JSON → response shows `configured:true`,
      `source:"db"`, `last4` only (no plaintext).
- [ ] Refresh → still masked.
- [ ] Clear credential → falls back to env (or `configured:false`).
- [ ] With `OVO_ENCRYPTION_KEY` unset, a warning is logged (dev key).

## Setup-required states (no fake data)
- [ ] Metrics (no GSC): "Connect Google Search Console to see real search metrics."
- [ ] Indexability (no GSC): URL Inspection access required.
- [ ] Audit (no site/sitemap): add/discover a sitemap before running.
- [ ] AI Citation (no provider key/prompts): add a key + active prompts.
- [ ] Submit (no IndexNow/Bing): configure to push URLs.
- [ ] Cannibalisation: "run GSC dimension sync" state.

## Real actions (after configuring)
- [ ] Audit → "Run audit" stores a run with per-URL findings + quality score.
- [ ] Audit history + regressions populate on a second run.
- [ ] Metrics graphs render from stored GSC/Bing rows.
- [ ] Keywords: add a target; CSV import; reclassify intent.
- [ ] Opportunities populate from keyword snapshots after a rollup.
- [ ] AI Citation → "Run now" stores answers; mention/citation rate computed.
- [ ] Submit → "Push to all" logs submissions with last success/error.
- [ ] Pages → add a path override (title/meta/canonical/JSON-LD/FAQ/robots) → saves.

## Brand neutrality
- [ ] No "Polemarch" / "Mithtech" / unlisted-shares text anywhere on a clean install.
- [ ] AI Citation mention detection uses YOUR configured brand name.

## Demo mode (optional)
- [ ] Set `OVO_DEMO_MODE=true`, fresh DB → General shows generic "Acme Store";
      AI Citation has generic demo prompts. Metrics/audits still require real creds.

## Jobs
- [ ] Jobs registered (check logs/scheduler).
- [ ] With no credentials, each job logs a skip and does not throw.
- [ ] `OVO_ENABLE_JOBS=false` disables all OVO crons.
