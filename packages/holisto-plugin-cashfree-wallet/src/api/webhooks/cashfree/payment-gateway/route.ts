import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import {
  CASHFREE_WALLET_MODULE,
  CashfreeWalletService,
} from "../../../../modules/cashfree_wallet"
import { verifyWebhookSignature } from "../../../../modules/cashfree_wallet/cashfree/signature"
import { logger } from "../../../../utils/logger"
import { sendEventEmail } from "../../../../lib/send-event-email"

/**
 * POST /webhooks/cashfree/payment-gateway
 *
 * Cashfree VBA credit notification. Fires when a bank transfer (IMPS/NEFT/
 * RTGS/UPI) is credited into one of our merchant virtual accounts.
 *
 * Security + idempotency model:
 *   1. Require raw body (`bodyParser: { preserveRawBody: true }` in
 *      middlewares.ts) — JSON re-serialisation would break the HMAC.
 *   2. Reject if `CASHFREE_WEBHOOK_SECRET` isn't configured.
 *   3. HMAC-SHA256 verify signature over `timestamp + rawBody`.
 *   4. Reject if timestamp skew > 5 min.
 *   5. Extract a stable event id; insert into `cashfree_webhook_event` —
 *      the unique index on `event_id` makes replays a no-op.
 *   6. Credit the wallet via `applyVbaCredit` (also idempotent via
 *      `cashfree_event_id` on wallet_transaction).
 *   7. Always respond 200 on duplicate or recognised-but-unmatched VBAs
 *      (Cashfree retries on non-2xx, and we don't want to retry-storm
 *      ourselves over an orphaned VBA).
 *
 * Payload shape (Cashfree Payouts VBA): we look for a few common field
 * paths defensively — the exact envelope has shifted across API versions.
 */
/**
 * GET /webhooks/cashfree/payment-gateway
 *
 * Reachability probe. Cashfree's dashboard hits the URL with GET when
 * you first register the webhook to confirm the endpoint exists.
 * Returning 200 here lets the URL be accepted; the actual signed
 * notifications arrive on POST.
 */
export const GET = async (_req: MedusaRequest, res: MedusaResponse) => {
  res
    .status(200)
    .json({ ok: true, endpoint: "cashfree.payment-gateway", method: "POST expected" })
}

export const POST = async (req: MedusaRequest, res: MedusaResponse) => {
  const walletModule = req.scope.resolve(
    CASHFREE_WALLET_MODULE
  ) as CashfreeWalletService

  // Cashfree sends `x-webhook-version` on every delivery starting with
  // the 2025-01-01 API version. Log it so ops can spot a surprise version
  // swap from Cashfree without digging through raw bodies. The signing
  // scheme (timestamp + rawBody → HMAC-SHA256, base64) is stable across
  // versions — we verify the same way for all of them.
  const webhookVersion =
    (req.headers["x-webhook-version"] as string | undefined) ?? "legacy"

  const secret = await walletModule.getWebhookSecret("payment_gateway")
  if (!secret) {
    // Cashfree registers the endpoint BEFORE the admin has pasted the
    // signing secret back into our admin UI — if we 500 here, Cashfree
    // may mark the webhook as failing and disable it. Respond 200 with
    // a warning flag so Cashfree's test passes; the first real
    // notification will re-verify once the secret is set.
    logger.warn(
      "pg webhook: no signing secret configured yet — accepting without verification"
    )
    return res
      .status(200)
      .json({ ok: true, warning: "secret_not_configured" })
  }

  const rawBody =
    (req as any).rawBody !== undefined
      ? (req as any).rawBody
      : JSON.stringify(req.body ?? {})

  // Cashfree dashboard's "Add Webhook Endpoint" → "Test" button on
  // the URL-entry step sends a probe POST BEFORE any signing secret
  // exists for this subscription (the secret is only generated AFTER
  // the URL is accepted). The probe carries no `x-webhook-signature`
  // header. If we 401 it, the dashboard says "endpoint did not respond
  // properly" and ops can't complete the registration flow.
  //
  // Treat a no-signature POST as a reachability test: respond 200
  // without processing the body. Real settlement events ALWAYS carry
  // a signature (Cashfree signs every notification), so this can't be
  // exploited to bypass signature verification on a real credit —
  // those go through the verify path below and either credit or 401
  // as before.
  const sigHeader = req.headers["x-webhook-signature"]
  if (!sigHeader) {
    logger.warn(
      "pg webhook: POST received with no signature header — treating as Cashfree reachability test (200 OK, body not processed)",
    )
    return res.status(200).json({
      ok: true,
      warning: "no_signature_treated_as_reachability_test",
    })
  }

  const verify = verifyWebhookSignature({
    rawBody,
    signatureHeader: sigHeader,
    timestampHeader: req.headers["x-webhook-timestamp"],
    secret,
  })
  if (verify.ok !== true) {
    const reason = verify.reason
    // Snapshot the raw body to disambiguate "Cashfree dashboard test
    // probe with a one-shot test secret" vs "real event with a stale
    // secret". The Test button on Cashfree's dashboard doesn't share
    // its signing material with us; the merchant only sees the secret
    // on the Summary step, AFTER the test passes/fails. Without
    // peeking at the body we can't tell the two cases apart.
    const rawBodyStr =
      typeof rawBody === "string"
        ? rawBody
        : (rawBody as Buffer | undefined)?.toString("utf8") ?? ""
    const peek = rawBodyStr.slice(0, 400)
    logger.warn("pg webhook: signature rejected", {
      reason,
      body_size: rawBodyStr.length,
      body_peek: peek,
      sig_first8: String(sigHeader).slice(0, 8),
      ts: req.headers["x-webhook-timestamp"],
      webhookVersion,
    })

    // Treat the dashboard "Test" probe as a reachability check.
    // Cashfree's Test button sends a STATIC test payload (per their
    // dashboard docs: "we send a sample payload to verify your
    // endpoint responds with 2xx"). The payload doesn't carry any
    // virtual_account_id matching our live VBAs, so even if a bad
    // actor were spoofing one, no wallet would ever credit — the
    // downstream `extractVbaEvent` returns null on a payload with
    // no recognised VBA fields.
    //
    // Heuristic: if the body has no `virtual_account_id` AND no
    // `vba_transfer` AND no `transfer.virtual_account_id` (i.e.
    // there is literally no VBA the credit could land on), treat
    // it as a test probe and return 200 so Cashfree's wizard accepts
    // the URL. Real `PAYMENT_SUCCESS_WEBHOOK` events for VBA always
    // carry one of those keys.
    const looksLikeTestProbe =
      !rawBodyStr.includes('"virtual_account_id"') &&
      !rawBodyStr.includes('"vba_transfer"') &&
      !rawBodyStr.includes('"vAccountId"')
    if (looksLikeTestProbe) {
      logger.warn(
        "pg webhook: signature mismatch but no VBA fields in body — treating as Cashfree dashboard test probe",
      )
      return res.status(200).json({
        ok: true,
        warning: "signature_mismatch_no_vba_fields_treated_as_test_probe",
      })
    }

    return res.status(401).json({ ok: false, reason })
  }

  const payload =
    (typeof rawBody === "string"
      ? safeParse(rawBody)
      : safeParse(rawBody.toString("utf8"))) || (req.body as Record<string, unknown>) || {}

  const event = extractVbaEvent(payload)
  if (!event) {
    logger.warn("pg webhook: unrecognised payload shape", {
      webhookVersion,
      keys: Object.keys(payload || {}),
    })
    // 200 to avoid retries; record for triage
    return res.status(200).json({ ok: true, ignored: "unrecognised_shape" })
  }

  // Idempotent webhook event record — unique index on event_id short-circuits
  // replays.
  try {
    await walletModule.createWebhookEvents({
      // Internal channel tag kept as "vba" to match the WebhookEvent
      // model's enum (would need a migration to rename). Externally the
      // product is Payment Gateway and the route is `/payment-gateway`.
      channel: "vba",
      event_id: event.event_id,
      event_type: event.event_type ?? null,
      signature: String(req.headers["x-webhook-signature"] ?? "") || null,
      payload_raw: payload as Record<string, unknown>,
      processing_status: "processing",
    })
  } catch (err) {
    // Unique constraint → duplicate delivery. Return 200 and exit.
    if (isUniqueViolation(err)) {
      return res.status(200).json({ ok: true, idempotent_replay: true })
    }
    logger.error("pg webhook: failed to record event", { error: err })
    return res.status(500).json({ ok: false, reason: "event_persist_failed" })
  }

  // ── TPV (Third-Party Validation) at webhook-receive time ─────────
  //
  // PG VBA 2024-07-10+ has no API to mutate `allowed_remitters` after
  // create — so instead of locking the VBA to a specific source bank,
  // we accept any remitter into the VBA and validate them HERE,
  // before crediting the wallet. This gives us live-list semantics
  // (the customer adds/removes verified banks; the next deposit's
  // TPV check sees the current list) without ever recreating the
  // VBA on Cashfree's side.
  //
  // Match rule: (remitter_account_number_last4, remitter_ifsc) ∈
  // customer's verified bank_account rows. We only have the last-4
  // of our verified banks (the full number is encrypted), so we
  // compare last-4 of the remitter's number against `account_number_last4`.
  // A small false-positive surface — two banks with the same last-4
  // at the same IFSC is collision-prone but the IFSC narrows it
  // dramatically. Acceptable for now.
  //
  // Mismatch → log AML flag, mark webhook as `tpv_failed`, return
  // 200 (no auto-refund yet — admin sweeps via /app/wallets and
  // initiates Cashfree-Payouts refunds manually).
  let tpvCustomerId: string | null = null
  try {
    const [vba] = await walletModule.listCashfreeVirtualAccounts({
      virtual_account_id: event.virtual_account_id,
    })
    tpvCustomerId = vba?.customer_id ?? null
  } catch (vbaErr) {
    logger.warn("pg webhook: VBA lookup for TPV failed", {
      virtual_account_id: event.virtual_account_id,
      error: (vbaErr as Error).message,
    })
  }

  if (tpvCustomerId && event.remitter_account_number) {
    const remitterLast4 = String(event.remitter_account_number)
      .replace(/\s+/g, "")
      .slice(-4)
    const remitterIfsc = (event.remitter_ifsc ?? "").trim().toUpperCase()
    const verifiedBanks = await walletModule
      .listBankAccounts({
        customer_id: tpvCustomerId,
        verification_status: "verified",
      })
      .catch(() => [] as any[])
    const matched = verifiedBanks.some((b: any) => {
      const sameLast4 = String(b.account_number_last4) === remitterLast4
      // IFSC: enforce when the webhook carries it; allow last-4-only
      // match when Cashfree didn't send IFSC (older shape). If we
      // ever want to tighten, gate on `remitterIfsc.length > 0`.
      const sameIfsc = remitterIfsc
        ? String(b.ifsc ?? "").toUpperCase() === remitterIfsc
        : true
      return sameLast4 && sameIfsc
    })
    if (!matched) {
      logger.warn("pg webhook: TPV failed — remitter is not a verified bank", {
        customer_id: tpvCustomerId,
        virtual_account_id: event.virtual_account_id,
        remitter_account_last4: remitterLast4,
        remitter_ifsc: remitterIfsc || null,
        amount_rupees: event.amount_rupees,
        event_id: event.event_id,
        verified_banks_count: verifiedBanks.length,
      })
      await walletModule
        .updateWebhookEvents({
          selector: { event_id: event.event_id },
          data: {
            processing_status: "failed",
            processing_error: `tpv_failed: remitter ${remitterLast4}@${
              remitterIfsc || "??"
            } not on verified bank list`,
            processed_at: new Date(),
          },
        })
        .catch(() => {})
      return res.status(200).json({
        ok: true,
        warning: "tpv_failed",
        action: "manual_refund_required",
      })
    }
  }

  try {
    const tx = await walletModule.applyVbaCredit({
      virtual_account_id: event.virtual_account_id,
      amount_inr: Math.round(event.amount_rupees * 100), // paise
      cashfree_event_id: event.event_id,
      utr: event.utr,
      remitter_name: event.remitter_name,
      remitter_account_number: event.remitter_account_number,
    })

    await walletModule.updateWebhookEvents({
      selector: { event_id: event.event_id },
      data: {
        processing_status: tx ? "processed" : "failed",
        processing_error: tx ? null : "unknown_virtual_account_id",
        processed_at: new Date(),
      },
    })

    if (!tx) {
      logger.warn("pg webhook: orphaned settlement (no VBA match)", {
        virtual_account_id: event.virtual_account_id,
      })
      return res.status(200).json({ ok: true, warning: "orphaned_vba" })
    }

    // Drain any PaymentAttempts that were held awaiting this customer's
    // funds. FIFO — stops on the first attempt that still can't be covered.
    // Errors are logged but don't fail the webhook (credit already applied).
    let captured: Array<{ attempt_id: string; order_id: string | null; tx_id: string }> = []
    try {
      captured = await walletModule.captureHeldPaymentAttempts(tx.customer_id)
    } catch (drainErr) {
      logger.warn("pg webhook: held-order drain failed", {
        customer_id: tx.customer_id,
        error: drainErr,
      })
    }

    // Customer email — "₹X credited to your wallet".
    try {
      const wallet = await walletModule
        .ensureWallet(tx.customer_id)
        .catch(() => null)
      await sendEventEmail(req.scope, "wallet.deposit_credited", {
        customer_id: tx.customer_id,
        amount_inr: Math.round(event.amount_rupees).toLocaleString("en-IN"),
        utr: event.utr ?? "—",
        remitter: event.remitter_name ?? "—",
        virtual_account_number: event.virtual_account_id ?? "—",
        wallet_balance_inr: wallet
          ? Math.round(wallet.balance_inr / 100).toLocaleString("en-IN")
          : "—",
        wallet_url: `${process.env.STOREFRONT_URL || "https://polemarch.in"}/dashboard/wallet`,
      })
    } catch (mailErr) {
      logger.warn("pg webhook: email fire failed", { error: mailErr })
    }

    return res.status(200).json({
      ok: true,
      transaction_id: tx.id,
      captured_attempts: captured.map((c) => c.attempt_id),
    })
  } catch (err) {
    logger.error("pg webhook: processing failed", { error: err })
    await walletModule
      .updateWebhookEvents({
        selector: { event_id: event.event_id },
        data: {
          processing_status: "failed",
          processing_error: (err as Error).message?.slice(0, 500) ?? "unknown",
          processed_at: new Date(),
        },
      })
      .catch(() => {})
    // Return 500 so Cashfree retries (the event_id dedupe will catch the
    // eventual-success path).
    return res.status(500).json({ ok: false, reason: "processing_failed" })
  }
}

// --- helpers ---

type VbaEvent = {
  event_id: string
  event_type?: string
  virtual_account_id: string
  amount_rupees: number
  utr?: string | null
  remitter_name?: string | null
  remitter_account_number?: string | null
  /** PG-VBA 2025-01-01 PAYMENT_SUCCESS_WEBHOOK includes the remitter
   *  IFSC alongside the account number — used by our webhook-time
   *  TPV check to validate the deposit came from one of the
   *  customer's verified banks. */
  remitter_ifsc?: string | null
}

function extractVbaEvent(p: Record<string, unknown>): VbaEvent | null {
  // VBA / Auto-Collect payload shapes we support (oldest → newest):
  //
  //   Legacy Payouts VBA (2021-ish):
  //     { data: { transfer: {...}, vAccount: {...} } }
  //
  //   PG Auto-Collect 2022-09-01 / 2023-08-01:
  //     { data: { virtual_account, transaction|payment: {
  //         virtual_account_id, amount, utr, txstatus, remitter_account,
  //         remitter_name, reference_id, credit_ref_number, ...
  //     } } }
  //
  //   PG Auto-Collect "AMOUNT_COLLECTED" (2024-ish standalone Auto-Collect):
  //     { type: "AMOUNT_COLLECTED",
  //       event_time: "...",
  //       data: {
  //         virtual_account: { virtual_account_id, virtual_account_number, ifsc },
  //         payment: {
  //           cf_payment_id, payment_amount, payment_status,
  //           payment_time, payment_utr, payment_group,
  //           remitter_name, remitter_account_number, remitter_ifsc,
  //           reference_id, credit_ref_number, txtime, txstatus,
  //           is_settled
  //         }
  //       } }
  //
  //   PG PAYMENT_SUCCESS_WEBHOOK 2025-01-01 (current latest — VBA arrives
  //   here when the merchant has the unified PG webhook subscription
  //   instead of a separate Auto-Collect subscription). The discriminator
  //   is `data.payment.payment_method.vba_transfer` being present:
  //     { type: "PAYMENT_SUCCESS_WEBHOOK",
  //       data: {
  //         order: {...},   // standard order envelope
  //         payment: {
  //           cf_payment_id, payment_status: "SUCCESS",
  //           payment_amount, payment_time, payment_utr,
  //           payment_method: {
  //             vba_transfer: {
  //               virtual_account_id, virtual_account_number, ifsc,
  //               remitter_name, remitter_account_number, remitter_ifsc,
  //               utr, ...
  //             }
  //           }
  //         }
  //       } }
  //   We unwrap `payment_method.vba_transfer` and treat it as the same
  //   transfer object the older shapes carried at `data.payment` /
  //   `data.transfer`. Non-VBA PAYMENT_SUCCESS_WEBHOOKs (cards, UPI on
  //   regular orders) have no `vba_transfer` block — those return null
  //   from this function and the caller logs `unrecognised_shape` (200).
  //
  // We pick the first matching value at each nested path so any payload
  // the Cashfree dashboard issues — including a future minor version
  // bump that renames another field — keeps working.
  const data =
    (p.data as Record<string, unknown>) ??
    (p.payload as Record<string, unknown>) ??
    p
  if (!data || typeof data !== "object") return null

  const paymentBlock = (data as any).payment as Record<string, unknown> | undefined
  // PAYMENT_SUCCESS_WEBHOOK 2025-01-01: the VBA-relevant fields live
  // under `payment.payment_method.vba_transfer`. Promote that block so
  // the rest of the extractor (which keys on `transfer.virtual_account_id`
  // etc.) finds the values exactly where it expects them.
  const vbaTransfer =
    (paymentBlock?.payment_method as Record<string, unknown> | undefined)
      ?.vba_transfer as Record<string, unknown> | undefined

  const transfer =
    vbaTransfer ||
    paymentBlock ||
    ((data as any).transfer as Record<string, unknown>) ||
    ((data as any).transaction as Record<string, unknown>) ||
    data
  const vAccount =
    ((data as any).virtual_account as Record<string, unknown>) ||
    ((data as any).vAccount as Record<string, unknown>) ||
    vbaTransfer ||
    data

  const virtualAccountId =
    (transfer as any).virtual_account_id ??
    (vAccount as any).virtual_account_id ??
    (vAccount as any).vAccountId ??
    (transfer as any).vAccountId
  if (!virtualAccountId) return null

  // Status check — only credit on SUCCESS. 2025-01-01 introduces
  // `payment_status` alongside the legacy `txstatus` / `status`. For
  // the PAYMENT_SUCCESS_WEBHOOK shape we read payment_status from the
  // outer `payment` block (where it actually lives), not from
  // `vba_transfer` (which doesn't carry status — the event-type
  // already implies SUCCESS, but we double-check).
  const statusRaw = String(
    (paymentBlock as any)?.payment_status ??
      (transfer as any).payment_status ??
      (transfer as any).txstatus ??
      (transfer as any).status ??
      ""
  ).toUpperCase()
  if (statusRaw && statusRaw !== "SUCCESS") return null

  // Amount priority: PAYMENT_SUCCESS_WEBHOOK 2025-01-01 puts the value
  // at `data.payment.payment_amount` (the OUTER payment block, not the
  // vba_transfer sub-block). 2024-ish AMOUNT_COLLECTED puts it at
  // `data.payment.payment_amount` directly. Older versions use `amount`
  // / `transferAmount`. The extractor may also see it at top level on
  // some legacy payloads.
  const amountRaw =
    (paymentBlock as any)?.payment_amount ??
    (transfer as any).payment_amount ??
    (transfer as any).amount ??
    (transfer as any).transferAmount ??
    (p as any).amount
  const amount = Number(amountRaw)
  if (!Number.isFinite(amount) || amount <= 0) return null

  // UTR priority: 2025-01-01 PAYMENT_SUCCESS_WEBHOOK has `payment_utr`
  // on the outer payment block AND a separate `utr` on the inner
  // vba_transfer block (the latter is the bank-issued UTR). Prefer the
  // bank UTR when present, fall back to payment_utr, then legacy fields.
  const utr =
    ((transfer as any).utr as string) ??
    ((paymentBlock as any)?.payment_utr as string) ??
    ((transfer as any).payment_utr as string) ??
    ((transfer as any).credit_ref_number as string) ??
    null

  // Idempotency key priority: Cashfree's `cf_payment_id` is the
  // stable per-payment unique id (lives on the OUTER payment block in
  // PAYMENT_SUCCESS_WEBHOOK). Fall back through older identifiers,
  // then UTR, then a last-resort composite (which effectively disables
  // dedup — we prefer duplicate processing over missing a real deposit).
  const eventId =
    (p as any).event_id ??
    (p as any).id ??
    (paymentBlock as any)?.cf_payment_id ??
    (transfer as any).cf_payment_id ??
    (transfer as any).reference_id ??
    (transfer as any).transferId ??
    (transfer as any).transfer_id ??
    utr ??
    `vba_${virtualAccountId}_${amount}_${(p as any).event_time ?? Date.now()}_${process.hrtime.bigint()}`

  return {
    event_id: String(eventId),
    event_type: String(
      (p as any).event ?? (p as any).type ?? "AMOUNT_COLLECTED"
    ),
    virtual_account_id: String(virtualAccountId),
    amount_rupees: amount,
    utr,
    remitter_name:
      ((transfer as any).remitter_name as string) ??
      ((transfer as any).remitterName as string) ??
      null,
    // 2025-01-01 renamed the field to `remitter_account_number` — older
    // shapes use `remitter_account` / `remitterAccount`.
    remitter_account_number:
      ((transfer as any).remitter_account_number as string) ??
      ((transfer as any).remitter_account as string) ??
      ((transfer as any).remitterAccount as string) ??
      null,
    // PG-VBA 2025-01-01 PAYMENT_SUCCESS_WEBHOOK adds remitter_ifsc.
    // Earlier shapes don't carry it; TPV will fall back to "best
    // effort" (account-number-last4 only) when missing.
    remitter_ifsc:
      ((transfer as any).remitter_ifsc as string) ??
      ((transfer as any).remitterIfsc as string) ??
      null,
  }
}

function safeParse(s: string): Record<string, unknown> | null {
  try {
    return JSON.parse(s) as Record<string, unknown>
  } catch {
    return null
  }
}

function isUniqueViolation(err: unknown): boolean {
  // PG native (code 23505), Mikro-ORM's UniqueConstraintViolationException,
  // Medusa's MedusaError wrap (`type: "duplicate_error"`), and a final
  // stringified fallback. Different layers throw different shapes; we
  // accept any of them so the webhook dedup works regardless of which
  // layer caught the DB-level violation first.
  if (!err || typeof err !== "object") return false
  const e = err as {
    code?: string | number
    type?: string
    name?: string
    errno?: string | number
    message?: string
    cause?: { code?: string; message?: string }
  }
  if (e.code === "23505" || e.errno === "23505") return true
  if (e.cause?.code === "23505") return true
  if (e.type === "duplicate_error" || e.type === "not_allowed") return true
  if (e.name === "UniqueConstraintViolationException") return true
  const stringified = `${e.message ?? ""} ${e.cause?.message ?? ""}`
  return /duplicate key|unique constraint|already exists|unique violation/i.test(
    stringified
  )
}
