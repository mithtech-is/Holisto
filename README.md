# Holisto

Holisto is a suite of installable plugins for **Medusa v2** commerce backends.
Each plugin drops into an existing Medusa app — `npm install`, a few lines of
config, `db:migrate`, and the features appear in the admin dashboard.

This is a **private monorepo**: it holds the TypeScript source. Clients never
receive this repo — they install the **published, compiled package** (only the
`.medusa/server` build is published, per each package's `files` field).

## Packages

| Package | What it is |
|---|---|
| [`@holisto/holisto-plugin-cashfree-wallet`](packages/holisto-plugin-cashfree-wallet) | Cashfree-backed custodial INR wallet: virtual accounts (auto-collect deposits), Secure ID KYC (PAN/Aadhaar/Bank/Demat), held-order auto-capture, promo balance, fees, and an admin console. |
| [`@holisto/holisto-plugin-ovo`](packages/holisto-plugin-ovo) | OVO — Online Visibility Optimization: SEO/AEO/LLMO auditing, keyword & citation tracking, Search Console / Bing / IndexNow integrations. |

The two are **independent** — a client can install either or both.

## Develop

Each package is a self-contained Medusa plugin. From a package folder:

```bash
cd packages/holisto-plugin-cashfree-wallet
npm install
npm run build      # compiles to .medusa/server (gitignored)
npm pack           # produces a .tgz for local testing / distribution
```

> A fresh clone has no `node_modules` or `.medusa` (both gitignored) — run
> `npm install` + `npm run build` in each package before using it.

## Publish / distribute

Clients get the compiled package, gated by access — never this repo. Options:

- **Per-client tarball** — `npm pack` → send the `.tgz`.
- **Private registry** (GitHub Packages / npm private) — `npm publish`; clients
  install with an access token you issue.
- **Self-serve store** (e.g. Lemon Squeezy) — payment + license key + download
  in one.

## Install into a client's existing Medusa app

```bash
npm install @holisto/holisto-plugin-cashfree-wallet
```
```ts
// medusa-config.ts
plugins: [{ resolve: "@holisto/holisto-plugin-cashfree-wallet", options: {} }],
modules: [
  { resolve: "@medusajs/medusa/payment",
    options: { providers: [{ resolve: "@holisto/holisto-plugin-cashfree-wallet/providers/cashfree_wallet", id: "cashfree-wallet" }] } },
],
```
```bash
npx medusa db:migrate   # additive — creates new tables only
npx medusa build        # admin pages appear
```

See each package's README for full configuration.

## Requirements

- Medusa **v2.15+**, PostgreSQL, Node 20+.
- Wallet: a Cashfree merchant account for live use.

## License

UNLICENSED — private. © Holisto.
