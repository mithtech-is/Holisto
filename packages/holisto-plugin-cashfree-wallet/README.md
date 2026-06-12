# @holisto/medusa-plugin-cashfree-wallet

A Cashfree-backed **custodial INR wallet** for Medusa v2.

- **Wallet & ledger** — per-customer wallet with two buckets (`main` = withdrawable, `promo` = non-withdrawable), paise-integer math, optimistic-concurrency, idempotent ledger.
- **Virtual accounts (VBA)** — one Cashfree PG Auto-Collect virtual account per customer; bank-transfer deposits auto-credit the wallet via webhook, locked to verified remitters (TPV/AML).
- **Secure ID / KYC** — PAN, Aadhaar (OTP), Bank (penny-drop/name-match), Demat/CMR; per-kind toggles; global identity registries.
- **Payments** — a `cashfree-wallet` payment provider that debits the wallet at authorize; insufficient funds → **held order** that auto-captures when funds land.
- **Admin console** — a "Wallet" page with Held orders / Customer wallet / Webhook events / Secure ID audit tabs, plus manual verify, adjust, and freeze.
- **India/INR only.**

> ⚠️ **Status: in active extraction from a host app.** Core modules + payment provider + a subset of admin routes/UI are in place. Store routes, Cashfree webhook routes, and the held-order workflow are still being ported. See `docs/BUILD_STATUS.md`.

## Requirements

- Medusa **v2.14+**, PostgreSQL, Node 20+.
- A Cashfree merchant account with **PG Auto-Collect** enabled and a **notification group** created (sandbox + production).

## Install

```bash
npm install @holisto/medusa-plugin-cashfree-wallet
```

### Register in `medusa-config.ts`

The plugin auto-loads its API routes, subscribers, jobs, workflows, and admin UI. Its **modules and the payment provider must be registered explicitly**:

```ts
module.exports = defineConfig({
  plugins: [
    {
      resolve: "@holisto/medusa-plugin-cashfree-wallet",
      options: {},
    },
  ],
  modules: [
    // The plugin's modules (cashfree_wallet + customer_identity) auto-register
    // via plugin discovery — you don't need to list them. Only the payment
    // PROVIDER needs explicit wiring:
    {
      resolve: "@medusajs/medusa/payment",
      options: {
        providers: [
          {
            resolve:
              "@holisto/medusa-plugin-cashfree-wallet/providers/cashfree_wallet",
            id: "cashfree-wallet",
          },
        ],
      },
    },
  ],
})
```

Run migrations: `npx medusa db:migrate`.

## Configuration

1. **`AT_REST_ENCRYPTION_KEY`** (env) — 32-byte base64 key. Encrypts Cashfree secrets, bank account numbers, and (after the PII-encryption migration) the PAN/Aadhaar/CMR registries. **Back it up.**
2. **Cashfree credentials** — entered (encrypted) in the admin **Cashfree** settings page, per product (PG / Payouts / Verification Suite) and per environment (sandbox / production).
3. **Notification group** — set `pg_notification_group` to the Auto-Collect group you created in the Cashfree dashboard.

See `.env.example` for all environment fallbacks.

## Notifications

The plugin does not bundle an email module. Customer-facing notifications are emitted on the Medusa **Event Bus**; subscribe to wire your own provider:

| Event | Payload |
|---|---|
| `wallet.credited` / `wallet.debited` | `{ customer_id, amount_inr, reason, note, wallet_balance_inr, bucket }` |
| `wallet.frozen` | `{ customer_id, note }` |

## What's included

The plugin ships exactly **two modules** — `cashfree_wallet` (the wallet, KYC,
fees, inbox, registries) and `customer_identity` (the PAN→client-id→VBA
registry that VBA provisioning needs). Everything else is plain `src/lib/`
helpers.

## Differences from the source app

- **Referrals** and **gamification/points** are intentionally **excluded**.
- **DPDP** (customer data export/erasure) is not included in this build.
- Host modules from the source app (`polemarch`, `polemarch_communication`,
  `watchlist`) are **gone** — file storage is a local-disk `lib/file-storage.ts`
  (swappable for the Medusa File module) and notifications are emitted on the
  **Event Bus** (`lib/notifications.ts`); logging uses a `lib`/`utils` shim.
- File uploads (KYC docs) are written under `WALLET_UPLOAD_DIR`
  (default `static/uploads`); set `WALLET_UPLOAD_DIR` / `WALLET_UPLOAD_PUBLIC_PREFIX`
  to relocate.

## License

UNLICENSED (private).
