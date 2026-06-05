# Local Testing

## 1. Build the plugin

```bash
cd medusa-plugin-ovo
npm install
npm run typecheck   # tsc --noEmit  → 0 errors expected
npm test            # vitest        → 16 tests pass
npm run build       # medusa plugin:build → .medusa/server
npm pack            # → mithtech-medusa-plugin-ovo-0.1.0.tgz
```

> Scripts use the official `medusa plugin:build` / `medusa plugin:develop`.
> If your installed `@medusajs/cli` predates `plugin:build`, upgrade the
> `@medusajs/*` dev/peer deps to a version that includes it (2.x).

## 2. Develop against a live Medusa app (watch mode)

In the plugin:
```bash
npm run develop          # medusa plugin:develop — watches & rebuilds
```
In a Medusa app, link the plugin once:
```bash
npx medusa plugin:add @holisto/medusa-plugin-ovo
```

## 3. Clean-install test in a fresh Medusa backend

Requires **PostgreSQL**.

```bash
# 1. scaffold a clean app
npx create-medusa-app@latest ovo-test-app
cd ovo-test-app

# 2. install the packed plugin
npm install /path/to/mithtech-medusa-plugin-ovo-0.1.0.tgz

# 3. register it (medusa-config.ts) — plugins + modules arrays
#    (see the README "Register in medusa-config.ts" section)

# 4. migrate, build, start
npx medusa db:migrate
npx medusa build
npm run dev
```

Then open `http://localhost:9000/app`:

- [ ] **Extensions → OVO** appears in the sidebar.
- [ ] All 17 tabs open without console errors.
- [ ] Settings save/reload (General → change brand → save → refresh).
- [ ] Credentials save and come back **masked** (`last4` only).
- [ ] No Polemarch data anywhere on a clean install.
- [ ] Setup-required states show where integrations are unconfigured
      (Metrics, Indexability, Audit, AI Citation, Submit, Cannibalisation).
- [ ] After adding real credentials, the corresponding actions return real data.

## Notes
- A clean install with `demo_mode=false` shows empty/setup states everywhere —
  this is correct, not a bug.
- To preview a populated UI, set `OVO_DEMO_MODE=true` (generic "Acme" data).
  Metrics/audits still require real credentials/site — demo mode never
  fabricates metrics.
