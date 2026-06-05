/**
 * Cashfree Auto Collect — `/pg/vba/*` endpoints. These belong to the
 * Payment Gateway / Verification credential set (NOT Payouts), so callers
 * pass a verification-audience CashfreeClient.
 *
 * Verbatim API surface (verified against
 * https://www.cashfree.com/docs/api-reference/payments/latest/pgvba/):
 *
 *   POST /pg/vba           — create a VBA, optionally locked to a single
 *                            source bank account via `allowed_remitters`.
 *   PUT  /pg/vba/{id}      — edit a VBA. All fields updatable, including
 *                            `remitter_lock_details.allowed_remitters` —
 *                            this is what we use to keep allowed-remitter
 *                            lists in sync as customers add/remove banks
 *                            (no need to recreate the VBA, deposit
 *                            details stay stable).
 *   GET  /pg/vba/{id}      — fetch one.
 *   POST /pg/vba/payments  — list payments, filterable by status / VBA /
 *                            date range.
 *
 * Required headers: x-client-id, x-client-secret, x-api-version.
 *
 * The `vba_*` field names in responses are intentional Cashfree
 * conventions; we mirror them in our service.
 */

import { CashfreeClient } from "./client"

/** Cashfree's pinned API version for the PG VBA surface. */
export const PGVBA_API_VERSION = "2024-07-10T00:00:00.000Z"

export type AllowedRemitter = {
  /** Source bank account number that's allowed to credit this VBA. */
  account_number: string
  ifsc: string
}

export type CreateVbaArgs = {
  /** Merchant-side unique id we choose. We use `vba_<bank_account_id>`. */
  virtual_account_id: string
  virtual_account_name: string
  virtual_account_email: string
  virtual_account_phone: string
  /** Lock the VBA to one or more verified source banks. Required for our
   *  flow — we never want to accept unknown remitters. */
  allowed_remitters?: AllowedRemitter[]
  kyc?: {
    pan?: string
    aadhaar?: string
    gst?: string
  }
  /** Inclusive amount range; useful when a single VBA only collects for a
   *  fixed-price plan. We don't set these — wallet deposits can be any size. */
  min_amount?: number
  max_amount?: number
  /** UTIB (Axis), ICIC, YESB. Cashfree picks one if omitted. */
  bank_codes?: string[]
  notification_group?: string
}

export type VbaResponse = {
  vba_bank_code: string
  vba_account_number: string
  vba_ifsc: string
  vba_status: string
  vba_created_on?: string
  vba_last_updated_on?: string
  virtual_account_id: string
  virtual_account_name?: string
  virtual_account_email?: string
  virtual_account_phone?: string
  allowed_remitters?: AllowedRemitter[]
  upi_id?: string
  raw: Record<string, unknown>
}

const PGVBA_HEADERS = { "x-api-version": PGVBA_API_VERSION }

export async function createVba(
  client: CashfreeClient,
  args: CreateVbaArgs
): Promise<VbaResponse> {
  // Cashfree's 2024-07-10 API expects a NESTED request body:
  //
  //   { virtual_account_details: { id, name, email, phone },
  //     remitter_lock_details:   { allowed_remitters: [...] },
  //     amount_lock_details:     { min_amount, max_amount },
  //     kyc_details:             { pan, aadhaar, gst },
  //     bank_codes:              [...],
  //     notification_group:      "..." }
  //
  // The old flat body (virtual_account_id at top level) causes the
  // server to NPE with `Cannot invoke "String.length()" because
  // "vAccountId" is null`. We flatten on input for caller ergonomics
  // and re-nest here.
  const body: Record<string, unknown> = {
    virtual_account_details: {
      virtual_account_id: args.virtual_account_id,
      virtual_account_name: args.virtual_account_name,
      virtual_account_email: args.virtual_account_email,
      virtual_account_phone: args.virtual_account_phone,
    },
  }
  if (args.allowed_remitters && args.allowed_remitters.length > 0) {
    body.remitter_lock_details = { allowed_remitters: args.allowed_remitters }
  }
  if (args.min_amount !== undefined || args.max_amount !== undefined) {
    body.amount_lock_details = {
      ...(args.min_amount !== undefined && { min_amount: args.min_amount }),
      ...(args.max_amount !== undefined && { max_amount: args.max_amount }),
    }
  }
  if (args.kyc && (args.kyc.pan || args.kyc.aadhaar || args.kyc.gst)) {
    body.kyc_details = {
      ...(args.kyc.pan && { pan: args.kyc.pan }),
      ...(args.kyc.aadhaar && { aadhaar: args.kyc.aadhaar }),
      ...(args.kyc.gst && { gst: args.kyc.gst }),
    }
  }
  if (args.bank_codes && args.bank_codes.length > 0) {
    body.bank_codes = args.bank_codes
  }
  if (args.notification_group) {
    body.notification_group = args.notification_group
  }

  const res = await client.request<Record<string, unknown>>({
    method: "POST",
    path: "/pg/vba",
    body,
    idempotencyKey: `pg_vba_${args.virtual_account_id}`,
    headers: PGVBA_HEADERS,
  })
  return pickFirstVba(res.data) ?? unwrapVbaError(res.data)
}

/**
 * Edit an existing VBA — `PUT /pg/vba/{virtual_account_id}`.
 *
 * Every field is optional; pass only what you want to change. The big
 * one is `allowed_remitters` — it's a **REPLACE list, not a delta**, so
 * callers must pass the complete current set of verified banks every
 * time. Pass `allowed_remitters: []` to fully unlock (any remitter
 * permitted).
 *
 * `vba_account_number` and `vba_ifsc` are NOT touched — the customer's
 * deposit address stays the same. Only the metadata changes.
 *
 * Response shape mirrors create: `{ virtual_bank_accounts: [{...}] }`
 * with the freshly-updated configuration.
 */
export type UpdateVbaArgs = {
  virtual_account_name?: string
  virtual_account_email?: string
  virtual_account_phone?: string
  /** Replaces the full remitter-lock list. Pass `[]` to unlock entirely
   *  (treat empty same as not setting `remitter_lock_details`). */
  allowed_remitters?: AllowedRemitter[]
  kyc?: { pan?: string; aadhaar?: string; gst?: string }
  min_amount?: number
  max_amount?: number
  bank_codes?: string[]
  notification_group?: string
}

export async function updateVba(
  client: CashfreeClient,
  virtual_account_id: string,
  args: UpdateVbaArgs
): Promise<VbaResponse> {
  // Edit body is FLAT at the top level (the create endpoint nests under
  // `virtual_account_details`; the edit endpoint does not — see
  // cashfreeVBA.md §2 for the verbatim shape).
  const body: Record<string, unknown> = {}
  if (args.virtual_account_name !== undefined)
    body.virtual_account_name = args.virtual_account_name
  if (args.virtual_account_email !== undefined)
    body.virtual_account_email = args.virtual_account_email
  if (args.virtual_account_phone !== undefined)
    body.virtual_account_phone = args.virtual_account_phone
  if (args.allowed_remitters !== undefined) {
    body.remitter_lock_details = { allowed_remitters: args.allowed_remitters }
  }
  if (args.min_amount !== undefined || args.max_amount !== undefined) {
    body.amount_lock_details = {
      ...(args.min_amount !== undefined && { min_amount: args.min_amount }),
      ...(args.max_amount !== undefined && { max_amount: args.max_amount }),
    }
  }
  if (args.kyc && (args.kyc.pan || args.kyc.aadhaar || args.kyc.gst)) {
    body.kyc_details = {
      ...(args.kyc.pan && { pan: args.kyc.pan }),
      ...(args.kyc.aadhaar && { aadhaar: args.kyc.aadhaar }),
      ...(args.kyc.gst && { gst: args.kyc.gst }),
    }
  }
  if (args.bank_codes && args.bank_codes.length > 0) {
    body.bank_codes = args.bank_codes
  }
  if (args.notification_group) {
    body.notification_group = args.notification_group
  }

  const res = await client.request<Record<string, unknown>>({
    method: "PUT",
    path: `/pg/vba/${encodeURIComponent(virtual_account_id)}`,
    body,
    headers: PGVBA_HEADERS,
    // Idempotency on update is per-call (not per-resource) — every edit
    // gets a fresh nonce so retries of a failed PUT don't accidentally
    // replay an older diff. Cashfree replays return the original
    // response when the same key is reused.
    idempotencyKey: `pg_vba_upd_${virtual_account_id}_${Date.now()}`,
  })
  return pickFirstVba(res.data) ?? unwrapVbaError(res.data)
}

export async function getVba(
  client: CashfreeClient,
  virtual_account_id: string
): Promise<VbaResponse | null> {
  try {
    const res = await client.request<Record<string, unknown>>({
      method: "GET",
      path: `/pg/vba/${encodeURIComponent(virtual_account_id)}`,
      headers: PGVBA_HEADERS,
    })
    return pickFirstVba(res.data)
  } catch {
    return null
  }
}

export type VbaPayment = {
  virtual_account_id: string
  remitter_account: string
  remitter_name?: string
  utr: string
  amount: number
  reference_id?: string
  credit_ref_number?: string
  txtime?: string
  txstatus: "SUCCESS" | "REJECTED" | "WAITING_FOR_PAYMENT" | "FAILED" | string
  is_settled?: boolean
  raw: Record<string, unknown>
}

export type ListVbaPaymentsArgs = {
  status: "ALL" | "SUCCESS" | "REJECTED"
  virtual_account_id?: string
  start_date?: string // YYYY-MM-DD HH:MM:SS
  end_date?: string
  pagination?: { cursor?: string; limit?: number }
}

/** Cashfree 2024-07-10+ requires every VBA created via `/pg/vba` to
 *  reference a pre-existing notification group. This helper creates one
 *  via `POST /pg/vba/notificationgroup`. Idempotent: if a group with the
 *  same name exists, Cashfree returns a `duplicate_resource` error which
 *  we treat as success. */
export async function createNotificationGroup(
  client: CashfreeClient,
  args: {
    notification_group_name: string
    /** At least ONE entry (email or phone) is required — Cashfree's
     *  sandbox rejects empty recipient lists with a 400 "bad URL" error
     *  despite the docs not mentioning this constraint. Callers should
     *  supply a platform-ops address that just absorbs the mails;
     *  the canonical event channel is the signed webhook, not this
     *  email. */
    notification_group_emails?: string[]
    notification_group_phone_numbers?: string[]
  }
): Promise<{ ok: true; created: boolean; name: string }> {
  const emails = args.notification_group_emails ?? []
  const phones = args.notification_group_phone_numbers ?? []
  if (emails.length === 0 && phones.length === 0) {
    throw new Error(
      "createNotificationGroup: at least one email or phone number is required by Cashfree"
    )
  }
  try {
    await client.request<Record<string, unknown>>({
      method: "POST",
      path: "/pg/vba/notificationgroup",
      body: {
        notification_group_name: args.notification_group_name,
        notification_group_emails: emails,
        notification_group_phone_numbers: phones,
      },
      headers: PGVBA_HEADERS,
      idempotencyKey: `ng_${args.notification_group_name}`,
    })
    return {
      ok: true,
      created: true,
      name: args.notification_group_name,
    }
  } catch (e: any) {
    // Treat "already exists" as success so the ensure flow is idempotent.
    const msg = String(e?.body?.message ?? e?.message ?? "").toLowerCase()
    if (
      msg.includes("already") ||
      msg.includes("duplicate") ||
      msg.includes("exists")
    ) {
      return { ok: true, created: false, name: args.notification_group_name }
    }
    throw e
  }
}

export async function listVbaPayments(
  client: CashfreeClient,
  args: ListVbaPaymentsArgs
): Promise<{ payments: VbaPayment[]; raw: Record<string, unknown> }> {
  const res = await client.request<Record<string, unknown>>({
    method: "POST",
    path: "/pg/vba/payments",
    body: args,
    headers: PGVBA_HEADERS,
  })
  const data = (res.data as Record<string, unknown>) ?? {}
  const items =
    ((data as any).payments as Record<string, unknown>[]) ??
    ((data as any).data as Record<string, unknown>[]) ??
    []
  return {
    payments: items.map((p) => ({
      virtual_account_id: String((p as any).virtual_account_id ?? ""),
      remitter_account: String((p as any).remitter_account ?? ""),
      remitter_name: (p as any).remitter_name as string | undefined,
      utr: String((p as any).utr ?? ""),
      amount: Number((p as any).amount ?? 0),
      reference_id: (p as any).reference_id as string | undefined,
      credit_ref_number: (p as any).credit_ref_number as string | undefined,
      txtime: (p as any).txtime as string | undefined,
      txstatus: String((p as any).txstatus ?? ""),
      is_settled: (p as any).is_settled as boolean | undefined,
      raw: p,
    })),
    raw: data,
  }
}

// ── Helpers ──────────────────────────────────────────────────────────

function pickFirstVba(payload: unknown): VbaResponse | null {
  if (!payload || typeof payload !== "object") return null
  const data = payload as Record<string, unknown>

  // Cashfree sometimes returns HTTP 200 with `status: "FAILURE"` and a
  // human-readable message in `message`. Fail explicitly rather than
  // silently returning a half-filled VbaResponse.
  const status = (data.status as string | undefined)?.toUpperCase()
  if (status === "FAILURE" || status === "ERROR") {
    return null
  }

  // Cashfree returns `virtual_bank_accounts: [...]` for both create + get.
  const arr =
    (data.virtual_bank_accounts as Record<string, unknown>[]) ??
    ((data.data as Record<string, unknown>)?.virtual_bank_accounts as Record<string, unknown>[]) ??
    null
  if (Array.isArray(arr) && arr.length > 0) {
    const v = arr[0]
    return {
      vba_bank_code: String((v as any).vba_bank_code ?? ""),
      vba_account_number: String((v as any).vba_account_number ?? ""),
      vba_ifsc: String((v as any).vba_ifsc ?? ""),
      vba_status: String((v as any).vba_status ?? ""),
      vba_created_on: (v as any).vba_created_on as string | undefined,
      vba_last_updated_on: (v as any).vba_last_updated_on as string | undefined,
      virtual_account_id: String((v as any).virtual_account_id ?? ""),
      virtual_account_name: (v as any).virtual_account_name as string | undefined,
      virtual_account_email: (v as any).virtual_account_email as string | undefined,
      virtual_account_phone: (v as any).virtual_account_phone as string | undefined,
      // Cashfree puts allowed_remitters in different places depending on
      // the endpoint. POST /pg/vba (create) returns `allowed_remitters`
      // at the top of each VBA object. GET /pg/vba/{id} and the PUT
      // response both nest it under `remitter_lock_details.allowed_remitters`.
      // Probe both so callers always see the same shape (verified
      // 2026-05-06 against live prod responses; first form was the only
      // path read by the original parser, which made the sync script's
      // count-of-pushed-remitters misreport as 0 even when the lock was
      // intact).
      allowed_remitters:
        ((v as any).allowed_remitters as AllowedRemitter[] | undefined) ??
        (((v as any).remitter_lock_details as
          | { allowed_remitters?: AllowedRemitter[] }
          | undefined)?.allowed_remitters),
      upi_id: (v as any).upi_id as string | undefined,
      raw: v,
    }
  }
  return null
}

function unwrapVbaError(data: unknown): never {
  const d = data as Record<string, unknown> | null
  const message =
    (d as any)?.message ??
    (d as any)?.error?.message ??
    "Cashfree returned no virtual_bank_accounts in response"
  throw new Error(`createVba: ${message}`)
}

