import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { Modules } from "@medusajs/framework/utils"
import {
  CASHFREE_WALLET_MODULE,
  CashfreeWalletService,
} from "../../../../modules/cashfree_wallet"
import { logger } from "../../../../utils/logger"

type FileEntry = {
  url: string
  kind: string
  source: {
    entity: "customer_metadata" | "bank_account" | "demat_account" | "deposit_proof"
    id: string
  }
  label?: string
  created_at?: string | null
}

/**
 * GET /admin/manual-kyc-requests/:id
 *
 * Single comprehensive payload for the Manual-KYC review page. Bundles
 * everything an approver needs to investigate a partial-match queue
 * item without round-tripping through Customer-360:
 *
 *   - The manual_kyc_request row itself.
 *   - Customer summary (id, email, name, phone, kyc-related metadata).
 *   - submitted_pan: what the user TYPED on the storefront (name +
 *     masked PAN + name-match score + grade + mismatch_hint), pulled
 *     from the latest secure_id_verification row of kind=pan.
 *   - submitted_aadhaar: parallel for Aadhaar (latest otp-send +
 *     otp-verify rows; otp-send carries the masked Aadhaar, otp-verify
 *     carries the OTP outcome + cross-doc score).
 *   - pan_record / aadhaar_record: the canonical registry rows linked
 *     via customer.metadata.pan_hash / aadhaar_hash, plus any rows the
 *     audit metadata directly references (covers the rare case where
 *     metadata wasn't linked because the match was loose).
 *   - files: every uploaded document URL — PAN card, Aadhaar card,
 *     selfie, bank proofs, demat CMRs, deposit proofs. Same union the
 *     Documents tab in Customer-360 shows.
 *
 * Approver workflow:
 *   1. Inspect submitted vs registry data side-by-side to spot the
 *      typo, abbreviation, or initial-vs-full-name pattern.
 *   2. Open uploaded PAN card / Aadhaar card photos to confirm
 *      identity matches.
 *   3. Approve or reject via POST /admin/customers/:id/kyc/manual
 *      (which auto-closes this request via the manual_kyc_request
 *      auto-close hook added 2026-05-07) OR
 *      POST /admin/manual-kyc-requests/:id/decide for a status-only
 *      close.
 */
export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const { id } = req.params
  if (!id) return res.status(400).json({ message: "Missing id" })

  const walletModule = req.scope.resolve(
    CASHFREE_WALLET_MODULE,
  ) as CashfreeWalletService
  const customerModule = req.scope.resolve(Modules.CUSTOMER) as any

  try {
    const request = await walletModule
      .retrieveManualKycRequest(id as string)
      .catch(() => null)
    if (!request) {
      return res.status(404).json({ message: "Manual KYC request not found" })
    }

    const customerId = (request as any).customer_id as string
    const [customer, panAttempts, aadhaarAttempts, banks, demats, deposits] =
      await Promise.all([
        customerModule.retrieveCustomer(customerId).catch(() => null),
        walletModule
          .listSecureIdVerifications({ customer_id: customerId, kind: "pan" })
          .catch(() => [] as any[]),
        walletModule
          .listSecureIdVerifications({ customer_id: customerId })
          .catch(() => [] as any[]),
        walletModule
          .listBankAccounts({ customer_id: customerId }, { take: 50 })
          .catch(() => [] as any[]),
        walletModule
          .listDematAccounts({ customer_id: customerId }, { take: 50 })
          .catch(() => [] as any[]),
        walletModule
          .listDepositProofs({ customer_id: customerId }, { take: 50 })
          .catch(() => [] as any[]),
      ])

    // ── Submitted PAN diagnostics — pick the latest non-success
    // attempt (the one the queue is most likely about); fall back to
    // the latest of any status if no failures/pendings exist.
    const sortedPan = [...(panAttempts as any[])].sort((a, b) =>
      String(b.created_at ?? "").localeCompare(String(a.created_at ?? "")),
    )
    const panForReview =
      sortedPan.find((r) => r.status === "pending") ??
      sortedPan.find((r) => r.status === "failed") ??
      sortedPan[0] ??
      null
    const panRaw = (panForReview?.response_raw ?? {}) as Record<string, unknown>
    const submittedPan = panForReview
      ? {
          attempted_at: panForReview.created_at,
          status: panForReview.status,
          pan_masked: panForReview.input_masked ?? null,
          submitted_name: (panRaw.submitted_name as string) ?? null,
          name_match_score:
            typeof panRaw.name_match_score === "number"
              ? (panRaw.name_match_score as number)
              : null,
          name_match_result: (panRaw.name_match_result as string) ?? null,
          mismatch_hint: (panRaw.mismatch_hint as string) ?? null,
          cached_match: (panRaw.cached_match as boolean) ?? null,
          reason: (panRaw.reason as string) ?? null,
          pan_record_id: (panRaw.pan_record_id as string) ?? null,
        }
      : null

    // ── Submitted Aadhaar diagnostics — combine the latest send + verify.
    const aadhaarKinds = (aadhaarAttempts as any[]).filter((r) =>
      String(r.kind ?? "").startsWith("aadhaar"),
    )
    const sortedAadhaar = [...aadhaarKinds].sort((a, b) =>
      String(b.created_at ?? "").localeCompare(String(a.created_at ?? "")),
    )
    const latestSend = sortedAadhaar.find((r) => r.kind === "aadhaar_otp_send") ?? null
    const latestVerify =
      sortedAadhaar.find((r) => r.kind === "aadhaar_otp_verify") ?? null
    const sendRaw = (latestSend?.response_raw ?? {}) as Record<string, unknown>
    const verifyRaw = (latestVerify?.response_raw ?? {}) as Record<string, unknown>
    const submittedAadhaar =
      latestSend || latestVerify
        ? {
            send_attempted_at: latestSend?.created_at ?? null,
            send_status: latestSend?.status ?? null,
            verify_attempted_at: latestVerify?.created_at ?? null,
            verify_status: latestVerify?.status ?? null,
            aadhaar_masked:
              latestSend?.input_masked ??
              latestVerify?.input_masked ??
              null,
            // otp-verify response_raw carries the holder name returned
            // by UIDAI when redaction allows. It's the most reliable
            // value to compare against the PAN-registered name.
            holder_name: (verifyRaw.name as string) ?? null,
            cross_doc_score:
              typeof verifyRaw.name_match_score === "number"
                ? (verifyRaw.name_match_score as number)
                : null,
            cross_doc_grade:
              (verifyRaw.name_match_grade as string) ?? null,
            pending_reason:
              (verifyRaw.pending_reason as string) ??
              (sendRaw.reason as string) ??
              null,
            cached_match:
              (sendRaw.cached_match as boolean) ?? null,
            aadhaar_record_id:
              (sendRaw.aadhaar_record_id as string) ??
              (verifyRaw.aadhaar_record_id as string) ??
              null,
          }
        : null

    // ── Registry hits — three-tier resolution per kind:
    //   1. customer.metadata.{pan_hash, aadhaar_hash}
    //      Set on clean auto-pass (≥0.80, no loose match) or after
    //      an admin manual approval. Most reliable when present.
    //   2. audit row's response_raw.pan_record_id /
    //      aadhaar_record_id — written by the cached-match path
    //      (every PAN attempt that found the global cache HIT).
    //   3. audit row's response_raw.pan_hash / Aadhaar otp-send
    //      response_raw._aadhaar_hash — written by the FRESH path
    //      (cache-miss attempt that called Cashfree and upserted
    //      the registry, but the customer's metadata link wasn't
    //      set because the score didn't clear the auto-pass bar).
    //      Without this tier, partial-match attempts from the fresh
    //      path showed "Not in registry" even though pan_record was
    //      upserted just upstream — closes the gap that left admins
    //      unable to see Cashfree-side data when reviewing.
    const meta = (customer?.metadata as Record<string, unknown>) ?? {}
    const panHashFromMeta =
      typeof meta.pan_hash === "string" ? (meta.pan_hash as string) : null
    const aadhaarHashFromMeta =
      typeof meta.aadhaar_hash === "string"
        ? (meta.aadhaar_hash as string)
        : null
    const panHashFromAudit =
      typeof panRaw.pan_hash === "string"
        ? (panRaw.pan_hash as string)
        : null
    const aadhaarHashFromAudit =
      typeof sendRaw._aadhaar_hash === "string"
        ? (sendRaw._aadhaar_hash as string)
        : null

    // Helper: cascade through every known signal to surface the
    // global registry row, including a masked-PAN fallback so audit
    // rows written before the `pan_hash`/`pan_record_id` plumbing
    // landed still resolve correctly. pan_record is keyed by SHA-256
    // hash but uniquely indexed by masked PAN (one masked form per
    // unique PAN), so listing with `pan_masked` returns the same row.
    const resolvePanRecord = async () => {
      if (panHashFromMeta) {
        const row = await walletModule
          .lookupPanRecordByHash(panHashFromMeta)
          .catch(() => null)
        if (row) return row
      }
      if (submittedPan?.pan_record_id) {
        const row = await walletModule
          .retrievePanRecord(submittedPan.pan_record_id as string)
          .catch(() => null)
        if (row) return row
      }
      if (panHashFromAudit) {
        const row = await walletModule
          .lookupPanRecordByHash(panHashFromAudit)
          .catch(() => null)
        if (row) return row
      }
      // 4th-tier fallback: masked-PAN match. Catches the back-catalog
      // of audit rows written before the hash/id plumbing landed —
      // pan_record was upserted by the same Cashfree call but the
      // audit row didn't capture a way back to it. Bounded query
      // (single row by masked value) so the perf hit is negligible.
      if (submittedPan?.pan_masked) {
        const rows = await walletModule
          .listPanRecords(
            { pan_masked: submittedPan.pan_masked as string } as any,
            { take: 1 } as any,
          )
          .catch(() => [] as any[])
        if (rows && rows.length > 0) return rows[0]
      }
      return null
    }

    const resolveAadhaarRecord = async () => {
      if (aadhaarHashFromMeta) {
        const row = await walletModule
          .lookupAadhaarRecordByHash(aadhaarHashFromMeta)
          .catch(() => null)
        if (row) return row
      }
      if (submittedAadhaar?.aadhaar_record_id) {
        const row = await walletModule
          .retrieveAadhaarRecord(
            submittedAadhaar.aadhaar_record_id as string,
          )
          .catch(() => null)
        if (row) return row
      }
      if (aadhaarHashFromAudit) {
        const row = await walletModule
          .lookupAadhaarRecordByHash(aadhaarHashFromAudit)
          .catch(() => null)
        if (row) return row
      }
      // 4th-tier fallback: masked-Aadhaar match, same rationale as
      // the PAN equivalent above. Closes the back-catalog gap.
      if (submittedAadhaar?.aadhaar_masked) {
        const rows = await walletModule
          .listAadhaarRecords(
            {
              aadhaar_masked: submittedAadhaar.aadhaar_masked as string,
            } as any,
            { take: 1 } as any,
          )
          .catch(() => [] as any[])
        if (rows && rows.length > 0) return rows[0]
      }
      return null
    }

    const panRecord = await resolvePanRecord()
    const aadhaarRecord = await resolveAadhaarRecord()

    // Compose customer-row fields (pan_hash / aadhaar_hash) using the
    // metadata value when present so existing consumers keep the
    // same shape — audit-row hashes are an internal fallback only.
    const panHash = panHashFromMeta
    const aadhaarHash = aadhaarHashFromMeta

    // ── Document file union — same shape as
    // GET /admin/customers/:id/files so the UI can reuse the Documents
    // tab's renderer if it wants.
    const files: FileEntry[] = []
    const metaFiles: Array<{ key: string; kind: string }> = [
      { key: "kyc_pan_file_url", kind: "PAN card" },
      { key: "kyc_aadhaar_card_file_url", kind: "Aadhaar card" },
      { key: "kyc_selfie_file_url", kind: "Selfie" },
      { key: "kyc_cmr_file_url", kind: "CMR copy (pre-multi-demat)" },
      { key: "pan_card_file_url", kind: "PAN card (legacy)" },
      { key: "aadhaar_card_file_url", kind: "Aadhaar card (legacy)" },
    ]
    for (const { key, kind } of metaFiles) {
      const url = meta[key]
      if (typeof url === "string" && url.trim()) {
        files.push({
          url,
          kind,
          source: { entity: "customer_metadata", id: customerId },
        })
      }
    }
    for (const b of banks as any[]) {
      if (b.bank_proof_file_url) {
        files.push({
          url: b.bank_proof_file_url,
          kind: `Bank proof (${b.bank_proof_type ?? "unknown"})`,
          source: { entity: "bank_account", id: b.id },
          label: `${b.bank_name ?? "Bank"} · …${b.account_number_last4 ?? "????"}`,
          created_at: b.created_at,
        })
      }
    }
    for (const d of demats as any[]) {
      if (d.cmr_file_url) {
        files.push({
          url: d.cmr_file_url,
          kind: "Demat CMR",
          source: { entity: "demat_account", id: d.id },
          label: `${d.depository ?? "Demat"} · ${d.dp_name ?? "?"}`,
          created_at: d.created_at,
        })
      }
    }
    for (const p of deposits as any[]) {
      if (p.proof_file_url) {
        files.push({
          url: p.proof_file_url,
          kind: `Deposit proof (${p.status})`,
          source: { entity: "deposit_proof", id: p.id },
          label: `₹${p.claimed_amount_inr?.toLocaleString?.("en-IN") ?? p.claimed_amount_inr}${p.utr ? ` · UTR ${p.utr}` : ""}`,
          created_at: p.created_at,
        })
      }
    }

    // Surface the customer's pending bank + demat rows so the
    // review panel can drive their per-row approve/reject buttons
    // alongside PAN/Aadhaar — admins shouldn't have to leave the
    // page to OK a CMR or bank that's part of the same KYC packet.
    // We include `pending` AND `name_mismatch` (the partial-match
    // band) since those are the two states that need review.
    const reviewable = (s: string) =>
      s === "pending" || s === "name_mismatch"
    const pendingDemats = (demats as any[])
      .filter((d) => reviewable(String(d.verification_status ?? "")))
      .map((d) => ({
        id: d.id,
        depository: d.depository,
        dp_name: d.dp_name,
        dp_id: d.dp_id,
        client_id: d.client_id,
        boid: d.boid,
        account_holder_name: d.account_holder_name,
        cmr_file_url: d.cmr_file_url,
        verification_status: d.verification_status,
        is_primary: d.is_primary,
        created_at: d.created_at,
      }))
    // For each reviewable bank, resolve the unmasked account number
    // from the global bank_record cache (keyed by bank_hash). The
    // customer-side bank_account row stores only the encrypted form +
    // last4, never plaintext, so a reveal-toggle in the admin panel
    // has to ride on bank_record. Missing bank_hash (bank not yet
    // penny-drop verified) → account_number_full stays null and the
    // admin reveal toggle is hidden.
    const reviewableBanks = (banks as any[]).filter((b) =>
      reviewable(String(b.verification_status ?? "")),
    )
    const bankFullByHash = new Map<string, string>()
    await Promise.all(
      reviewableBanks
        .filter((b) => typeof b.bank_hash === "string" && b.bank_hash.length > 0)
        .map(async (b) => {
          try {
            const rec = await walletModule.lookupBankRecordByHash(
              b.bank_hash as string,
            )
            const full = (rec as any)?.account_number_full
            if (typeof full === "string" && full.length > 0) {
              bankFullByHash.set(b.bank_hash as string, full)
            }
          } catch {
            /* non-fatal — reveal toggle just stays hidden for this row */
          }
        }),
    )
    const pendingBanks = reviewableBanks.map((b) => ({
      id: b.id,
      bank_name: b.bank_name,
      account_holder_name: b.account_holder_name,
      account_number_last4: b.account_number_last4,
      /** Unmasked account number, surfaced from `bank_record` (the
       *  Cashfree BAV cache). Null when bank_hash is unset or the
       *  registry row doesn't carry account_number_full (older
       *  pre-`account_number_full`-migration rows). Drives the eye-
       *  icon reveal toggle on the admin panel. */
      account_number_full:
        typeof b.bank_hash === "string"
          ? (bankFullByHash.get(b.bank_hash) ?? null)
          : null,
      ifsc: b.ifsc,
      name_at_bank: b.name_at_bank,
      name_match_score: b.name_match_score,
      bank_proof_file_url: b.bank_proof_file_url,
      bank_proof_type: b.bank_proof_type,
      verification_status: b.verification_status,
      is_primary: b.is_primary,
      created_at: b.created_at,
    }))

    // ── Pending KYC steps for this customer (current state, not
    // snapshot at request creation). Mirrors the list endpoint's
    // `pending_steps` so the review panel can show "why is this row
    // even here" at a glance — e.g. PAN ✓ done; Aadhaar ✓ done;
    // bank still pending verification. When this list is empty there
    // is genuinely nothing further the admin can act on through the
    // identity workflow, and "Mark resolved" is the right exit.
    const bankOk = (banks as any[]).some(
      (b) => b.verification_status === "verified" && b.is_primary,
    )
    const dematOk = (demats as any[]).some(
      (d) => d.verification_status === "verified" && d.is_primary,
    )
    const pendingSteps: Array<"PAN" | "Aadhaar" | "Bank" | "Demat / CMR"> = []
    if (!panHash) pendingSteps.push("PAN")
    if (!aadhaarHash) pendingSteps.push("Aadhaar")
    if (!bankOk) pendingSteps.push("Bank")
    if (!dematOk) pendingSteps.push("Demat / CMR")

    res.json({
      request: {
        id: (request as any).id,
        customer_id: customerId,
        status: (request as any).status,
        customer_note: (request as any).customer_note,
        reviewer_notes: (request as any).reviewer_notes,
        reviewer_user_id: (request as any).reviewer_user_id,
        reviewed_at: (request as any).reviewed_at,
        created_at: (request as any).created_at,
      },
      pending_steps: pendingSteps,
      customer: customer
        ? {
            id: customer.id,
            email: customer.email,
            first_name: customer.first_name,
            last_name: customer.last_name,
            phone: customer.phone,
            phone_verified: meta.phone_verified === true,
            email_verified: meta.email_verified === true,
            full_name_metadata:
              typeof meta.full_name === "string" ? meta.full_name : null,
            pan_registered_name:
              typeof meta.pan_registered_name === "string"
                ? meta.pan_registered_name
                : null,
            pan_hash: panHash,
            aadhaar_hash: aadhaarHash,
          }
        : null,
      submitted_pan: submittedPan,
      submitted_aadhaar: submittedAadhaar,
      pan_record: panRecord,
      aadhaar_record: aadhaarRecord,
      files,
      pending_demats: pendingDemats,
      pending_banks: pendingBanks,
    })
  } catch (err: any) {
    logger.error("admin manual-kyc-requests detail GET failed", {
      id,
      error: err?.message,
    })
    res.status(500).json({ message: err?.message ?? "load_failed" })
  }
}
