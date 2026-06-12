# Build status — @holisto/medusa-plugin-cashfree-wallet

Tracks the extraction of the Cashfree wallet from the host Polemarch app into
this redistributable plugin. See `../../wallet/WALLET_PLUGIN_PLAN.md` for the
full plan, feature list, and decisions.

## Locked decisions
- Scope: full suite (wallet, KYC/VBA, held orders, webhooks, fees, DPDP, inboxes), feature-flaggable.
- **Referrals: OUT** of the plugin (removes the dead wallet↔gamification money path).
- PII (PAN/Aadhaar/bank/CMR registries): **encrypt at rest by default** (migration pending).
- `gamification`: bundled but **optional** (points only).
- Notifications/logging: pluggable adapter + shim (no host email module).

## ✅ Done (scaffold)
- [x] Plugin skeleton (package.json, tsconfig, .gitignore, .env.example) — modeled on `medusa-plugin-ovo`, Medusa 2.14.2.
- [x] `src/modules/cashfree_wallet` (22 models, 41 migrations, service, `cashfree/` integration) — copied verbatim.
- [x] `src/modules/customer_identity` (client_id + PAN→VBA registry) — copied verbatim.
- [x] `src/modules/gamification` (points engine, optional) — copied verbatim.
- [x] `src/providers/cashfree_wallet` (payment provider) — copied; import fixed to `../../modules/cashfree_wallet`.
- [x] Admin UI: `src/admin/routes/wallets/page.tsx` (4-tab Wallet page) + `src/admin/index.ts`.
- [x] `src/admin/components/CustomerSearch.tsx` — rebuilt against core `/admin/customers?q=`.
- [x] Admin routes ported (5): `webhook-events`, `wallets/[customer_id]`, `.../adjust`, `.../freeze`, `cashfree-settings`. (referral-settings dropped.)
- [x] Shims: `src/utils/logger.ts`, `src/lib/notifications.ts` (+ `polemarch_communication/.../send-event-email` compat shim).
- [x] Scripts: `backfill-cmr-registry.ts`, `sync-vba-allowed-remitters.ts`.

## ✅ Done (round 2 — 2026-06-03)
- [x] **Webhook routes** ported + build-verified: `/webhooks/cashfree/payment-gateway` (VBA credit → TPV → applyVbaCredit → drain held → notify) and `/webhooks/cashfree/verification` (async Secure ID callback → flip status → drain held). Both use existing logger + notification shims; need raw-body middleware (below).
- [x] **Admin UI pages** ported: `cashfree/page.tsx` (Cashfree settings) + `manual-kyc/page.tsx` (KYC console). `manual-kyc` carries a `@ts-nocheck` (｀Table.Cell colSpan｀ untyped in @medusajs/ui@4.0.4 — runtime-safe).
- [x] Build green (EXIT=0) with all of the above.

## ✅ Done (round 3 — 2026-06-03)
- [x] **`src/api/middlewares.ts`** built + build-verified: raw-body `preserveRawBody` on `/webhooks/cashfree/*` (deposit-collection HMAC now works), `authenticate("customer")` on store routes, `authenticate("user")` on admin routes, `storeLimiter`/`uploadLimiter`, multer upload (2MB, pdf/jpg/png). (Omitted host-invasive `panNameLockGuard` + `/store/customers/me` override — documented as optional host wiring.)
- [x] **10 host utils** copied to `src/utils/`: `envelope`, `validate-body`, `cmr-text-match`, `identity-uniqueness`, `cart-processing-fee`, `onboarding-events`, `mask-data`, `mask-middleware`, `document-pipeline`, `aadhaar-photo`. (logger stays a shim.)
- [x] **25 store routes** copied + build-green: wallet (`route`,`sync`,`transactions`,`deposit-proof`,`convert-points`), bank-accounts (+`/proof`,`/provision-vba`), demat-accounts (+`/cmr`,`/primary`), kyc (`pan/verify`,`aadhaar/otp-send`,`otp-verify`,`status`,`manual-request`), `fees`, `contact`, `newsletter`, `company-requests`, `checkout/precheck`, `ifsc/[code]`, `upload`.
- [x] npm deps added: `sharp`, `pdf-parse`, `multer`, `express-rate-limit`. (Runtime note: `document-pipeline` shells out to CLI tools — `pdftotext`/imagemagick — for CMR text; document in README.)

## ✅ Done (round 4 — 2026-06-03)
- [x] **60 admin API routes** copied + build-green (full wallet/KYC/registry/DPDP admin surface). Excluded host namespaces: calcula, communication, email, ovo, gamification(admin), products, orders/stamp-duty, posthog-status, job-health, referrals, share-transfers, customers/:id/referral, wallets/referral-settings.
- [x] **11 admin UI pages**: wallets, cashfree, manual-kyc, fees, identity-registry, pan-records, aadhaar-records, bank-records, cmr-records, inbox, customer-360 (+ all tabs).
- [x] **DPDP**: `utils/dpdp/*` (export/scrub/hard-delete) + `store/account/*` routes copied.
- [x] **3 shim modules** written + registerable: `polemarch` (uploadLocal/deleteFile via local disk; notifications no-op), `watchlist` (no-op), `polemarch_communication` (email-log/otp no-op).
- [x] **colSpan fix**: one global `src/types/ui-augment.d.ts` widens `React.HTMLAttributes` (fixes Table.Cell colSpan across all admin pages).
- [x] Build green (EXIT=0). Totals: **6 modules, 1 provider, 60 admin + 28 store + 2 webhook routes, 11 UI pages, 14 utils, 43 migrations, 248 src files.**

## ✅ Done (round 5 — 2026-06-03)
- [x] **Gamification DROPPED** per decision: deleted the heavy module (14 models, 6 migrations, 3.2k-line service, seeds); replaced with a no-op stand-in (valid model-less Module so plugin auto-discovery loads it; tier-discount 0, awards/spends inert). Removed `store/wallet/convert-points` + the customer-360 Gamification tab. Migrations 43→37.
- [x] **LIVE SMOKE TEST in `ovo-test-app` (Medusa 2.15.5) — PASSED.** Packed (`npm pack`), hoisted to monorepo ROOT node_modules (required — `@medusajs/utils` resolves plugin subpaths from root), registered in `apps/backend/medusa-config.ts` (plugin + payment provider; modules auto-register), added `AT_REST_ENCRYPTION_KEY`. `db:migrate` created cashfree_wallet + customer_identity tables. `medusa develop` → **✔ Server ready on :9000, zero errors.** Endpoint probes: webhook GETs `200` (correct JSON), 6 admin routes `401` (registered+guarded), store routes `400` (publishable-key — registered), `/app` `200`. Admin login created: `admin@wallet-test.com` / `Supersecret123`.
- [x] Two monorepo lessons captured: (1) plugin must be installed at the **root** to be resolvable by hoisted `@medusajs/utils`; (2) **do not** list plugin modules in the consumer `modules[]` — they auto-register; only the payment provider needs explicit wiring.

## ⏳ Pending (cleanup + optional)
- [ ] **Verify admin pages render** in the browser at http://localhost:9000/app (plugin admin built with admin-sdk 2.14.2 vs backend 2.15.5 — boot + `/app` 200 are green, but click-through the Wallet/Cashfree/Fees/Customer-360 pages to confirm no runtime UI mismatch).
- ⚠️ **`medusa develop` caveat**: its file-watcher restarts on any change inside `apps/backend/` (incl. stray temp logs), and after an incremental reload the plugin's `/webhooks/cashfree/*` routes drop to 404 (plugin routes live in node_modules, not re-registered on hot-reload). Admin/store routes survive. Fix: keep temp files OUT of the backend dir; for a stable long-running server use `medusa build` + `medusa start` (no watcher) instead of `develop`.
- [ ] **Referral removal pass**: strip `referral` model + referral service methods + migrations from `cashfree_wallet`; remove `ReferralsTab` from customer-360. (Out of scope; currently dead-but-present.)
- [ ] **PII-encryption migration** (release blocker): encrypt `pan_full`/`aadhaar_full`/`account_number_full`/CMR identifiers; reads via `decryptString`; RBAC-gate Reveal.
- [ ] **De-Polemarch options**: `"POLEMARCH"` beneficiary, `bank_codes:["UTIB"]`, scrypt salt, `NNNNYYWW` VBA-id → plugin options. Rename `polemarch`/`polemarch_communication` shim paths; point routes at `lib/notifications.ts`; swap `polemarch.uploadLocal` for Medusa File module.
- [ ] **Held-order capture** works today via `walletModule.captureHeldPaymentAttempts()` called directly in the webhook + verification routes — a separate `capture-held-orders` workflow is NOT required. (Confirm no other workflow expected.)
- [ ] Optional: store/admin `gamification/*` routes + UI page (only if points kept); reconciliation cron (`GET /pg/vba/{id}` drift, daily payments cross-check).
- [ ] **Live smoke test**: register in a throwaway Medusa app, `db:migrate`, exercise admin pages + a webhook.

## 🔜 Pending — plugin work (not host-dependent)
- [x] **Verify build** — `npm install` (1114 pkgs) + `npm run build` (`medusa plugin:build`) both pass. Server compile + admin extensions bundle succeed; `.medusa/server` emits all module/provider/admin entry points. (2026-06-03)
- [ ] **Referral removal pass**: strip `referral` model + referral service methods + referral migrations from `cashfree_wallet`.
- [ ] **PII-encryption migration**: encrypt `pan_full`/`aadhaar_full`/`account_number_full`/CMR identifiers; route reads through `decryptString`; RBAC-gate "Reveal".
- [ ] **De-Polemarch-ify**: `"POLEMARCH"` beneficiary, `bank_codes:["UTIB"]`, scrypt salt, `NNNNYYWW` VBA-id assumption → plugin options.
- [ ] Rename the `polemarch_communication` shim path; point routes at `lib/notifications.ts` directly.
- [ ] Plugin `options` plumbing (encryptionKey, vbaBankCodes, defaultBeneficiaryName, feature flags).
- [ ] Redis rate-limit adapter option.
- [ ] Seed/setup for the singleton `cashfree_setting`; README Cashfree dashboard checklist.
