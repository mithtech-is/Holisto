import fs from "node:fs/promises"
import path from "node:path"

/**
 * CMR PDF text-match — extracts identifier candidates and checks
 * customer-supplied values against them.
 *
 * Goal: when a customer uploads a CMR, find the PAN / BOID /
 * DP-ID / Client-ID actually printed in the file, and decide:
 *   - auto-verify   : everything the customer typed lines up with
 *                     what's in the document
 *   - pan_mismatch  : the document carries a different PAN than the
 *                     customer's verified one (someone else's CMR;
 *                     reject upload)
 *   - identifier_mismatch
 *                   : PAN lines up but the typed BOID / DP-ID /
 *                     Client-ID doesn't — surface what we found so
 *                     the storefront can ask "did you mean X?"
 *   - manual_review : we couldn't extract enough to decide (image-
 *                     only PDF, exotic encryption, or simply no
 *                     identifiers in the printable text)
 *
 * Depository conventions:
 *   - CDSL → 16-digit BOID. CDSL CMRs print this as `DP Id` (8
 *            digits) immediately followed by `Client Id` (8 digits)
 *            with the label words in between. We normalise digits-
 *            only so the typed 16-digit BOID surfaces as a contiguous
 *            substring of `<DP-Id><Client-Id>...`.
 *   - NSDL → DP-ID (`IN` + 6 digits) AND Client-ID (8 digits). NSDL
 *            CMRs print these distinctly, often label-prefixed
 *            (`DP:STOCK HOLDING ... [IN301330]` and a `client id`
 *            cell with the 8-digit value). Both halves must resolve.
 *
 * Match strategy:
 *   - PAN: regex `[A-Z]{5}\d{4}[A-Z]` on RAW text (whitespace-aware)
 *          to avoid false positives the alphanumeric-norm produces
 *          when adjacent words concatenate into a PAN-shape.
 *   - BOID (CDSL): search the digit-only norm of the document for
 *          the typed 16-digit string. The label letters between the
 *          DP-Id and Client-Id halves drop out, so a typed
 *          `1208870350823654` resolves against `DP Id 12088703 ...
 *          Client Id 50823654 ...` cleanly. Candidate extraction
 *          looks for `(?:dp\s*id[\s:]*\d{8}).*?(?:client\s*id[\s:]*\d{8})`
 *          so we can surface the actual BOID for mismatches.
 *   - DP-ID (NSDL): regex `IN\d{6}` on raw text.
 *   - Client-ID (NSDL): label-anchored search for `client\s*id` (case-
 *          insensitive) followed by an 8-digit run within ~80 chars.
 *
 * Why text-only (no OCR): real-world CMRs from NSDL / CDSL / broker
 * portals are text-PDFs. `pdf-parse` extracts them in <100ms with
 * zero native deps. Image-only PDFs fall through to manual review
 * via `image_only_pdf_or_empty`.
 *
 * The function never throws — pdf-parse failures (corrupt PDF,
 * encrypted PDF that survived qpdf) bubble up as `auto_verified:
 * false` with a `reason` and the caller drops to manual review.
 */

export type CmrMatchInput = {
  /** Public file URL (`/static/<filename>`) returned by uploadLocal. */
  cmrFileUrl: string
  /** Customer's PAN (full, uppercase). Pulled from pan_record before
   *  calling. Skipped when null — pan_found stays false. */
  pan: string | null
  /** Depository the customer picked on the form. Determines which
   *  identifier(s) we look up. */
  depository: "CDSL" | "NSDL"
  /** CDSL only — 16-digit BOID. Required when depository === "CDSL",
   *  unused otherwise. */
  boid?: string | null
  /** NSDL only — `IN` + 6 digits. Required when depository === "NSDL". */
  dp_id?: string | null
  /** NSDL only — 8 digits. Required when depository === "NSDL". */
  client_id?: string | null
}

/** Raw candidates extracted from the PDF. Used by the route to
 *  build mismatch hints for the storefront dialog. Empty arrays
 *  mean "couldn't find any identifier of that shape" — different
 *  from "found one that didn't match". */
export type CmrCandidates = {
  pans: string[]
  /** 16-digit BOIDs reconstructed from the document (CDSL-style
   *  `DP Id` + `Client Id` pair, or any 16 contiguous digits). */
  boids: string[]
  /** `IN` + 6 digits — the depository-participant ID (NSDL). */
  dpIds: string[]
  /** 8-digit Client-IDs (NSDL). Best-effort — only digit runs
   *  near a `client id` label are surfaced, to avoid pulling
   *  unrelated 8-digit numbers like phone fragments. */
  clientIds: string[]
}

/** Findings from the CDSL path — single BOID lookup. */
type CdslFindings = {
  kind: "cdsl"
  boid_found: boolean
}

/** Findings from the NSDL path — both DP-ID and Client-ID must
 *  resolve for the account to count as found. */
type NsdlFindings = {
  kind: "nsdl"
  dp_id_found: boolean
  client_id_found: boolean
}

export type CmrMatchResult = {
  pan_found: boolean
  /** True when the depository-relevant identifier(s) are all present
   *  in the extracted text. Auto-verify gate is `pan_found &&
   *  account_found`. */
  account_found: boolean
  /** Per-depository per-field findings — drives the audit row in
   *  /store/demat-accounts so admins can see exactly what landed
   *  (or didn't) in the PDF. Tagged union — no irrelevant fields. */
  findings: CdslFindings | NsdlFindings
  /** Total chars of the digit-only norm — useful as a hint when
   *  the file was image-only (length ≈ 0). */
  text_length: number
  /** PAN AND account both resolved — caller flips
   *  verification_status to `verified`. */
  auto_verified: boolean
  /** Why we couldn't verify — populated when auto_verified is false.
   *  cmr_file_unreadable, pdf_parse_failed:..., image_only_pdf_or_empty,
   *  pan_missing, account_missing, pan_and_account_missing. */
  reason?: string
  /** Identifier candidates pulled from the PDF, regardless of
   *  whether the typed values matched. Lets the route surface
   *  "we found <X> in your CMR — did you mean that?" without a
   *  second extraction pass. */
  candidates: CmrCandidates
}

const STATIC_DIR = path.join(process.cwd(), "static")

/** Strip every non-alphanumeric and uppercase. Used for PAN and
 *  DP-ID searches (these contain letters). */
function normAlnum(s: string | null | undefined): string {
  if (!s) return ""
  return s.replace(/[^A-Za-z0-9]/g, "").toUpperCase()
}

/** Strip every non-digit. Used for BOID / Client-ID searches —
 *  CDSL's split-BOID layout is only contiguous when label letters
 *  drop out. */
function normDigits(s: string | null | undefined): string {
  if (!s) return ""
  return s.replace(/\D/g, "")
}

/** Read the uploaded CMR back from disk. The polemarch FileService
 *  saves to `process.cwd()/static/<filename>` and returns
 *  `/static/<filename>` as the URL — we reverse the join here. */
async function readCmrBuffer(cmrFileUrl: string): Promise<Buffer | null> {
  if (!cmrFileUrl?.startsWith("/static/")) return null
  const fileName = path.basename(cmrFileUrl)
  // Defence-in-depth: never read outside staticDir even if the URL
  // got mangled. The upload route already path-sanitises before
  // saving, so this is belt-and-braces.
  if (
    !fileName ||
    fileName.includes("..") ||
    fileName.includes("/") ||
    fileName.includes("\\")
  ) {
    return null
  }
  const fullPath = path.join(STATIC_DIR, fileName)
  const resolved = path.resolve(fullPath)
  if (!resolved.startsWith(path.resolve(STATIC_DIR) + path.sep)) {
    return null
  }
  try {
    return await fs.readFile(resolved)
  } catch {
    return null
  }
}

/** Extract candidate identifiers from the PDF text. Best-effort —
 *  empty arrays just mean "nothing of that shape found", which the
 *  caller treats as "fall through to manual review for that field". */
function extractCandidatesFromText(rawText: string): CmrCandidates {
  // PAN — regex on raw text. Five letters, four digits, one letter.
  // The Indian PAN format is strict enough that a regex on raw
  // text rarely false-positives. We dedupe and uppercase.
  const panSet = new Set<string>()
  for (const m of rawText.matchAll(/[A-Z]{5}\d{4}[A-Z]/g)) {
    panSet.add(m[0].toUpperCase())
  }

  // CDSL BOIDs — two strategies:
  //   (a) explicit "DP Id <8 digits> ... Client Id <8 digits>" pair
  //   (b) any 16 contiguous digits (with optional whitespace) on
  //       raw text — broker-portal CMRs sometimes print BOID as a
  //       single line.
  const boidSet = new Set<string>()
  const labelPair = rawText.matchAll(
    /dp\s*id[\s:]*?(\d{8})[\s\S]{0,200}?client\s*id[\s:]*?(\d{8})/gi,
  )
  for (const m of labelPair) {
    boidSet.add(m[1] + m[2])
  }
  const sixteenRun = rawText.matchAll(
    /(?<!\d)(\d{4}\s*\d{4}\s*\d{4}\s*\d{4})(?!\d)/g,
  )
  for (const m of sixteenRun) {
    boidSet.add(m[1].replace(/\s+/g, ""))
  }

  // NSDL DP-IDs — `IN` + 6 digits. The CMR may bracket it
  // (`[IN301330]`) or print it inline; either way the regex hits.
  const dpIdSet = new Set<string>()
  for (const m of rawText.matchAll(/IN\d{6}/g)) {
    dpIdSet.add(m[0].toUpperCase())
  }

  // NSDL Client-IDs — 8 contiguous digits, but ONLY when a
  // "client id" label appears within ~120 chars before the digits
  // (handles label / value being on adjacent lines or in a small
  // table cell). Avoids pulling phone or pin-code fragments.
  const clientIdSet = new Set<string>()
  for (const m of rawText.matchAll(
    /client\s*id[\s\S]{0,120}?(?<!\d)(\d{8})(?!\d)/gi,
  )) {
    clientIdSet.add(m[1])
  }

  return {
    pans: Array.from(panSet),
    boids: Array.from(boidSet),
    dpIds: Array.from(dpIdSet),
    clientIds: Array.from(clientIdSet),
  }
}

/** Public: parse a CMR PDF and return raw identifier candidates.
 *  Used by the demat-create route to surface mismatch hints for
 *  the storefront dialog. Returns an empty result on read / parse
 *  failure rather than throwing. */
export async function extractCmrCandidates(
  cmrFileUrl: string,
): Promise<{ candidates: CmrCandidates; text_length: number; reason?: string }> {
  const buffer = await readCmrBuffer(cmrFileUrl)
  if (!buffer) {
    return {
      candidates: { pans: [], boids: [], dpIds: [], clientIds: [] },
      text_length: 0,
      reason: "cmr_file_unreadable",
    }
  }
  let extracted: string
  try {
    const pdfParse = (await import("pdf-parse/lib/pdf-parse.js"))
      .default as (b: Buffer) => Promise<{ text: string }>
    const parsed = await pdfParse(buffer)
    extracted = parsed?.text ?? ""
  } catch (err) {
    return {
      candidates: { pans: [], boids: [], dpIds: [], clientIds: [] },
      text_length: 0,
      reason: `pdf_parse_failed:${(err as Error).message?.slice(0, 80) ?? "unknown"}`,
    }
  }
  const candidates = extractCandidatesFromText(extracted)
  return {
    candidates,
    text_length: normDigits(extracted).length,
    ...(extracted.trim().length === 0
      ? { reason: "image_only_pdf_or_empty" }
      : {}),
  }
}

export async function extractCmrFingerprints(
  input: CmrMatchInput,
): Promise<CmrMatchResult> {
  const initialFindings: CdslFindings | NsdlFindings =
    input.depository === "CDSL"
      ? { kind: "cdsl", boid_found: false }
      : { kind: "nsdl", dp_id_found: false, client_id_found: false }
  const emptyCandidates: CmrCandidates = {
    pans: [],
    boids: [],
    dpIds: [],
    clientIds: [],
  }

  const empty = (reason: string): CmrMatchResult => ({
    pan_found: false,
    account_found: false,
    findings: initialFindings,
    text_length: 0,
    auto_verified: false,
    reason,
    candidates: emptyCandidates,
  })

  const buffer = await readCmrBuffer(input.cmrFileUrl)
  if (!buffer) return empty("cmr_file_unreadable")

  let extracted: string
  try {
    // pdf-parse's index.js auto-runs a self-test that reads its own
    // bundled test PDF. Importing the inner module skips that
    // accidental I/O. The default export is the parser function.
    const pdfParse = (await import("pdf-parse/lib/pdf-parse.js"))
      .default as (b: Buffer) => Promise<{ text: string }>
    const parsed = await pdfParse(buffer)
    extracted = parsed?.text ?? ""
  } catch (err) {
    return empty(
      `pdf_parse_failed:${(err as Error).message?.slice(0, 80) ?? "unknown"}`,
    )
  }

  const haystackAlnum = normAlnum(extracted)
  const haystackDigits = normDigits(extracted)
  if (haystackAlnum.length === 0 && haystackDigits.length === 0) {
    return empty("image_only_pdf_or_empty")
  }

  const candidates = extractCandidatesFromText(extracted)

  // PAN: search alphanumeric-norm for the typed PAN string. This is
  // the historical behaviour and works because PAN is a unique 10-char
  // pattern unlikely to false-match. We also expose the candidate
  // PANs separately so the route can detect "PAN on file ≠ PAN in CMR".
  const panNeedle = normAlnum(input.pan)
  const pan_found = panNeedle.length > 0 && haystackAlnum.includes(panNeedle)

  let findings: CdslFindings | NsdlFindings
  let account_found = false
  if (input.depository === "CDSL") {
    // Digit-only norm — strips the `Client/Id` letters between the
    // 8-digit halves so the typed 16-digit BOID surfaces as a
    // contiguous substring (`DP Id 12088703 Client Id 50823654` →
    // `1208870350823654...`).
    const boidNeedle = normDigits(input.boid)
    const boid_found =
      boidNeedle.length > 0 && haystackDigits.includes(boidNeedle)
    findings = { kind: "cdsl", boid_found }
    account_found = boid_found
  } else {
    // DP-ID is `IN` + 6 digits → use the alphanumeric haystack. The
    // 8-digit Client-ID we keep digit-strict (avoid concatenating
    // unrelated digits across labels).
    const dpIdNeedle = normAlnum(input.dp_id)
    const clientIdNeedle = normDigits(input.client_id)
    const dp_id_found =
      dpIdNeedle.length > 0 && haystackAlnum.includes(dpIdNeedle)
    const client_id_found =
      clientIdNeedle.length > 0 && haystackDigits.includes(clientIdNeedle)
    findings = { kind: "nsdl", dp_id_found, client_id_found }
    // NSDL accounts need BOTH halves present — DP-ID alone identifies
    // the broker / depository participant, not the customer.
    account_found = dp_id_found && client_id_found
  }

  const auto_verified = pan_found && account_found
  let reason: string | undefined
  if (!auto_verified) {
    if (!pan_found && !account_found) reason = "pan_and_account_missing"
    else if (!pan_found) reason = "pan_missing"
    else reason = "account_missing"
  }

  return {
    pan_found,
    account_found,
    findings,
    text_length: haystackDigits.length,
    auto_verified,
    reason,
    candidates,
  }
}
