/**
 * Cashfree Secure ID — Verification API wrappers.
 *
 * Each function returns the raw response (typed loosely — Cashfree's payload
 * keys vary slightly across endpoints/versions) plus a normalised `ok`
 * boolean and `name_match` summary where applicable. Callers persist the raw
 * blob in `SecureIdVerification.response_raw` after PII redaction.
 */

import { randomUUID } from "node:crypto"
import { CashfreeClient, getVerificationClient } from "./client"

/**
 * PAN verify result — modelled after Cashfree's **PAN 360** (a.k.a.
 * `/verification/pan-advance`) endpoint. The Basic-tier
 * `/verification/pan` endpoint returns a strict subset; our parser
 * accepts both shapes so the merchant account's product tier dictates
 * what populates without a code change.
 *
 * Spec source: https://www.cashfree.com/docs/api-reference/vrs/v2/pan/pan-360
 *
 * All non-essential fields are `?` so a missing key reads as
 * `undefined` and renders as a "—" cell in admin views rather than a
 * crash. We snapshot every populated field onto `customer.metadata` so
 * the storefront can read them back without re-hitting Cashfree.
 */
export type PanVerifyResult = {
  ok: boolean
  status: string
  /** "Registered name" with the Income Tax Department. */
  name_on_pan?: string
  name_match?:
    | "EXACT_MATCH"
    | "GOOD_PARTIAL_MATCH"
    | "MODERATE_PARTIAL_MATCH"
    | "POOR_PARTIAL_MATCH"
    | "NO_MATCH"
    | string
  /** 0..1 token-overlap ratio between submitted name and PAN-registered
   *  name. Surfaced for debug + admin views; the route uses `name_match`
   *  for the actual gating decision. */
  name_match_score?: number

  // ── PAN 360 fields. All optional. ─────────────────────────────────
  /** PAN echoed back. */
  pan?: string
  /** Holder category — "Individual or Person" / "Company" / "HUF" / etc. */
  type?: string
  /** Cashfree-generated unique ID for this verification call. */
  reference_id?: string
  /** Echoed-back caller-supplied verification id. */
  verification_id?: string
  /** First name parsed by Cashfree from the registered name. */
  first_name?: string
  /** Last name parsed by Cashfree from the registered name. */
  last_name?: string
  /** Name as printed on the physical PAN card — can differ from
   *  `name_on_pan` (post-marriage rename, transliteration). */
  name_pan_card?: string
  /** Boolean PAN ↔ Aadhaar linkage flag (PAN 360). */
  aadhaar_linked?: boolean
  /** Last 4 digits of the linked Aadhaar (PAN 360, masked). */
  masked_aadhaar?: string
  /** Masked email (e.g. `a*c@gmail.com`). PAN 360 fill-rate ~45%. */
  email?: string
  /** Masked phone (e.g. `99XXXXXX99`). PAN 360 fill-rate ~45%. */
  phone?: string
  /** "Male" / "Female" / "Transgender" (PAN 360). */
  gender?: string
  /** DOB in `DD-MM-YYYY` format as Cashfree returns it. */
  dob?: string
  /** Full address object — full_address / street / city / state /
   *  pincode / country. PAN 360 fill-rate ~45%. */
  address?: {
    full_address?: string
    street?: string
    city?: string
    state?: string
    pincode?: number | string
    country?: string
  }

  // ── Additional fields that may be present in either PAN Basic
  //    or PAN 360 responses. PAN 360 is a superset — it returns
  //    everything Basic returns plus the demographics block above
  //    — so these aren't "Basic-only", just less-prominently
  //    documented in the PAN 360 sample payload. The parser reads
  //    them defensively from whichever response shape arrives. ──
  father_name?: string
  pan_status?: string
  aadhaar_seeding_status?: string
  aadhaar_seeding_status_desc?: string
  last_updated_at?: string
  raw: Record<string, unknown>
}

/**
 * Honorifics commonly carried by Indian bank-statement / Aadhaar /
 * passport `name_at_*` fields. These are NOT part of the legal name on
 * the PAN / Aadhaar token-match denominator and need to be stripped
 * before scoring, otherwise a legitimate match like "SOUBARNA KARMAKAR"
 * (PAN) vs "Mr. Soubarna Karmakar" (bank) scores 2/3 = 0.67 — below
 * AUTO_PASS_SCORE (0.85) — and gets misrouted to name_mismatch.
 *
 * Set covers: English (Mr/Mrs/Ms/Miss/Master/Dr/Prof), Hindi (Shri/
 * Shree/Sri/Smt/Sh/Srimati), and the business catch-all M/S (which
 * normalises to "M S" → both tokens dropped, "MS" same).
 *
 * Cashfree's own server-side matcher handles these; we mirror that
 * behaviour for the local cross-match step that runs after a cache
 * replay (no live Cashfree score available, so this match is the sole
 * deciding signal).
 */
const HONORIFIC_TOKENS = new Set([
  "MR",
  "MRS",
  "MS",
  "MISS",
  "MASTER",
  "DR",
  "PROF",
  "SHRI",
  "SHREE",
  "SRI",
  "SMT",
  "SH",
  "SRIMATI",
])

/**
 * Normalise a name for fuzzy comparison: uppercase, strip everything
 * that isn't a letter or whitespace, drop honorifics, collapse
 * whitespace, return a token array.
 *
 * Single-letter tokens (initials) are KEPT here so the matching
 * functions below can run their initial-to-full expansion pass against
 * them. Pre-2026-05-08 this filter dropped initials before expansion
 * could see them, making the expansion code dead and forcing
 * legitimate "Manoj M Bhat" vs "Manoj Mithajal Bhat" cases to score
 * 0.67 → manual review. Initials are now neutralised at the matching
 * layer instead, with an anti-bare-initials guard so "M K" still
 * cannot falsely match "MANOJ KUMAR".
 */
function normaliseNameTokens(s: string): string[] {
  return s
    .toUpperCase()
    .replace(/[^A-Z\s]/g, " ")
    .split(/\s+/)
    .filter(Boolean)
    .filter((t) => !HONORIFIC_TOKENS.has(t))
}

/**
 * Compare two names and return a Cashfree-style grade + token-overlap
 * score in [0, 1].
 *
 * Why this exists
 * ---------------
 * Cashfree's basic PAN verify endpoint doesn't return a
 * `name_match_result` field — it returns `registered_name` and we
 * make the comparison ourselves. The grades mirror Cashfree's premium
 * endpoint vocabulary so route-level logic can read either source
 * without branching.
 *
 * Score
 * -----
 * `score = shared_tokens / max(setA, setB)` — token-set Jaccard with a
 * stricter denominator (max instead of union). 1.0 means full agreement
 * on every token in either name.
 *
 * Grade thresholds (revised 2026-05-05)
 * --------------------------------------
 * Earlier this function graded by SUBSET RELATIONSHIP — if the
 * submitted name's tokens were a subset of the registered name's, it
 * returned `GOOD_PARTIAL_MATCH` regardless of how few tokens matched.
 * Concretely, "JOHN" vs "JOHN SMITH KUMAR" (1 shared, score 0.33) was
 * a GOOD_PARTIAL_MATCH because `setA ⊆ setB`. That let weak matches
 * through — KYC routes that gate on grade=`EXACT_MATCH || GOOD_PARTIAL_MATCH`
 * effectively auto-passed any single-token-of-many overlap.
 *
 * The grade is now driven directly by score:
 *
 *   score ≥ 0.95              → EXACT_MATCH
 *   0.85 ≤ score < 0.95       → GOOD_PARTIAL_MATCH
 *   0.60 ≤ score < 0.85       → MODERATE_PARTIAL_MATCH
 *   0.30 ≤ score < 0.60       → POOR_PARTIAL_MATCH
 *   score < 0.30              → NO_MATCH
 *
 * Examples (assuming token-set after normalisation):
 *   "AYUSH KUMAR" vs "AYUSH KUMAR"            → 1.00 EXACT_MATCH
 *   "AYUSH KUMAR" vs "AYUSH K KUMAR"          → 0.67 MODERATE (initials are dropped)
 *   "AYUSH" vs "AYUSH KUMAR PATEL"            → 0.33 POOR (1/3) — was GOOD before, hole closed
 *   "JOHN" vs "JOHN SMITH KUMAR PATEL"        → 0.25 NO_MATCH (1/4)
 *
 * Callers that previously gated on `=== "EXACT_MATCH" || === "GOOD_PARTIAL_MATCH"`
 * should re-think; the score band 0.60–0.85 (MODERATE) is now exposed
 * separately so verdict logic can route those to manual review rather
 * than auto-pass.
 */
export function gradeNameMatch(
  submitted: string,
  registered: string,
): {
  grade: PanVerifyResult["name_match"]
  score: number
  /** Diagnostic flags about the comparison — used by callers (e.g. PAN
   *  verify route) to surface "looks like initials" hints to the user
   *  WITHOUT echoing the registered name. Privacy-preserving. */
  diagnostics: {
    /** Submitted has at least one single-letter token. */
    submitted_has_initials: boolean
    /** Submitted has fewer tokens than registered (after dedupe). */
    submitted_shorter: boolean
    /** At least one initial-to-full match was used to compute the
     *  score. If this is true and grade still didn't pass, the user
     *  is likely using initials but the surname / extra token is
     *  missing on their side. */
    initial_match_used: boolean
  }
} {
  const a = normaliseNameTokens(submitted)
  const b = normaliseNameTokens(registered)
  if (a.length === 0 || b.length === 0) {
    return {
      grade: "NO_MATCH",
      score: 0,
      diagnostics: {
        submitted_has_initials: false,
        submitted_shorter: false,
        initial_match_used: false,
      },
    }
  }
  const setA = new Set(a)
  const setB = new Set(b)

  // First pass — exact MULTI-LETTER token matches only. Initials
  // (length === 1) are reserved for the second pass and never count
  // as standalone matches. This is the **anti-bare-initials guard**:
  // it prevents inputs like "M K" from falsely matching "MANOJ
  // KUMAR" 1.0 — without this guard, an attacker could brute-force
  // the 26² space of initial pairs against any name with the right
  // first letters.
  const remainingB = new Set(setB)
  const remainingA: string[] = []
  let multiLetterShared = 0
  for (const t of setA) {
    const taIsInitial = t.length === 1
    if (!taIsInitial && remainingB.has(t)) {
      multiLetterShared++
      remainingB.delete(t)
    } else {
      remainingA.push(t)
    }
  }
  let shared = multiLetterShared

  // Second pass — initial-to-full expansion. A single-letter token
  // matches a multi-letter token (in the OTHER set) when both share
  // the first letter. Common case: PAN cards write the holder's
  // middle name in full ("MITHAJAL"), but customers type it as an
  // initial ("M") because that's how their everyday name reads.
  // Without this, "Manoj M Bhat" vs "Manoj Mithajal Bhat" scores 2/3
  // = 0.67 → rejected, even though the human reads them as the same
  // person.
  //
  // **Anti-bare-initials guard**: the second pass only contributes
  // when at least one multi-letter exact match landed in pass 1.
  // "M K" alone (no full-name token to anchor) cannot trigger any
  // expansions and falls through to score 0. An attacker still
  // needs to know at least one full token (first or last name) AND
  // the right initial(s) — same security floor as before, but now
  // the legitimate "M Bhat" → "Manoj Mithajal Bhat" case scores 1.0.
  //
  // Awarded as a full match (1.0 weight) — there's no privacy hole
  // here because the user has to know the FULL middle initial AND
  // the full first + last name to construct a passing input.
  let initialMatchUsed = false
  if (multiLetterShared >= 1) {
    for (const ta of [...remainingA]) {
      for (const tb of remainingB) {
        const taIsInitial = ta.length === 1
        const tbIsInitial = tb.length === 1
        const initialMatch =
          (taIsInitial && !tbIsInitial && tb[0] === ta) ||
          (tbIsInitial && !taIsInitial && ta[0] === tb)
        if (initialMatch) {
          shared++
          initialMatchUsed = true
          remainingB.delete(tb)
          // Drop from remainingA too so each submitted token can only
          // match once. Use index-based splice via filtering.
          const idx = remainingA.indexOf(ta)
          if (idx !== -1) remainingA.splice(idx, 1)
          break
        }
      }
    }
  }

  const denom = Math.max(setA.size, setB.size)
  const score = denom === 0 ? 0 : shared / denom

  // Round to 2 decimal places so callers persisting the score don't
  // get noisy values like 0.6666666... in the audit row. Keeps grade
  // boundaries deterministic at the threshold.
  const rounded = Math.round(score * 100) / 100

  let grade: PanVerifyResult["name_match"]
  if (rounded >= 0.95) grade = "EXACT_MATCH"
  else if (rounded >= 0.85) grade = "GOOD_PARTIAL_MATCH"
  else if (rounded >= 0.6) grade = "MODERATE_PARTIAL_MATCH"
  else if (rounded >= 0.3) grade = "POOR_PARTIAL_MATCH"
  else grade = "NO_MATCH"

  const submittedHasInitials = a.some((t) => t.length === 1)
  const submittedShorter = setA.size < setB.size

  return {
    grade,
    score: rounded,
    diagnostics: {
      submitted_has_initials: submittedHasInitials,
      submitted_shorter: submittedShorter,
      initial_match_used: initialMatchUsed,
    },
  }
}

/**
 * Cross-document name match — used when comparing names sourced from
 * TWO regulators (e.g. UIDAI's Aadhaar holder name vs ITD's
 * PAN-registered name). Both names are authoritative, but they're
 * commonly asymmetric:
 *
 *   PAN     "MANOJ MITHAJAL BHAT"   ← Income Tax Department, formal
 *   Aadhaar "MANOJ M"               ← UIDAI, often abbreviated
 *
 * The default `gradeNameMatch` uses `max(setA, setB)` as the
 * denominator, which penalises this asymmetry: with initial-matching
 * the "M" in Aadhaar resolves to PAN's "MITHAJAL" but the surname
 * "BHAT" is missing on the Aadhaar side, dragging the score to
 * 2/3 = 0.67 (below the 0.80 auto-pass bar).
 *
 * This variant uses `min(setA, setB)` as the denominator WHEN both
 * sides have at least 2 tokens — meaning a clean abbreviated subset
 * (every Aadhaar token, including initials, accounted for in the
 * PAN name) scores 1.0. The ≥2-token floor blocks single-token
 * subset matches like "AYUSH" ⊆ "AYUSH KUMAR PATEL" from passing
 * (those fall back to the strict max-denominator score, 1/3 = 0.33).
 *
 * Use this ONLY for cross-document checks where one side is known
 * to be authoritative on identity (UIDAI / ITD / depository
 * registry) — never for user-typed input → registered name (where
 * we want strict scoring to keep weak typed matches out).
 */
export function gradeNameMatchCrossDoc(
  a: string,
  b: string,
): {
  grade: PanVerifyResult["name_match"]
  score: number
  /** Diagnostic flags so callers can route "passed only because of
   *  loose matching" cases through admin review instead of an
   *  outright auto-pass. Both flags can be true simultaneously. */
  diagnostics: {
    /** True if any single-letter token in one set was matched to a
     *  multi-letter token in the other (initial-to-full expansion). */
    initial_match_used: boolean
    /** True if min(setA, setB) was used as the denominator AND the
     *  score with the strict max-denominator would have been below
     *  the GOOD_PARTIAL_MATCH threshold (0.85). I.e. the loose
     *  scoring path actually did the work — wasn't redundant. */
    loose_denom_used: boolean
  }
} {
  const tokensA = normaliseNameTokens(a)
  const tokensB = normaliseNameTokens(b)
  if (tokensA.length === 0 || tokensB.length === 0) {
    return {
      grade: "NO_MATCH",
      score: 0,
      diagnostics: { initial_match_used: false, loose_denom_used: false },
    }
  }
  const setA = new Set(tokensA)
  const setB = new Set(tokensB)

  // Re-use the strict gradeNameMatch's two-pass machinery for
  // counting shared tokens (exact + initial-to-full). We can't just
  // call gradeNameMatch and adjust the denominator afterwards because
  // it returns score = shared/max already; we need shared itself.
  // Inline the loops here, with the same anti-bare-initials guard
  // as gradeNameMatch — initials never match standalone, only via
  // expansion against a multi-letter token, AND only after at least
  // one multi-letter exact match has anchored the comparison.
  const remainingB = new Set(setB)
  const remainingA: string[] = []
  let multiLetterShared = 0
  for (const t of setA) {
    const taIsInitial = t.length === 1
    if (!taIsInitial && remainingB.has(t)) {
      multiLetterShared++
      remainingB.delete(t)
    } else {
      remainingA.push(t)
    }
  }
  let shared = multiLetterShared
  let initialMatchUsed = false
  if (multiLetterShared >= 1) {
    for (const ta of [...remainingA]) {
      for (const tb of remainingB) {
        const taIsInitial = ta.length === 1
        const tbIsInitial = tb.length === 1
        const initialMatch =
          (taIsInitial && !tbIsInitial && tb[0] === ta) ||
          (tbIsInitial && !taIsInitial && ta[0] === tb)
        if (initialMatch) {
          shared++
          initialMatchUsed = true
          remainingB.delete(tb)
          const idx = remainingA.indexOf(ta)
          if (idx !== -1) remainingA.splice(idx, 1)
          break
        }
      }
    }
  }

  const minSize = Math.min(setA.size, setB.size)
  const maxSize = Math.max(setA.size, setB.size)
  // Use min when both sides have ≥2 tokens (legitimate abbreviation
  // window). Otherwise fall back to max — protects against
  // single-token false positives like "JOHN" matching "JOHN ANYTHING".
  const denom = minSize >= 2 ? minSize : maxSize
  const score = denom === 0 ? 0 : shared / denom
  const rounded = Math.round(score * 100) / 100

  // Did the min-denominator actually do the work? Only flag the
  // loose path as "used" when the strict (max-denom) score would
  // have been below 0.85 (the threshold the loose path is designed
  // to rescue) — otherwise we'd false-positive on cases that pass
  // strictly anyway.
  const strictScore = maxSize === 0 ? 0 : shared / maxSize
  const looseDenomUsed = denom !== maxSize && strictScore < 0.85

  let grade: PanVerifyResult["name_match"]
  if (rounded >= 0.95) grade = "EXACT_MATCH"
  else if (rounded >= 0.85) grade = "GOOD_PARTIAL_MATCH"
  else if (rounded >= 0.6) grade = "MODERATE_PARTIAL_MATCH"
  else if (rounded >= 0.3) grade = "POOR_PARTIAL_MATCH"
  else grade = "NO_MATCH"

  return {
    grade,
    score: rounded,
    diagnostics: {
      initial_match_used: initialMatchUsed,
      loose_denom_used: looseDenomUsed,
    },
  }
}

/**
 * Mint a verification_id Cashfree's PAN 360 endpoint requires. Format
 * constraint per docs: max 50 chars; alphanumeric, `.`, `-`, `_` only.
 *
 * We use `pan_<unix-ms>_<crypto-randomUUID-hex>` — 49 chars, full 122
 * bits of randomness from `crypto.randomUUID()`. Cashfree returns 409
 * "invalid_verification_id" when an id collides with a previously-seen
 * one, and the gateway appears to register ids even on routes that
 * return 404 — so a low-entropy `Math.random().slice(2,8)` (only 24
 * bits) was producing collisions after enough retries. UUID-grade
 * entropy makes that vanishingly unlikely.
 */
function mintPanVerificationId(): string {
  const ts = Date.now().toString(36)
  const rand = randomUUID().replace(/-/g, "")
  return `pan_${ts}_${rand}`
}

export async function verifyPan(
  client: CashfreeClient,
  args: { pan: string; name: string; verificationId?: string }
): Promise<PanVerifyResult> {
  const res = await client.request<Record<string, unknown>>({
    method: "POST",
    // PAN 360 / Advance endpoint. Returns the rich field set
    // documented at /docs/api-reference/vrs/v2/pan/pan-360 — first /
    // last name split, gender, DOB, masked Aadhaar, masked contact,
    // address object, aadhaar_linked boolean. Falls through cleanly
    // to a Basic-tier merchant account too: any missing field reads
    // as `undefined` in the parser below.
    //
    // NOTE: Cashfree retired the slug-style `/verification/pan-advance`
    // path in 2024 (returns "404 Route Not Found" today). The current
    // v2 path is the nested-resource form `/verification/pan/advance`.
    path: "/verification/pan/advance",
    body: {
      pan: args.pan.toUpperCase().trim(),
      name: args.name.trim(),
      // PAN 360 makes verification_id REQUIRED. Caller can override
      // (e.g. for retries that should hit the same Cashfree audit
      // record) but we mint a fresh one by default — duplicates
      // return 409, and we never want that to surface as a verify
      // failure from a stale id.
      verification_id: args.verificationId || mintPanVerificationId(),
    },
  })
  const data = (res.data ?? {}) as Record<string, unknown>

  // Cashfree's basic PAN-verify response in production looks like:
  //   { message: "PAN verified successfully", reference_id: 167032316,
  //     registered_name: "MANOJ MITHAJAL BHAT" }
  //
  // It does NOT include `status` or `name_match_result` — those keys
  // belong to the premium "PAN advance" endpoint. So we infer:
  //   - validity from the presence of `registered_name` (always set on
  //     a successful 200) plus a positive-sounding message.
  //   - name match by computing it ourselves against the submitted name.
  //
  // We still derive a string `status` for callers that surface it
  // (matches the prior contract "VALID" / "INVALID" / etc.).
  const explicitStatus = String((data as any).status ?? "").toUpperCase()
  const message = String((data as any).message ?? "")
  const registeredName = (data as any).registered_name as string | undefined
  const valid = (() => {
    if (explicitStatus === "VALID" || explicitStatus === "SUCCESS") return true
    if (explicitStatus === "INVALID" || explicitStatus === "FAILURE") return false
    if (typeof registeredName === "string" && registeredName.trim().length > 0) {
      return true
    }
    return /verified successfully|valid pan/i.test(message)
  })()

  // Cashfree-supplied name_match_result wins when present (premium
  // endpoint); otherwise we compute it client-side.
  const cashfreeNameMatch = (data as any).name_match_result as string | undefined
  let name_match: PanVerifyResult["name_match"] = cashfreeNameMatch || undefined
  let name_match_score: number | undefined
  if (!name_match && valid && registeredName) {
    const graded = gradeNameMatch(args.name, registeredName)
    name_match = graded.grade
    name_match_score = graded.score
  }

  // Pull every documented field defensively. `undefined` survives
  // through serialisation and renders as a blank cell in admin
  // views — better than fabricating empty strings everywhere.
  const numOrUndef = (v: unknown): number | undefined => {
    if (typeof v === "number" && Number.isFinite(v)) return v
    if (typeof v === "string") {
      const n = Number(v)
      return Number.isFinite(n) ? n : undefined
    }
    return undefined
  }
  const strOrUndef = (v: unknown): string | undefined => {
    if (typeof v === "string" && v.trim().length > 0) return v.trim()
    if (typeof v === "number") return String(v)
    return undefined
  }

  // Address — PAN 360 returns a structured object. Normalise to our
  // typed shape; coerce pincode to number when it arrives as string.
  const addr = (data as any).address
  let parsedAddress: PanVerifyResult["address"]
  if (addr && typeof addr === "object" && !Array.isArray(addr)) {
    parsedAddress = {
      full_address: strOrUndef(addr.full_address),
      street: strOrUndef(addr.street),
      city: strOrUndef(addr.city),
      state: strOrUndef(addr.state),
      pincode:
        typeof addr.pincode === "number"
          ? addr.pincode
          : strOrUndef(addr.pincode),
      country: strOrUndef(addr.country),
    }
    // Strip undefineds so the cached metadata doesn't carry empty keys.
    parsedAddress = Object.fromEntries(
      Object.entries(parsedAddress).filter(([, v]) => v !== undefined),
    ) as PanVerifyResult["address"]
    if (Object.keys(parsedAddress ?? {}).length === 0)
      parsedAddress = undefined
  }

  // `aadhaar_linked` boolean — PAN 360 uses this; PAN Basic uses
  // `aadhaar_seeding_status: "Y"|"R"|"NA"`. Coerce both.
  const linkedRaw = (data as any).aadhaar_linked
  const seedingRaw = strOrUndef((data as any).aadhaar_seeding_status)
  const aadhaar_linked: boolean | undefined =
    typeof linkedRaw === "boolean"
      ? linkedRaw
      : seedingRaw === "Y"
        ? true
        : seedingRaw === "R" || seedingRaw === "NA"
          ? false
          : undefined

  return {
    ok: valid,
    status: explicitStatus || (valid ? "VALID" : "INVALID"),
    name_on_pan: registeredName,
    name_match,
    // Prefer Cashfree's own score when present; fall back to the
    // locally-computed value (set above when we graded the match
    // ourselves). Cashfree sometimes returns it as string, sometimes
    // number — `numOrUndef` handles both.
    name_match_score:
      numOrUndef((data as any).name_match_score) ?? name_match_score,

    // PAN 360 / Advance fields. Each silently `undefined` on Basic.
    pan: strOrUndef((data as any).pan),
    type: strOrUndef((data as any).type),
    reference_id: strOrUndef((data as any).reference_id),
    verification_id: strOrUndef((data as any).verification_id),
    first_name: strOrUndef((data as any).first_name),
    last_name: strOrUndef((data as any).last_name),
    name_pan_card: strOrUndef((data as any).name_pan_card),
    aadhaar_linked,
    masked_aadhaar: strOrUndef(
      (data as any).masked_aadhaar_number ??
        (data as any).masked_aadhaar ??
        (data as any).aadhaar_no,
    ),
    email: strOrUndef((data as any).email),
    phone: strOrUndef(
      (data as any).mobile_number ?? (data as any).phone,
    ),
    gender: strOrUndef((data as any).gender),
    dob: strOrUndef((data as any).date_of_birth ?? (data as any).dob),
    address: parsedAddress,

    // PAN Basic-only fields (kept for backwards compat).
    father_name: strOrUndef((data as any).father_name),
    pan_status: strOrUndef((data as any).pan_status),
    aadhaar_seeding_status: seedingRaw,
    aadhaar_seeding_status_desc: strOrUndef(
      (data as any).aadhaar_seeding_status_desc,
    ),
    last_updated_at: strOrUndef((data as any).last_updated_at),
    raw: data,
  }
}

export type AadhaarOtpSendResult = {
  ok: boolean
  ref_id: string | null
  message?: string
  raw: Record<string, unknown>
}

export async function sendAadhaarOtp(
  client: CashfreeClient,
  args: { aadhaar: string }
): Promise<AadhaarOtpSendResult> {
  const res = await client.request<Record<string, unknown>>({
    method: "POST",
    path: "/verification/offline-aadhaar/otp",
    body: { aadhaar_number: args.aadhaar.replace(/\s+/g, "") },
  })
  const data = res.data ?? {}
  const refId = (data as any).ref_id ?? (data as any).refId ?? null
  return {
    ok: !!refId,
    ref_id: refId ? String(refId) : null,
    message: (data as any).message as string | undefined,
    raw: data,
  }
}

export type AadhaarOtpVerifyResult = {
  ok: boolean
  status: string
  name?: string
  dob?: string
  gender?: string
  /** Cashfree returns last 4 digits only — never store full Aadhaar. */
  masked_aadhaar?: string
  address_raw?: unknown
  raw: Record<string, unknown>
}

export async function verifyAadhaarOtp(
  client: CashfreeClient,
  args: { ref_id: string; otp: string }
): Promise<AadhaarOtpVerifyResult> {
  const res = await client.request<Record<string, unknown>>({
    method: "POST",
    path: "/verification/offline-aadhaar/verify",
    body: { otp: args.otp, ref_id: args.ref_id },
  })
  const data = res.data ?? {}
  const status = String((data as any).status ?? "").toUpperCase()
  return {
    ok: status === "VALID" || status === "SUCCESS",
    status,
    name: (data as any).name as string | undefined,
    dob: (data as any).dob as string | undefined,
    gender: (data as any).gender as string | undefined,
    masked_aadhaar: ((data as any).aadhaar_number_masked ||
      (data as any).aadhaar_no) as string | undefined,
    address_raw: (data as any).address,
    raw: data,
  }
}

export type BankPennyDropResult = {
  ok: boolean
  status: string
  /** Cashfree's specific status code for the v2 response. Older v1
   *  responses don't return this — surface as undefined. */
  status_code?: string
  name_at_bank?: string
  name_match_score?: number
  name_match_result?: string
  bank_name?: string
  /** v2 extras populated when Cashfree returns them. */
  branch?: string
  city?: string
  micr?: number | string
  utr?: string
  /** v2 IFSC details object. Cashfree's v2 response embeds the same
   *  payload Razorpay's IFSC API returns plus a few extras
   *  (swift_code, nbin, ifsc_subcode). Persisted whole so the bank
   *  registry doesn't lose anything. */
  ifsc_details?: Record<string, unknown>
  reference_id?: string
  raw: Record<string, unknown>
}

/**
 * Bank Account Verification — Cashfree BAV v2 sync.
 *
 *   POST /verification/bank-account/sync   (x-api-version: 2024-01-01)
 *
 * v2 returns a strictly richer payload than v1 — same path, the
 * version header is what dispatches the v2 handler:
 *   - account_status_code (e.g. ACCOUNT_IS_VALID, NRE_ACCOUNT_FAIL)
 *   - name_match_result with a finer-grained DIRECT_MATCH /
 *     GOOD_PARTIAL_MATCH / MODERATE_PARTIAL_MATCH / POOR_PARTIAL_MATCH
 *     / NO_MATCH
 *   - ifsc_details (bank, branch, address, city, state, swift_code,
 *     micr, nbin, ifsc_subcode, category) — saves us a separate
 *     IFSC lookup once verification succeeds
 *   - branch / city / micr at the top level
 *   - utr (bank-side reference for the test debit)
 *
 * The v1 export name `pennyDropBank` is kept for backwards-compat;
 * "penny drop" is the historical phrase but Cashfree's actual
 * mechanism is a name-match + AML check — no money moves.
 */
export async function pennyDropBank(
  client: CashfreeClient,
  args: {
    account_number: string
    ifsc: string
    name: string
    verificationId?: string
  }
): Promise<BankPennyDropResult> {
  const res = await client.request<Record<string, unknown>>({
    method: "POST",
    path: "/verification/bank-account/sync",
    body: {
      bank_account: args.account_number.replace(/\s+/g, ""),
      ifsc: args.ifsc.toUpperCase(),
      name: args.name,
      verification_id: args.verificationId,
    },
    headers: {
      // BAV v2 dispatches on the version header. 2024-01-01 is the
      // first published v2-compatible version; newer is fine too.
      "x-api-version": "2024-01-01",
    },
  })
  const data = res.data ?? {}
  const accountStatus = String(
    (data as any).account_status ?? (data as any).status ?? "",
  ).toUpperCase()
  const accountStatusCode = String(
    (data as any).account_status_code ?? "",
  ).toUpperCase()
  const ok =
    accountStatus === "VALID" ||
    accountStatus === "SUCCESS" ||
    accountStatusCode === "ACCOUNT_IS_VALID"
  // name_match_score arrives as a string ("85") in v2 and a number
  // in v1 — coerce to number so callers don't have to branch.
  const rawScore = (data as any).name_match_score
  const name_match_score =
    typeof rawScore === "number"
      ? rawScore
      : typeof rawScore === "string" && rawScore.trim()
        ? Number(rawScore)
        : undefined
  return {
    ok,
    status: accountStatus,
    status_code: accountStatusCode || undefined,
    name_at_bank: (data as any).name_at_bank as string | undefined,
    name_match_score: Number.isFinite(name_match_score as number)
      ? (name_match_score as number)
      : undefined,
    name_match_result: (data as any).name_match_result as string | undefined,
    bank_name: (data as any).bank_name as string | undefined,
    branch: (data as any).branch as string | undefined,
    city: (data as any).city as string | undefined,
    micr: (data as any).micr as number | string | undefined,
    utr: (data as any).utr as string | undefined,
    ifsc_details:
      (data as any).ifsc_details &&
      typeof (data as any).ifsc_details === "object" &&
      !Array.isArray((data as any).ifsc_details)
        ? ((data as any).ifsc_details as Record<string, unknown>)
        : undefined,
    reference_id:
      (data as any).reference_id !== undefined
        ? String((data as any).reference_id)
        : undefined,
    raw: data,
  }
}

// Cashfree CMR / demat-validation has been REMOVED. Demat verification
// now goes through manual admin review at
// /admin/demat-accounts/:id/verify — the customer uploads a CMR PDF,
// ops eyeball it, flip verification_status by hand. Avoids burning
// Cashfree calls + matches our actual operational reality (Cashfree's
// CMR endpoint isn't in our verification suite anymore).
//
// The `verifyCmr` function used to live here. Don't re-add it without
// also re-evaluating whether Cashfree CMR is in our contract — the
// admin manual path handles every demat-verify need today.

/**
 * Strip identifiable data out of a Cashfree response before
 * persisting.
 *
 * DPDP Act 2023 + SEBI / PMLA compliance rules of thumb:
 *   1. Store only what's necessary for audit (not "everything the
 *      partner sent").
 *   2. If you can't explain why a specific field needs to sit in
 *      your database for 8 years, drop it.
 *
 * This function is a **whitelist** — we KEEP the fields below (audit
 * signal: verification outcome, name-match evidence, provider-side
 * reference ids for dispute resolution, masked identifiers) and
 * drop everything else. A new field that Cashfree adds tomorrow is
 * dropped by default; a dev has to explicitly opt it in here, with
 * a written justification in this comment.
 *
 * Fields deliberately dropped:
 *   - Full identifiers: `aadhaar_number`, `pan`, `bank_account`, `otp`,
 *     `account_number`, `rrn`, `share_code`, `transaction_id`
 *   - Demographic bloat: `dob`, `gender`, `father_name`, `fathers_name`,
 *     `care_of`, `mobile`, `email`, `mobile_hash`, `email_hash`
 *   - Address components: `address`, `house`, `street`, `landmark`,
 *     `location`, `vtc`, `subdist`, `district`, `state`, `pc`,
 *     `pincode`, `country`, `po` (we're India-only; we already have
 *     the customer's billing address if we need it for delivery —
 *     no reason to also capture it via the KYC partner)
 *   - Biometric: `photo`, `photo_base64`, `photo_link`, `face_image`
 *   - Raw debug: `request_id`, anything prefixed with `_`
 */
const KEEP_KEYS = new Set<string>([
  // Verification outcome
  "status",
  "account_status",
  "verified",
  "is_valid",
  "valid", // PAN Advance returns this as the canonical bool
  "message",
  "name_match_result",
  "name_match_score",
  // BAV v2 — finer-grained status code (account_status_code) and
  // bank-side debit reference (utr) are non-PII audit signals.
  "account_status_code",
  "utr",
  // BAV v2 returns branch + city at the top level + a structured
  // ifsc_details object. None are PII; persisted for dispute audit.
  "branch",
  "city",
  "micr",
  "ifsc_details",
  "ifsc_subcode",
  "swift_code",
  "nbin",
  "category",

  // Name-match evidence — we need these for SEBI audit to show the
  // KYC'd name matches the identifier holder.
  "registered_name", // PAN holder name as per ITD
  "name_on_pan",
  "name_pan_card", // PAN Advance — name as printed on physical card
  "name_provided", // PAN Advance — echoed-back submitted name
  "name", // Aadhaar name (masked / first-name-only some cases)
  "name_at_bank",
  "account_holder_name", // CMR
  "bank_name",
  "depository", // NSDL / CDSL

  // PAN 360 / Advance — non-PII enrichment fields. Safe to persist:
  // none of these are themselves identifiers and they're already
  // accessible via Income Tax Dept verification flows. PAN 360
  // returns the union of everything below; PAN Basic returns a
  // subset. The allowlist is the same either way.
  "type", // PAN holder category (Individual / Company / HUF / …)
  "father_name", // Father's name on PAN record
  "pan_status", // VALID / INVALID / DELETED / DEACTIVATED / MARKED_DECEASED
  "aadhaar_seeding_status", // Y / R / NA
  "aadhaar_seeding_status_desc", // Human-readable equivalent
  "aadhaar_linked", // Boolean PAN ↔ Aadhaar linkage (PAN 360)
  "last_updated_at", // Date IT Dept last updated this record
  "pan", // PAN echoed back
  "first_name", // Name split provided by Cashfree
  "last_name",
  "verification_id", // Caller-supplied id echoed back

  // Masked identifiers (always last-4 / last-6; never the full number)
  "aadhaar_number_masked",
  "masked_aadhaar",
  "pan_masked",
  "bank_account_masked",

  // Provider-side audit pointers — keep these so we can raise a
  // ticket with Cashfree months later referencing a specific check.
  "reference_id",
  "verification_id",
  "ref_id",
  "refId",
  "created_at",
  "verified_at",

  // PAN Advance / 360 — DEMOGRAPHIC PII fields. Intentionally
  // EXCLUDED from the audit blob to keep DPDP-grade PII out of
  // long-lived storage. The structured `customer.metadata` cache
  // captures them on the customer record (where they're already
  // expected to live, alongside email + phone), but the
  // verification audit log gets only the non-PII subset.
  // Excluded: dob, gender, email, phone, address.
])

export function redactSecureIdResponse(
  raw: Record<string, unknown>
): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(raw)) {
    if (!KEEP_KEYS.has(k)) continue
    if (v && typeof v === "object" && !Array.isArray(v)) {
      // Recurse but only keep whitelisted fields at the nested level
      // too — Cashfree sometimes nests `reference_id` under an
      // envelope.
      out[k] = redactSecureIdResponse(v as Record<string, unknown>)
    } else {
      out[k] = v
    }
  }
  return out
}

/**
 * @deprecated Use `await walletModule.getSecureId()` instead — that path
 * reads the live DB-backed credentials. This factory only sees env vars.
 */
export function getSecureId() {
  const client = getVerificationClient()
  return {
    verifyPan: (a: Parameters<typeof verifyPan>[1]) => verifyPan(client, a),
    sendAadhaarOtp: (a: Parameters<typeof sendAadhaarOtp>[1]) =>
      sendAadhaarOtp(client, a),
    verifyAadhaarOtp: (a: Parameters<typeof verifyAadhaarOtp>[1]) =>
      verifyAadhaarOtp(client, a),
    pennyDropBank: (a: Parameters<typeof pennyDropBank>[1]) => pennyDropBank(client, a),
    // verifyCmr removed — see comment block above. Demat verification
    // is admin-manual. maskAadhaarCard removed 2026-05-04 — Cashfree's
    // OTP-verify already returns the holder photo + masked-last-4
    // form, and the masking endpoint required a card-image upload
    // flow we don't run.
  }
}
