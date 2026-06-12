import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { z } from "zod"
import {
  CASHFREE_WALLET_MODULE,
  CashfreeWalletService,
} from "../../../modules/cashfree_wallet"
import {
  gradeNameMatch,
  redactSecureIdResponse,
} from "../../../modules/cashfree_wallet/cashfree/secure-id"
import {
  encryptString,
  last4,
} from "../../../modules/cashfree_wallet/cashfree/crypto"
import { createHash } from "node:crypto"
import {
  hitRateLimit,
  SECURE_ID_LIMITS,
} from "../../../modules/cashfree_wallet/rate-limit"
import { logger } from "../../../utils/logger"
import { CashfreeApiError } from "../../../modules/cashfree_wallet/cashfree/client"
import { grantPointsForEvent } from "../../../lib/grant-points"
import { sendEventEmail } from "../../../lib/send-event-email"

/**
 * Server-side gating thresholds for the bank-add verdict.
 *
 *   - `AUTO_PASS_SCORE` (0.85) → matches Cashfree `DIRECT_MATCH` /
 *     `GOOD_PARTIAL_MATCH`, where the bank's holder differs from the
 *     PAN-registered name only in initials / middle-name presence
 *     ("AYUSH KUMAR" vs "AYUSH K KUMAR"). Auto-verify.
 *   - `MANUAL_REVIEW_FLOOR` (0.60) → still has token overlap (Cashfree
 *     `MODERATE_PARTIAL_MATCH` / `POOR_PARTIAL_MATCH`). Don't auto-pass;
 *     mark `name_mismatch` so ops can eyeball the row.
 *   - Below 0.60 → reject as `failed`. Effectively `NO_MATCH` plus the
 *     long tail of single-token coincidences.
 *
 * The verdict combines TWO signals at the same threshold:
 *   1. Cashfree's own `name_match_score` (BAV v2 returns 0–100 / 0–1),
 *      which compares the *submitted* name (= the customer's PAN-
 *      verified name, since we resolve it server-side now) against the
 *      bank's `name_at_bank`.
 *   2. An additional server-side `gradeNameMatch(name_at_bank,
 *      pan_registered_name)` — belt-and-braces in case Cashfree's
 *      match algorithm drifts. Both must clear the threshold.
 */
const AUTO_PASS_SCORE = 0.85
const MANUAL_REVIEW_FLOOR = 0.6

/**
 * `account_holder_name` is intentionally NOT a request field. We resolve
 * it server-side from the customer's PAN-verified name (set during the
 * PAN KYC flow). Two reasons:
 *
 *   1. Anti-spoof. The previous design accepted holder name from the
 *      client, which a determined attacker (or a buggy client cache)
 *      could send as a third party's name and pass Cashfree's BAV — the
 *      bank match is "submitted_name vs name_at_bank", so if both are
 *      "RAMESH KUMAR" the verify succeeds even though the customer
 *      PAN-verified as "AYUSH KUMAR".
 *   2. Truthfulness. The storefront UI already auto-fills holder name
 *      from PAN; the API contract should match.
 */
const CreateSchema = z.object({
  account_number: z
    .string()
    .trim()
    .transform((s) => s.replace(/\s+/g, ""))
    .refine((s) => /^\d{6,20}$/.test(s), "account number must be 6-20 digits"),
  ifsc: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z]{4}0[A-Z0-9]{6}$/, "invalid IFSC"),
})

/**
 * GET /store/bank-accounts — list customer's bank accounts (never leaks
 * full account numbers — returns `account_number_last4` only).
 * POST /store/bank-accounts — add + penny-drop verify.
 */
export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const customerId = (req as any).auth_context?.app_metadata?.customer_id as
    | string
    | undefined
  if (!customerId) return res.status(401).json({ message: "Not authenticated" })

  const walletModule = req.scope.resolve(
    CASHFREE_WALLET_MODULE
  ) as CashfreeWalletService
  const rows = await walletModule.listBankAccounts({ customer_id: customerId })
  // Per-customer VBA model (changed 2026-05-04): every customer has at
  // most one active VBA, shared across all their verified banks. Map
  // it to all bank rows uniformly. Legacy per-bank VBAs (created
  // before the model change) still index by `bank_account_id` and
  // beat the customer-level VBA so old data renders correctly.
  const vbas = await walletModule.listCashfreeVirtualAccounts({
    customer_id: customerId,
    status: "active",
  })
  const vbaByBank = new Map<string, (typeof vbas)[number]>()
  let customerLevelVba: (typeof vbas)[number] | null = null
  for (const v of vbas) {
    if (v.bank_account_id) {
      vbaByBank.set(v.bank_account_id, v)
    } else if (!customerLevelVba) {
      customerLevelVba = v
    }
  }
  // Beneficiary-name override: the platform-level
  // `cashfree_setting.beneficiary_name` is the admin-editable source
  // of truth for what customers see as the beneficiary on their
  // transfer confirmations. Cashfree's PG-VBA API has no update path
  // for Account Holder Name, so we override at *display* time —
  // changing the admin field is immediate for the storefront, even
  // though the Cashfree dashboard view of pre-existing VBAs still
  // shows whatever name was set at create time. New VBAs minted
  // after the admin change will have the new name on Cashfree too.
  // Read the platform-level beneficiary name straight off the
  // singleton row. We previously went through getCashfreeProductView
  // — that worked but did extra env-aware decryption that's not
  // needed for a single text column and was returning null silently
  // in some configs. Direct list-call is simpler + observable.
  let platformBeneficiary: string | null = null
  try {
    const settingRows = await walletModule.listCashfreeSettings(
      { singleton_key: "default" } as any,
      { take: 1 },
    )
    const raw = (settingRows[0] as any)?.beneficiary_name
    if (typeof raw === "string" && raw.trim().length > 0) {
      platformBeneficiary = raw.trim()
    }
  } catch (err) {
    logger.warn("bank-accounts list: platform beneficiary lookup failed", {
      error: (err as Error).message,
    })
  }
  res.json({
    bank_accounts: rows.map((b) => {
      const vba = vbaByBank.get(b.id) ?? customerLevelVba ?? null
      return {
        id: b.id,
        account_holder_name: b.account_holder_name,
        account_number_last4: b.account_number_last4,
        ifsc: b.ifsc,
        bank_name: b.bank_name,
        verification_status: b.verification_status,
        name_match_score: b.name_match_score,
        is_primary: b.is_primary,
        verified_at: b.verified_at,
        created_at: b.created_at,
        bank_proof_file_url: b.bank_proof_file_url,
        bank_proof_type: b.bank_proof_type,
        virtual_account: vba
          ? {
              virtual_account_number: vba.virtual_account_number,
              ifsc: vba.ifsc,
              upi_id: vba.upi_id,
              // Display-time override: admin's
              // `cashfree_setting.beneficiary_name` wins over the
              // per-VBA stored value so a name change in
              // /app/cashfree is visible immediately on the
              // storefront, even for VBAs minted before the change.
              beneficiary_name: platformBeneficiary ?? vba.beneficiary_name,
              bank_code: vba.bank_code,
            }
          : null,
      }
    }),
  })
}

export const POST = async (req: MedusaRequest, res: MedusaResponse) => {
  const customerId = (req as any).auth_context?.app_metadata?.customer_id as
    | string
    | undefined
  if (!customerId) return res.status(401).json({ message: "Not authenticated" })

  const parsed = CreateSchema.safeParse(req.body)
  if (!parsed.success) {
    return res
      .status(400)
      .json({ message: "Invalid input", errors: parsed.error.flatten() })
  }
  const { account_number, ifsc } = parsed.data

  const walletModule = req.scope.resolve(
    CASHFREE_WALLET_MODULE
  ) as CashfreeWalletService

  // Resolve the customer's PAN-verified name BEFORE the rate-limit
  // check / Cashfree call. We use this as the `name` we send to BAV
  // (so the bank-side match is "PAN name vs name at bank") and again
  // as the second leg of our verdict cross-check.
  //
  // Resolution order:
  //   1. customer.metadata.pan_registered_name — written by
  //      /store/kyc/pan/verify on a successful match (the canonical
  //      pointer).
  //   2. pan_record.registered_name keyed by metadata.pan_hash — used
  //      as a fallback if the metadata pointer drifted but the hash
  //      survived (e.g. an old write that pre-dated the pointer field).
  //
  // Hard-fail with 412 if neither is available — bank verification
  // requires PAN KYC to have completed. Falling back to the customer's
  // self-typed first/last name (the previous behaviour) is exactly the
  // hole we're closing.
  const customerModule = req.scope.resolve("customer") as any
  const customer = await customerModule
    .retrieveCustomer(customerId)
    .catch(() => null)
  if (!customer) {
    return res.status(404).json({ message: "Customer not found" })
  }
  const customerMeta = (customer.metadata ?? {}) as Record<string, unknown>
  let panRegisteredName: string | null =
    typeof customerMeta.pan_registered_name === "string" &&
    customerMeta.pan_registered_name.trim().length > 0
      ? (customerMeta.pan_registered_name as string).trim()
      : null
  const panHashMeta =
    typeof customerMeta.pan_hash === "string" &&
    customerMeta.pan_hash.length > 0
      ? (customerMeta.pan_hash as string)
      : null
  if (!panRegisteredName && panHashMeta) {
    try {
      const [panRecord] = await walletModule.listPanRecords(
        { pan_hash: panHashMeta } as any,
        { take: 1 },
      )
      const fromRecord = (panRecord as any)?.registered_name
      if (typeof fromRecord === "string" && fromRecord.trim().length > 0) {
        panRegisteredName = fromRecord.trim()
      }
    } catch {
      // Non-fatal — we'll 412 below if we still don't have a name.
    }
  }
  if (!panRegisteredName) {
    return res.status(412).json({
      ok: false,
      code: "kyc.pan_required",
      message:
        "PAN verification is required before adding a bank account. Complete PAN KYC and try again.",
    })
  }
  const accountHolderName = panRegisteredName

  // Aadhaar must be verified — OR in partial-team-review — before a
  // bank can be added.
  // Reasons:
  //   1. Identity-stage closure before we let the customer attach
  //      financial accounts — bank-add itself is the trigger that
  //      mints a Cashfree VBA and locks it to a verified-bank list.
  //      We want both pan + aadhaar on file at that moment so the
  //      VBA `kyc_details` payload (Cashfree side) carries both.
  //      `provisionVirtualAccountForCustomer` calls
  //      `buildKycForCustomer` which reads pan from pan_record and
  //      aadhaar from customer.metadata.aadhaar_full_number — gating
  //      here guarantees the latter is present (full-verify path).
  //   2. SEBI / PMLA: the regulator's KYC bundle is identity (PAN +
  //      Aadhaar) THEN bank/demat. Doing them out of order mostly
  //      works in practice but isn't aligned with the standard flow.
  //
  // Partial-verification (2026-05-07): when the user's Aadhaar fell
  // into the GOOD-MATCH band (0.60–0.80 cross-doc score → admin
  // queue), we treat that as good enough to keep moving — the wizard
  // already locks the input + advances. Once admin approves,
  // metadata.aadhaar_hash gets written + Cashfree's VBA payload
  // catches up; until then the VBA is provisioned without an Aadhaar
  // on `kyc_details` (PAN-only) which Cashfree accepts.
  //
  // Three accept signals (any one is enough):
  //   1. `aadhaar_verified === true` + `aadhaar_hash` set — the
  //      storefront otp-verify success path writes both.
  //   2. `aadhaar_hash` set on its own — admin manual-override
  //      historically wrote the hash without flipping the verified
  //      flag; the flag is now also written (2026-05-08), but old
  //      approvals still rely on hash-only being acceptable.
  //   3. An open `manual_kyc_request` row — admin is still reviewing
  //      a partial match; we let the customer keep filling out the
  //      onboarding wizard in parallel.
  const hasAadhaarHash =
    typeof customerMeta.aadhaar_hash === "string" &&
    (customerMeta.aadhaar_hash as string).length > 0
  const aadhaarFullyVerified =
    customerMeta.aadhaar_verified === true && hasAadhaarHash
  let aadhaarPendingReview = false
  if (!aadhaarFullyVerified && !hasAadhaarHash) {
    try {
      const [pendingReq] = await walletModule.listManualKycRequests(
        { customer_id: customerId, status: "pending" } as any,
        { take: 1 },
      )
      aadhaarPendingReview = Boolean(pendingReq)
    } catch {
      // Non-fatal — fall through to the 412 below.
    }
  }
  if (!aadhaarFullyVerified && !hasAadhaarHash && !aadhaarPendingReview) {
    return res.status(412).json({
      ok: false,
      code: "kyc.aadhaar_required",
      message:
        "Aadhaar verification is required before adding a bank account. Complete Aadhaar KYC and try again.",
    })
  }

  // Admin-controlled per-kind switch. When bank verification is off we
  // refuse the add entirely (as opposed to accepting the row and marking
  // it pending) — this keeps the storefront's "add" action truthful: if
  // the customer can submit, the backend will attempt to verify.
  const gate = await walletModule.isSecureIdKindEnabled("bank")
  if (!gate.enabled) {
    return res.status(403).json({
      ok: false,
      reason: gate.reason,
      message:
        "Bank account verification is currently unavailable. Please request a manual review.",
    })
  }

  const rl = hitRateLimit(
    `bank_penny:${customerId}`,
    SECURE_ID_LIMITS.bank_penny.limit,
    SECURE_ID_LIMITS.bank_penny.windowMs
  )
  if (!rl.allowed) {
    return res
      .status(429)
      .json({ message: "Bank verification limit reached. Try again later." })
  }

  // Guard against duplicate linking — same (customer, last4, ifsc) combo
  const existing = await walletModule.listBankAccounts({
    customer_id: customerId,
    account_number_last4: last4(account_number),
    ifsc,
  })
  if (existing.length > 0) {
    return res.status(409).json({ message: "This bank account is already on file" })
  }

  // PMLA / AML pre-check — refuse if this (IFSC + last4) is ALREADY
  // verified against ANY other Polemarch customer. Tightened from
  // "≥2 other customers" to "≥1 other customer" 2026-05-08 per the
  // platform-wide uniqueness directive: one bank account = one
  // Polemarch account. Legitimate edge cases (spouse / parent) go
  // through ops via grievance@polemarch.in; the first account that
  // verified the bank owns it.
  //
  // We check BEFORE the penny-drop so we don't burn a Cashfree
  // verification call on an attempt we're going to reject anyway.
  const sharedCount = await walletModule.countVerifiedBankAccountsByFingerprint(
    { ifsc, account_number_last4: last4(account_number), exclude_customer_id: customerId }
  )
  if (sharedCount >= 1) {
    logger.warn("penny_drop_fraud_pre_check_shared_bank", {
      customer_id: customerId,
      ifsc,
      account_last4: last4(account_number),
      shared_count: sharedCount,
    })
    return res.status(409).json({
      ok: false,
      reason: "compliance_review",
      message:
        "This bank account is already linked to another Polemarch account. " +
        "If that's also you, sign in with the other account — or contact " +
        "grievance@polemarch.in if this looks wrong.",
    })
  }

  // ── Bank-registry cache lookup (`bank_record` table) ────────────
  //
  // Mirrors the PAN/Aadhaar flows: every bank Cashfree confirms gets
  // upserted into a global `bank_record` keyed by SHA-256(ifsc:acct).
  // Subsequent customers adding the same account skip the Cashfree call
  // entirely — we replay the cached registry row through the same
  // score-based verdict logic so the customer-bound `bank_account`
  // row's `verification_status` lands the same way it would have on a
  // fresh penny-drop. Saves a Cashfree credit per duplicate, removes
  // network-dependent flakiness for repeat banks, and keeps the
  // single-source-of-truth at the registry.
  //
  // Compute the hash early so we can probe before paying for an API
  // call. We re-use the same hash for the upsert below so the
  // bank_account.bank_hash stays aligned with the registry pointer.
  const bankHashPrecomputed = createHash("sha256")
    .update(`${ifsc}:${account_number}`)
    .digest("hex")
  const cachedBankRecord = await walletModule
    .lookupBankRecordByHash(bankHashPrecomputed)
    .catch(() => null)
  // Only treat the cache as authoritative when Cashfree had previously
  // confirmed the account is VALID. A row with `account_status` null /
  // unknown means we never got a clean verdict for it — fall through to
  // a live call so the customer isn't stuck with a stale failure.
  const cacheIsAuthoritative =
    !!cachedBankRecord &&
    typeof cachedBankRecord.account_status === "string" &&
    cachedBankRecord.account_status.toUpperCase() === "VALID"

  let pennyResult: any
  let cachedMatch = false
  if (cacheIsAuthoritative) {
    cachedMatch = true
    // Synthesize a `pennyResult` shape from the cached registry row so
    // the downstream score-based verdict, audit-row, and re-upsert all
    // work without branching. The `raw` field carries a marker so the
    // verification audit trail records that no live Cashfree call ran.
    pennyResult = {
      ok: true,
      status: cachedBankRecord!.account_status,
      status_code: cachedBankRecord!.account_status_code ?? undefined,
      name_at_bank: cachedBankRecord!.name_at_bank ?? undefined,
      name_match_score:
        typeof cachedBankRecord!.name_match_score === "number"
          ? cachedBankRecord!.name_match_score
          : undefined,
      name_match_result: cachedBankRecord!.name_match_result ?? undefined,
      bank_name: cachedBankRecord!.bank_name ?? undefined,
      branch: cachedBankRecord!.branch ?? undefined,
      city: cachedBankRecord!.city ?? undefined,
      micr: cachedBankRecord!.micr ?? undefined,
      utr: cachedBankRecord!.utr ?? undefined,
      ifsc_details: cachedBankRecord!.ifsc_details ?? undefined,
      reference_id: cachedBankRecord!.cashfree_ref_id ?? undefined,
      raw: {
        cached_match: true,
        bank_record_id: cachedBankRecord!.id,
        first_verified_at: cachedBankRecord!.first_verified_at,
        last_refreshed_at: cachedBankRecord!.last_refreshed_at,
        ...(cachedBankRecord!.response_raw ?? {}),
      },
    }
  } else {
    try {
      pennyResult = await (await walletModule.getSecureId()).pennyDropBank({
        account_number,
        ifsc,
        name: accountHolderName,
      })
    } catch (err) {
      const isApi = err instanceof CashfreeApiError
      logger.warn("penny drop failed", {
        customer_id: customerId,
        status: isApi ? err.status : undefined,
      })
      return res.status(isApi && err.status < 500 ? 400 : 502).json({
        ok: false,
        message: isApi
          ? `Bank verification rejected (${err.status})`
          : "Bank verification service unavailable",
      })
    }
  }

  // ── Score-based verdict ─────────────────────────────────────────
  //
  // Two name-match signals, both required to clear `AUTO_PASS_SCORE`
  // for the row to be `verified`:
  //
  //   A. Cashfree's BAV `name_match_score` (compares the name we sent
  //      — the customer's PAN-verified name — against the bank's
  //      `name_at_bank`). v2 returns 0–100 as a string; v1 returned
  //      0–1 as a number; secure-id.ts coerces both to a Number.
  //      Cashfree-side `0–100` numbers are normalised to the 0–1
  //      scale below so we can compare against our local thresholds.
  //   B. A server-side `gradeNameMatch(name_at_bank, pan_name)` —
  //      catches the case where Cashfree's matcher drifts (e.g. it
  //      passes a different transliteration of the PAN name as
  //      DIRECT_MATCH while a token-set comparison would not). Same
  //      thresholds.
  //
  // Verdict:
  //   - both ≥ 0.85 → "verified"
  //   - either in 0.60..0.85 (and neither below 0.60) → "name_mismatch"
  //   - any below 0.60, or Cashfree didn't return account_status=VALID
  //       → "failed"
  const cashfreeRawScore =
    typeof pennyResult.name_match_score === "number"
      ? pennyResult.name_match_score
      : null
  const cashfreeScoreNormalised =
    cashfreeRawScore == null
      ? null
      : cashfreeRawScore > 1
        ? cashfreeRawScore / 100
        : cashfreeRawScore
  // Match the bank's `name_at_bank` against EVERY identity name we
  // have on file: registration-typed name, PAN-registered name, and
  // (when on file) Aadhaar holder name. The best score wins. Reason:
  // a customer's bank often carries a different shorthand than their
  // PAN — e.g. PAN says "MANOJ MITHAJAL BHAT" while the bank has
  // "MANOJ M BHAT" or just "MANOJ BHAT". Cashfree only sees what we
  // sent (PAN-canonical), so its score is one signal; locally we
  // can be more generous by checking against any legitimate identity
  // name and picking the closest fit.
  const candidateNames: { source: string; name: string }[] = []
  const enteredName = [customer.first_name, customer.last_name]
    .filter((s) => typeof s === "string" && (s as string).trim().length > 0)
    .map((s) => (s as string).trim())
    .join(" ")
    .trim()
  if (enteredName) candidateNames.push({ source: "entered", name: enteredName })
  if (panRegisteredName)
    candidateNames.push({ source: "pan", name: panRegisteredName })
  // Aadhaar holder name — pulled from the global aadhaar_record
  // registry via metadata.aadhaar_hash. Only present for customers
  // whose Aadhaar verification (or admin-approved manual flow) wrote
  // the hash to metadata; otherwise we skip this candidate.
  const aadhaarHashMeta =
    typeof customerMeta.aadhaar_hash === "string" &&
    customerMeta.aadhaar_hash.length > 0
      ? (customerMeta.aadhaar_hash as string)
      : null
  if (aadhaarHashMeta) {
    try {
      const aadhaarRow = await walletModule.lookupAadhaarRecordByHash(
        aadhaarHashMeta,
      )
      const aadhaarName = (aadhaarRow as any)?.name
      if (typeof aadhaarName === "string" && aadhaarName.trim().length > 0) {
        candidateNames.push({ source: "aadhaar", name: aadhaarName.trim() })
      }
    } catch {
      // Non-fatal — fall through with whichever candidates we have.
    }
  }
  let bestLocalScore: number | null = null
  let bestLocalSource: string | null = null
  let bestLocalGrade: string | null = null
  if (pennyResult.name_at_bank) {
    for (const { source, name } of candidateNames) {
      const graded = gradeNameMatch(name, pennyResult.name_at_bank)
      if (bestLocalScore == null || graded.score > bestLocalScore) {
        bestLocalScore = graded.score
        bestLocalSource = source
        bestLocalGrade = graded.grade
      }
    }
  }
  const localCrossScore = bestLocalScore

  const decideVerificationStatus = ():
    | "verified"
    | "name_mismatch"
    | "failed" => {
    if (!pennyResult.ok) return "failed"
    // Treat NO_MATCH as outright failed regardless of score (Cashfree
    // returns score 0 in that case anyway, but be explicit).
    if (pennyResult.name_match_result === "NO_MATCH") return "failed"
    // Score-floor: if either signal is below the manual-review floor,
    // we can't auto-pass and we don't want to send to manual review
    // either (the names just don't match). Reject.
    if (
      (cashfreeScoreNormalised != null &&
        cashfreeScoreNormalised < MANUAL_REVIEW_FLOOR) ||
      (localCrossScore != null && localCrossScore < MANUAL_REVIEW_FLOOR)
    ) {
      return "failed"
    }
    // ── Cache-replay relaxation ────────────────────────────────────
    // When the verdict is being decided off a cached `bank_record`
    // (`cachedMatch === true`), Cashfree already returned VALID for
    // this account in a prior session and the cached row carries
    // `name_at_bank` but typically NULL `name_match_score` — so the
    // local cross-match becomes the SOLE signal. Honorifics like
    // "Mr." in `name_at_bank` (already stripped by the v2 normaliser)
    // and innocuous variations ("Manoj M" vs "Manoj Mithajal") drop
    // the local score below 0.85 even when both names belong to the
    // same person.
    //
    // Cashfree's server-side matcher previously cleared this same
    // pair as VALID; we trust that decision here and require only
    // MODERATE (≥0.6) overlap on the local re-match, not full
    // 0.85 AUTO_PASS_SCORE. Below MODERATE we still drop to
    // name_mismatch — true mismatches don't slip through.
    //
    // Safety: cross-customer reuse is already gated upstream by the
    // `sharedCount >= 1` check (line ~356) — at most ONE customer
    // can have this fingerprint at a time, so this relaxation can't
    // be exploited by a name-similar attacker against another
    // customer's bank.
    if (cachedMatch) {
      const localOk =
        localCrossScore == null || localCrossScore >= MANUAL_REVIEW_FLOOR
      if (localOk) return "verified"
      return "name_mismatch"
    }
    // Both signals must clear AUTO_PASS_SCORE for an auto-verify. If
    // we don't have one of the signals (e.g. Cashfree didn't echo
    // name_at_bank for some reason), fall back to whichever IS present.
    const cashfreePass =
      cashfreeScoreNormalised == null ||
      cashfreeScoreNormalised >= AUTO_PASS_SCORE
    const localPass =
      localCrossScore == null || localCrossScore >= AUTO_PASS_SCORE
    if (cashfreePass && localPass) return "verified"
    return "name_mismatch"
  }

  const verificationStatus = decideVerificationStatus()
  const verifiedAt = verificationStatus === "verified" ? new Date() : null

  // Bank-registry hash: SHA-256(<IFSC>:<account_number>). Mirrors PAN/
  // Aadhaar registry hashing semantics. Computed up-front above (line
  // ~390) so we can probe the cache before paying for the Cashfree
  // call; reuse here for the bank_account.bank_hash + the registry
  // upsert below so the pointer stays aligned.
  const bankHash = bankHashPrecomputed

  // Operator decision (2026-05-04): every newly-verified bank becomes
  // the primary, demoting any prior primary. Prior behaviour ("first
  // becomes primary, later ones don't") buried already-stale banks
  // when a customer adds a new one. The customer can still flip
  // primary back via the existing /store/bank-accounts/[id] PATCH.
  // We promote only when the new row clears full verification —
  // `name_mismatch` rows wait on ops review before they can be primary.
  const willBePrimary = verificationStatus === "verified"
  if (willBePrimary) {
    const previouslyPrimary = await walletModule.listBankAccounts({
      customer_id: customerId,
      is_primary: true,
    })
    for (const p of previouslyPrimary) {
      try {
        await walletModule.updateBankAccounts({
          selector: { id: p.id },
          data: { is_primary: false },
        })
      } catch (err) {
        logger.warn("failed to demote prior primary bank", {
          customer_id: customerId,
          prior_bank_account_id: p.id,
          error: (err as Error).message,
        })
      }
    }
  }

  const row = await walletModule.createBankAccounts({
    customer_id: customerId,
    account_holder_name: accountHolderName,
    account_number_encrypted: encryptString(account_number),
    account_number_last4: last4(account_number),
    ifsc,
    bank_name: pennyResult.bank_name ?? null,
    // Persist the Cashfree-side score normalised to 0–1 so admin views
    // and downstream consumers don't have to branch on v1 vs v2 wire
    // shape. Falls back to the raw value when the response wasn't
    // numeric (defensive).
    name_match_score:
      cashfreeScoreNormalised ?? pennyResult.name_match_score ?? null,
    verification_status: verificationStatus,
    cashfree_reference_id: pennyResult.reference_id ?? null,
    verification_raw: redactSecureIdResponse(pennyResult.raw),
    verified_at: verifiedAt,
    is_primary: willBePrimary,
    bank_hash: bankHash,
  })

  // Upsert the global bank_record. Best-effort — the customer-bound
  // bank_account row is the canonical pointer; a registry write
  // failure shouldn't block adding the bank.
  //
  // Write on `verified` AND `name_mismatch` (partial-match → manual
  // review). Skip `failed` — those are bogus / typo accounts. The
  // registry's `name_match_result` + `account_status` columns let
  // admin search distinguish "fully verified" from "manual-review
  // pending" so we don't conflate the two. Saving on partial gives
  // the manual-review reviewer the entire Cashfree response (every
  // typed field plus `response_raw`) without an extra round-trip.
  if (
    verificationStatus === "verified" ||
    verificationStatus === "name_mismatch"
  ) {
    try {
      await walletModule.upsertBankRecord({
        bank_hash: bankHash,
        account_number_masked: `XXXXXX${last4(account_number)}`,
        account_number_full: account_number,
        ifsc,
        account_status: pennyResult.status ?? null,
        account_status_code: pennyResult.status_code ?? null,
        name_at_bank: pennyResult.name_at_bank ?? null,
        name_match_result: pennyResult.name_match_result ?? null,
        name_match_score:
          typeof pennyResult.name_match_score === "number"
            ? pennyResult.name_match_score
            : null,
        bank_name: pennyResult.bank_name ?? null,
        branch: pennyResult.branch ?? null,
        city: pennyResult.city ?? null,
        micr:
          pennyResult.micr !== undefined ? String(pennyResult.micr) : null,
        // ifsc_details (BAV v2) embeds swift_code / nbin / category;
        // probe each so the columns stay searchable. The whole
        // payload also lives in `ifsc_details` JSON for completeness.
        swift_code:
          (pennyResult.ifsc_details as any)?.swift_code as
            | string
            | undefined ?? null,
        nbin:
          (pennyResult.ifsc_details as any)?.nbin as string | undefined ??
          null,
        category:
          (pennyResult.ifsc_details as any)?.category as string | undefined ??
          null,
        ifsc_details: pennyResult.ifsc_details ?? null,
        cashfree_ref_id: pennyResult.reference_id ?? null,
        utr: pennyResult.utr ?? null,
        response_raw: pennyResult.raw,
      })
    } catch (registryErr) {
      logger.warn("bank_record upsert failed (non-blocking)", {
        customer_id: customerId,
        bank_account_id: row.id,
        error: (registryErr as Error).message,
      })
    }
  }

  await walletModule.createSecureIdVerifications({
    customer_id: customerId,
    kind: "bank_penny",
    reference_id: pennyResult.reference_id ?? null,
    status: pennyResult.ok ? "success" : "failed",
    input_masked: `XXXXXX${last4(account_number)}@${ifsc}`,
    response_raw: redactSecureIdResponse(pennyResult.raw),
    expires_at: null,
    attempt_no: 1,
  })

  // Partial-match → admin queue. Mirror the PAN / Aadhaar partial-
  // match flows: when the bank's `name_at_bank` doesn't cleanly
  // match any of (entered, PAN, Aadhaar) names but does have
  // meaningful overlap (≥ MANUAL_REVIEW_FLOOR), we queue a
  // manual_kyc_request so ops can confirm the account is the
  // customer's. The bank_account row is already saved with
  // `verification_status = name_mismatch` — admin approves out-of-
  // band by flipping the row + this request.
  // Idempotent: if a pending request already exists for this
  // customer, we reuse it (the new bank attempt is just additional
  // context for the same review).
  if (verificationStatus === "name_mismatch") {
    const noteParts: string[] = [
      "[Auto-flagged] Bank-name match below auto-pass.",
      `Bank: ${pennyResult.bank_name ?? "?"} · ${ifsc} · ending ${last4(account_number)}.`,
      `Name at bank: "${pennyResult.name_at_bank ?? "?"}".`,
      `Best local match: ${
        bestLocalSource ?? "none"
      } score=${bestLocalScore != null ? bestLocalScore.toFixed(2) : "—"}${
        bestLocalGrade ? ` (${bestLocalGrade})` : ""
      }.`,
      cashfreeScoreNormalised != null
        ? `Cashfree score=${cashfreeScoreNormalised.toFixed(2)}.`
        : "",
      `Candidates checked: ${
        candidateNames.map((c) => `${c.source}="${c.name}"`).join(" | ") ||
        "none"
      }.`,
    ].filter(Boolean)
    const adminNote = noteParts.join(" ")
    try {
      const [existingReq] = await walletModule.listManualKycRequests(
        { customer_id: customerId, status: "pending" } as any,
        { take: 1 },
      )
      if (!existingReq) {
        await walletModule.createManualKycRequests({
          customer_id: customerId,
          customer_note: adminNote,
          status: "pending",
        })
      }
      await sendEventEmail(req.scope, "admin.new_manual_kyc_request", {
        customer_id: customerId,
        customer_note: adminNote,
        admin_review_url: `${process.env.MEDUSA_ADMIN_URL || ""}/app/manual-kyc`,
      })
    } catch (e) {
      logger.warn("auto-flag manual KYC request (bank) failed", {
        customer_id: customerId,
        bank_account_id: row.id,
        error: (e as Error).message,
      })
    }
  }

  // Auto-provision a Cashfree Auto Collect VBA locked to this bank.
  // Failure here is non-fatal — the bank record still saves, and the
  // user can retry later from /dashboard/bank-accounts. We surface the
  // VBA fields in the response when provisioning succeeds.
  let virtualAccount: {
    virtual_account_number: string
    ifsc: string
    upi_id: string | null
    bank_code: string | null
  } | null = null
  let vbaProvisionError: string | null = null

  if (row.verification_status === "verified") {
    try {
      // For the Cashfree-side Account Holder Name we use the same
      // PAN-verified name we just bank-verified against — keeps
      // identity coherent across PAN ↔ bank ↔ VBA. Falls through to
      // the customer's first/last name only if PAN-name resolution
      // somehow returned empty (shouldn't — we 412'd above on
      // missing PAN).
      const fullName =
        accountHolderName ||
        [customer?.first_name, customer?.last_name]
          .filter(Boolean)
          .join(" ")
          .trim() ||
        "Polemarch Investor"
      // Resolve the customer's stable client_id (`NNNNYYWW`) — the
      // 8-char Cashfree-friendly virtual_account_id used for THIS
      // customer's lifetime. By contract, PAN verify mints this row
      // (post-2026-05-09 architecture; see
      // subscribers/customer-client-id.ts header for rationale), and
      // the PAN-required 412 gate at the top of this handler ensures
      // PAN verify has succeeded before we reach here. So `clientIdRow`
      // is expected to exist; if it doesn't, identity state is
      // inconsistent — throw so the surrounding catch logs the warning
      // and sets vbaProvisionError. Bank record still saves; customer
      // can heal by re-verifying PAN (registry-reattach recreates the
      // customer_client_id row).
      const ci = req.scope.resolve("customer_identity") as any
      const clientIdRow = await ci.getByCustomerId(customerId)
      if (!clientIdRow?.client_id) {
        throw new Error(
          "customer_client_id missing despite PAN-required gate passing — identity state inconsistent; re-verify PAN to heal",
        )
      }
      const vba = await walletModule.provisionVirtualAccountForCustomer({
        customer_id: customerId,
        client_id: clientIdRow.client_id,
        customer_name: fullName,
        customer_email: customer?.email || `${customerId}@noreply.polemarch.in`,
        customer_phone: customer?.phone || "0000000000",
        // The PAN-required + Aadhaar-required gates above guarantee
        // both are on file by this point, so kyc_details (pan +
        // aadhaar) lands on Cashfree's create call.
        customer_metadata: customerMeta,
      })
      if (vba) {
        virtualAccount = {
          virtual_account_number: vba.virtual_account_number,
          ifsc: vba.ifsc,
          upi_id: vba.upi_id,
          bank_code: vba.bank_code,
        }
      }
      // Push the latest verified-bank list to Cashfree as the VBA's
      // `allowed_remitters` via PUT /pg/vba/{id}. On first verified
      // bank `provisionVirtualAccountForCustomer` already included the
      // newly-added bank at create time, making this a no-op replay
      // — fine, idempotent. On 2nd+ banks the provision call returns
      // the existing VBA without touching Cashfree, so this PUT is
      // what actually adds the new bank to Cashfree's allowed-remitters
      // list. Best-effort: a sync failure must not break the bank
      // add — webhook-time TPV still gates funds at deposit.
      try {
        await walletModule.syncVbaAllowedRemitters({
          customer_id: customerId,
          customer_metadata: customerMeta,
        })
      } catch (syncErr) {
        logger.warn("VBA allowed-remitters sync failed (non-blocking)", {
          customer_id: customerId,
          bank_account_id: row.id,
          error: (syncErr as Error).message,
        })
      }
    } catch (err) {
      logger.warn("VBA provisioning failed for new bank", {
        bank_account_id: row.id,
        error: (err as Error).message,
      })
      vbaProvisionError = (err as Error).message
    }
  }

  // Award gamification points on successful penny-drop verify. The
  // idempotency key is keyed on bank_account_id so a customer's first
  // verified bank earns the achievement, and additional banks (which
  // ARE rewarded too) get their own ledger row keyed on each id.
  let gamification:
    | Awaited<ReturnType<typeof grantPointsForEvent>>
    | null = null
  if (row.verification_status === "verified") {
    gamification = await grantPointsForEvent({
      scope: req.scope,
      customer_id: customerId,
      event_kind: "kyc.bank_verified",
      amount: 100,
      source: "KYC_STEP",
      reference_type: "bank_account",
      reference_id: row.id,
      idempotency_key: `KYC_STEP:bank:${row.id}`,
      note: "Bank account verified",
    })
  }

  // On non-success verdicts, surface a structured reason so the
  // storefront can render a useful message ("Add the bank in your own
  // name", "Awaiting manual review", etc.) instead of treating the
  // 201 as a silent success.
  const verdictDetail =
    verificationStatus === "verified"
      ? null
      : {
          status: verificationStatus,
          cashfree_score:
            cashfreeScoreNormalised != null
              ? Math.round(cashfreeScoreNormalised * 100) / 100
              : null,
          local_score:
            localCrossScore != null
              ? Math.round(localCrossScore * 100) / 100
              : null,
          name_at_bank: pennyResult.name_at_bank ?? null,
          name_match_result: pennyResult.name_match_result ?? null,
          message:
            verificationStatus === "name_mismatch"
              ? "The name on this bank account doesn't fully match your PAN. We've kept the entry for ops review — they'll reach out if anything's needed."
              : "The name on this bank account doesn't match your PAN. Please add a bank account in your own name (the same name as on your PAN).",
        }

  res.status(201).json({
    bank_account: {
      id: row.id,
      account_holder_name: row.account_holder_name,
      account_number_last4: row.account_number_last4,
      ifsc: row.ifsc,
      bank_name: row.bank_name,
      verification_status: row.verification_status,
      name_match_score: row.name_match_score,
      is_primary: row.is_primary,
    },
    virtual_account: virtualAccount,
    virtual_account_provision_error: vbaProvisionError,
    verdict: verdictDetail,
    gamification,
  })
}
