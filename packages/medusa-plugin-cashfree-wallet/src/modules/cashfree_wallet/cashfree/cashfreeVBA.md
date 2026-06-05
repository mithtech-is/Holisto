# Cashfree PG VBA — full API reference

> **Purpose** — single-page reference for editing the VBA code paths in
> the polemarch backend. Pulled from
> https://www.cashfree.com/docs/api-reference/payments/latest/pgvba/* on
> 2026-05-05. If Cashfree updates the docs, refresh this file.

## Common contract

- **Base URL (production):** `https://api.cashfree.com`
- **Base URL (sandbox):** `https://sandbox.cashfree.com`
- **Required headers on every endpoint:**
  - `x-client-id` — merchant app ID (from Cashfree merchant dashboard)
  - `x-client-secret` — merchant secret (encrypt at rest; we keep it on
    `cashfree_setting.production_client_secret_encrypted` AES-GCM)
  - `x-api-version: 2024-07-10T00:00:00.000Z` — pin this exact value;
    older versions are the deprecated "Auto Collect" product and will
    400 / accept different shapes.
  - `Content-Type: application/json` for write methods.
- **Optional header:** `x-request-id` (UUID), surfaced back in logs for
  Cashfree-side troubleshooting.
- **Idempotency:** write methods accept `x-idempotency-key`; replays
  return the same response and the response header
  `x-idempotency-replayed: true`.
- **Rate-limit headers** on every response:
  `x-ratelimit-limit`, `x-ratelimit-remaining`,
  `x-ratelimit-retry`, `x-ratelimit-type`.
- **Standard error envelope:**
  ```json
  { "message": "...", "code": "...", "type": "..." }
  ```
  Common HTTP codes: `400` (validation), `401` (bad creds), `404` (not
  found), `409` (already exists / conflict), `422` (idempotency
  mismatch), `429` (rate limit), `502` (bank backend failure).

---

## 1. Create VBA — `POST /pg/vba`

Mints a new VBA. We use this for first-time provisioning per customer.

### Request body

```jsonc
{
  "virtual_account_details": {                 // required
    "virtual_account_id":   "00012618",        // alphanumeric only, ≤ 8 chars when YESB-issued
    "virtual_account_name": "Customer Name",   // alphanumeric + spaces; what shows on Cashfree dashboard + remitter's transfer screen
    "virtual_account_email":"foo@example.com",
    "virtual_account_phone":"+919876543210"    // we send +91-prefixed; Cashfree accepts despite docs saying "8-13 numeric"
  },
  "kyc_details": {                             // optional
    "gst":     "29AAICP2912R1ZR",
    "pan":     "ABCPV1234D",
    "aadhaar": "655675523712"
  },
  "remitter_lock_details": {                   // optional — TPV / AML lever
    "allowed_remitters": [
      { "account_number": "26291800001191", "ifsc": "YESB0000262" }
    ]
  },
  "amount_lock_details": {                     // optional — fixed-price flows only
    "min_amount": 1000,
    "max_amount": 5000
  },
  "bank_codes": ["UTIB", "ICIC", "YESB"],      // optional; subset of activated partner banks
  "notification_group": "PLMwallet"            // optional but Cashfree errs without it on create
}
```

### Bank codes

Only three issuing banks are supported:
- `UTIB` — AXIS Bank (only one currently activated for our merchant as of 2026-05-04)
- `ICIC` — ICICI Bank
- `YESB` — Yes Bank (constraint: `virtual_account_id` ≤ 8 chars when YESB-issued)

### Response (200)

```jsonc
{
  "virtual_bank_accounts": [{                  // one entry per bank_code requested
    "vba_bank_code":      "UTIB",
    "vba_account_number": "94351020001772",
    "vba_ifsc":           "UTIB0CCH274",
    "vba_status":         "ACTIVE",
    "vba_created_on":     "2026-05-05T00:00:00Z",
    "vba_last_updated_on":"2026-05-05T00:00:00Z",
    "virtual_account_details": {…},
    "kyc_details":         {…},
    "remitter_lock_details":{…},
    "amount_lock_details": {…},
    "notification_group":  "PLMwallet"
  }]
}
```

### Common 4xx
- `412 default_virtual_account_not_found` — fires when `bank_codes` is
  omitted **and** the merchant dashboard has no default bank for VBA
  configured. Fix: pass `bank_codes` explicitly. We hardcode `["UTIB"]`.

---

## 2. Edit VBA — `PUT /pg/vba/{virtual_account_id}` 🔥

> **All fields are updatable, including `remitter_lock_details.allowed_remitters`.**
> Discovered 2026-05-05 — **earlier code/comments saying "Cashfree has no
> update endpoint" are wrong**. Use this endpoint to keep
> `allowed_remitters` in sync as customers add/remove verified banks,
> instead of recreating the VBA.

### Path

`PUT /pg/vba/{virtual_account_id}`

### Request body — every field optional

```jsonc
{
  "virtual_account_name":  "New Name",                // alphanumeric + spaces
  "virtual_account_email": "new@example.com",
  "virtual_account_phone": "9876543210",
  "kyc_details":           { "gst": "...", "pan": "...", "aadhaar": "..." },
  "remitter_lock_details": {
    "allowed_remitters": [
      { "account_number": "...", "ifsc": "..." },     // FULL list — replaces existing
      { "account_number": "...", "ifsc": "..." }
    ]
  },
  "amount_lock_details": { "min_amount": 1000, "max_amount": 5000 },
  "bank_codes":         ["UTIB"],
  "notification_group": "PLMwallet"
}
```

> ⚠️ **`allowed_remitters` is a REPLACE list, not a delta.** Send the
> complete current set on each call (i.e. all currently-verified banks),
> not just the additions.

### Response

Same shape as the Create response: `{ virtual_bank_accounts: [{...}] }`
with the freshly updated configuration. `vba_account_number` and
`vba_ifsc` **stay the same** — only the metadata changes.

### Implications for our code

- New verified bank → call `PUT /pg/vba/<client_id>` with the updated
  full `allowed_remitters` list.
- Bank deleted → call `PUT /pg/vba/<client_id>` with the remaining
  verified-bank list (or empty `allowed_remitters: []` to fully unlock
  — verify Cashfree accepts an empty array vs. `remitter_lock_details`
  omitted).
- The customer's `vba_account_number` is stable — saved transfer
  instructions don't break.

---

## 3. Manage VBA (status) — `PATCH /pg/vba/{virtual_account_id}`

Activate / deactivate a VBA. This is what the dashboard's toggle
"Active / Inactive" hits.

### Request body

```jsonc
{
  "bank_codes": "YESB",          // single bank code, NOT array (per docs; verify behaviour)
  "status":     "ACTIVE"          // or "INACTIVE"
}
```

Only two transitions documented: `ACTIVE` ↔ `INACTIVE`. **No `delete`
operation** — VBAs are soft-killable, never destroyable. Cashfree
retains them forever for audit.

### Response

Same shape as Create / Edit response. New `vba_status` reflects the
transition.

### When we'd use this

- Soft-disable a VBA when a customer is offboarded / DPDP-deleted.
- Re-activate a previously-disabled VBA (instead of minting a new one
  with a fresh `virtual_account_id`).

---

## 4. Get VBA — `GET /pg/vba/{virtual_account_id}`

Fetch the current state of a single VBA. Used for reconciliation /
admin display.

### Response

```jsonc
{
  "virtual_bank_accounts": [{
    "vba_bank_code":      "UTIB",
    "vba_account_number": "...",
    "vba_ifsc":           "...",
    "vba_status":         "ACTIVE",   // or INACTIVE
    "vba_created_on":     "...",
    "vba_last_updated_on":"...",
    "virtual_account_details": {…},
    "kyc_details":         {…},
    "remitter_lock_details":{
      "allowed_remitters": [
        { "account_number": "026291800001191", "ifsc": "YESB0000262" }
      ]
    },
    "amount_lock_details": {…},
    "notification_group":  "..."
  }]
}
```

### Use cases

- Drift-check: compare Cashfree-side `allowed_remitters` vs our local
  verified-bank list and flag mismatches.
- Pre-edit fetch (to compute a full-replace `allowed_remitters` list).

---

## 5. Get VBA Payments — `POST /pg/vba/payments`

List payments to a VBA. Filterable by status, VBA id, date range.
**POST** despite being a read — Cashfree convention so it can take a
filter body.

### Request body

```jsonc
{
  "status": "ALL",                     // required — "ALL" | "SUCCESS" | "REJECTED"
  "virtual_account_id": "00012618",    // optional — filter to one VBA
  "start_date":         "2026-05-01 00:00:00",   // optional
  "end_date":           "2026-05-05 23:59:59",
  "pagination": {
    "cursor": "<base64>",              // for paging
    "limit":  100
  }
}
```

### Response

```jsonc
{
  "cursor": "<base64-next>",
  "limit":  "100",
  "payments": {
    "payment_details": [{
      "virtual_account_id":  "00012618",
      "utr":                 "123456789012",
      "remitter_account":    "5292125633",
      "remitter_name":       "AYUSH KUMAR",
      "amount":              "1000.00",
      "reference_id":        "<cashfree-internal>",
      "credit_ref_number":   "<bank-side-ref>",
      "txtime":              "2026-05-05 12:34:56",
      "is_settled":          "0",      // "1" once settled to merchant bank
      "txstatus":            "SUCCESS" // SUCCESS | REJECTED | WAITING_FOR_PAYMENT | FAILED
    }]
  }
}
```

### Use cases

- Reconciliation cron — pull yesterday's SUCCESS payments, cross-check
  against our `wallet_transaction` rows, alert on drift.
- Customer support: "where's my deposit?" — surface txstatus +
  rejection reason.

---

## 6. Get VBA Payments by UTR — `GET /pg/vba/payments/{utr}`

Lookup a specific transfer by UTR. Returns array (a UTR can theoretically
match multiple payments, e.g. partial-credit splits).

### Response

```jsonc
{
  "payment_details": [{
    "virtual_account_id": "00012618",
    "utr":                "123456789012",
    "remitter_account":   "5292125633",
    "remitter_name":      "AYUSH KUMAR",
    "amount":             "1000.00",
    "reference_id":       "...",
    "credit_ref_number":  "...",
    "txtime":             "...",
    "is_settled":         "0",
    "txstatus":           "SUCCESS"
  }]
}
```

### Use cases

- Customer pastes UTR from their bank's app → support agent looks it up
  to confirm we received it.
- Webhook duplicate-detection: `cf_payment_id` is our primary dedup,
  but UTR is a backup signal.

---

## 7. Notification Groups

A "notification group" is the set of email + phone recipients Cashfree
sends VBA-payment alerts to. **Every VBA must reference a
`notification_group` at create time** (Cashfree errs otherwise; we keep
ours as `PLMwallet` in `cashfree_setting.pg_notification_group`).

### 7a. Create — `POST /pg/vba/notificationgroup`

```jsonc
// Request
{
  "notification_group_name": "PLMwallet",                       // alphanumeric, hyphen, underscore
  "notification_group_emails":       ["finance@polemarch.in"],
  "notification_group_phone_numbers":["9876543210"]
}

// Response (200)
{
  "notification_group": {
    "notification_group_name": "PLMwallet",
    "notification_group_emails":       ["finance@polemarch.in"],
    "notification_group_phone_numbers":["9876543210"],
    "notification_group_created_on":     "...",
    "notification_group_last_updated_on":"..."
  }
}
```

### 7b. Edit recipients — `PUT /pg/vba/notificationgroup/{name}`

Only `notification_group_emails` and `notification_group_phone_numbers`
are editable. The name itself is immutable. Same response shape as
Create.

### 7c. Manage status (activate/deactivate) — `PATCH /pg/vba/notificationgroup/{name}`

```jsonc
{ "status": "ACTIVE" }      // or "INACTIVE"
```

Disables the notification group. Important: any VBA referencing it
keeps working but stops getting notifications. **No delete operation
documented**.

### 7d. Get — `GET /pg/vba/notificationgroup/{name}`

Returns the same `{ notification_group: {…} }` shape. Use to fetch
recipients for display.

---

## Endpoints we use vs. don't (today)

| Endpoint | Method | Path | Wired? | Where |
|---|---|---|---|---|
| Create VBA | POST | `/pg/vba` | ✅ | `cashfree/auto-collect.ts:createVba`, called from `provisionVirtualAccountForCustomer` |
| **Edit VBA** | PUT | `/pg/vba/{id}` | ✅ | `cashfree/auto-collect.ts:updateVba`, wrapped by `service.syncVbaAllowedRemitters`. Called from POST/DELETE `/store/bank-accounts`, POST `/admin/bank-accounts/[id]/verify`, POST `/admin/customers/[id]/provision-vba`, POST `/admin/customers/[id]/sync-vba`, and the backfill script `scripts/sync-vba-allowed-remitters.ts`. |
| Manage VBA status | PATCH | `/pg/vba/{id}` | ❌ | TODO — admin "Deactivate VBA" button (currently we soft-close at the DB level only) |
| Get VBA | GET | `/pg/vba/{id}` | ✅ (helper exists) | `cashfree/auto-collect.ts:getVba`. Exposed via `walletModule.getAutoCollect().getVba(id)`. Not yet called from any route — reconciliation cron is the obvious next consumer. |
| Get VBA Payments | POST | `/pg/vba/payments` | ❌ | TODO — reconciliation, "missing deposit" customer-support flow |
| Get VBA Payments by UTR | GET | `/pg/vba/payments/{utr}` | ❌ | TODO — same use cases |
| Create Notification Group | POST | `/pg/vba/notificationgroup` | ❌ (manually created in dashboard) | OK as is, manual setup |
| Edit Notification Group | PUT | `/pg/vba/notificationgroup/{name}` | ❌ | Optional — admin form to edit recipient list |
| Manage NG status | PATCH | `/pg/vba/notificationgroup/{name}` | ❌ | Optional |
| Get Notification Group | GET | `/pg/vba/notificationgroup/{name}` | ❌ | Optional — admin display |

## Implementation status (2026-05-05)

1. ✅ `updateVba(virtual_account_id, body)` in `cashfree/auto-collect.ts`.
   Edit body is FLAT at top level (unlike the create body which nests
   under `virtual_account_details`).
2. ✅ Wired from POST `/store/bank-accounts`. After a verified add we
   call `provisionVirtualAccountForCustomer` (idempotent — creates
   only if missing) followed by `syncVbaAllowedRemitters`. The first
   bank's create call already includes the full list; the sync on 2nd+
   banks is what actually pushes the new bank into Cashfree's lock
   list.
3. ✅ Wired from DELETE `/store/bank-accounts/[id]` and the admin
   `DELETE /admin/bank-accounts/[id]`. Sync is best-effort, post-
   delete, only when the deleted row was verified (others weren't on
   the lock list).
4. ✅ Wired from POST `/admin/bank-accounts/[id]/verify` (manual
   approve flow) and POST `/admin/bank-accounts/[id]` PATCH when
   `verification_status` flips. Same pattern: provision (idempotent)
   then sync.
5. ✅ Wired from POST `/admin/customers/[id]/provision-vba` (admin
   button) and the storefront retry endpoint
   `/store/bank-accounts/[id]/provision-vba`.
6. ✅ Dedicated **POST `/admin/customers/[id]/sync-vba`** — pushes the
   current verified-bank list to Cashfree on demand. Returns 404 if
   the customer has no active VBA (call provision-vba first).
7. ✅ Backfill script: `npx medusa exec ./src/scripts/sync-vba-allowed-remitters.ts`
   — walks every active VBA and calls `syncVbaAllowedRemitters`.
   Supports `--dry-run` and an optional `<customer_id>` argument for
   single-customer reruns.

### Service-level helpers

- `service.syncVbaAllowedRemitters({ customer_id })` — single entry
  point; reads verified banks, dedups + decrypts, PUTs the list to
  Cashfree, mirrors the response into our local `cashfree_virtual_account.raw`.
  Returns `null` if no active VBA exists. Idempotent.
- `service.buildAllowedRemittersForCustomer(customer_id)` — internal
  helper that produces the `{account_number, ifsc}[]` list. Shared
  between create + sync paths.

### Still open

- `PATCH /pg/vba/{id}` (Manage status) — when we want admin to
  deactivate a VBA without deleting the DB row.
- `GET /pg/vba/{id}` reconciliation cron — drift detection between
  our DB and Cashfree's live state.
- `POST /pg/vba/payments` reconciliation cron — daily cross-check
  against `wallet_transaction`.
