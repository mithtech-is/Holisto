/**
 * Customer-document upload pipeline.
 *
 * Every upload route that accepts customer-supplied files (KYC card
 * photos, CMR PDFs, deposit proofs, bank-statement PDFs, profile
 * selfies) flows through `processCustomerDocument`. The pipeline:
 *
 *   1. Sniffs the file type from magic bytes (not just the extension —
 *      a misnamed `.pdf` carrying a JPEG would otherwise sail through
 *      qpdf and corrupt the registry).
 *   2. For PDFs: detects encryption (looks for `/Encrypt` in the PDF
 *      trailer dict). If encrypted AND a password was supplied, runs
 *      `qpdf --password=… --decrypt` to strip the password. If
 *      encrypted with no password, throws `PdfPasswordRequired`. If
 *      the password is wrong, throws `PdfBadPassword`.
 *   3. Compresses:
 *      - PDFs → ghostscript with `-dPDFSETTINGS=/ebook` first; falls
 *        back to `/screen` if the result is still over the size cap.
 *      - Images (JPEG / PNG / WebP / HEIC) → `sharp` re-encode at
 *        progressively lower quality until ≤ MAX_BYTES.
 *   4. Enforces a 2 MB cap on the final stored size. If even the
 *      most aggressive pass can't get under, throws `FileTooLarge`.
 *
 * The pipeline is deliberately CLI-shelling for the PDF parts (qpdf +
 * ghostscript) rather than pulling a JS-only library:
 *   - qpdf handles every PDF encryption variant (RC4 40/128, AES-128,
 *     AES-256, AES-256R6) and Cashfree / depository-issued CMRs use
 *     all of them.
 *   - ghostscript's `-dPDFSETTINGS` is the well-trodden path for
 *     getting CMRs from 8 MB to <500 KB without rasterising.
 *   - JS-only alternatives (pdf-lib, hummus, pdfkit) all either skip
 *     encryption removal or skip compression — and bundling muPDF /
 *     PDFium as Node bindings is heavier than a 6 MB apt install.
 *
 * The CLI binaries are added to the medusa-backend Dockerfile (apt:
 * `qpdf`, `ghostscript`). Outside Docker (local dev) install via:
 *   macOS:  brew install qpdf ghostscript
 *   Debian: apt-get install qpdf ghostscript
 */
import { execFile } from "node:child_process"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import sharp from "sharp"

/** 2 MB cap on the FINAL stored file. Pre-compression input can be
 *  larger; if compression brings it under, we accept. */
export const MAX_BYTES = 2 * 1024 * 1024

export class PdfPasswordRequired extends Error {
    constructor() {
        super("PDF is password-protected — supply the password to upload.")
        this.name = "PdfPasswordRequired"
    }
}

export class PdfBadPassword extends Error {
    constructor() {
        super("Wrong password for this PDF.")
        this.name = "PdfBadPassword"
    }
}

export class FileTooLarge extends Error {
    constructor(public readonly bytes: number) {
        super(
            `File is ${(bytes / (1024 * 1024)).toFixed(2)} MB after compression — over the ${(
                MAX_BYTES /
                (1024 * 1024)
            ).toFixed(0)} MB limit.`,
        )
        this.name = "FileTooLarge"
    }
}

export class UnsupportedFileType extends Error {
    constructor(public readonly mime: string | null) {
        super(`Unsupported file type${mime ? `: ${mime}` : ""}.`)
        this.name = "UnsupportedFileType"
    }
}

type Kind = "pdf" | "jpeg" | "png" | "webp" | "heic"

/** Sniff the file's actual type from its magic bytes. The first ~12
 *  bytes are enough to disambiguate every format we accept. */
function detectKind(buf: Buffer): Kind | null {
    if (buf.length < 4) return null
    // PDF: %PDF-
    if (buf[0] === 0x25 && buf[1] === 0x50 && buf[2] === 0x44 && buf[3] === 0x46) {
        return "pdf"
    }
    // JPEG: FF D8 FF
    if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "jpeg"
    // PNG: 89 50 4E 47
    if (
        buf[0] === 0x89 &&
        buf[1] === 0x50 &&
        buf[2] === 0x4e &&
        buf[3] === 0x47
    ) {
        return "png"
    }
    // WebP: "RIFF" .... "WEBP"
    if (
        buf.length >= 12 &&
        buf[0] === 0x52 &&
        buf[1] === 0x49 &&
        buf[2] === 0x46 &&
        buf[3] === 0x46 &&
        buf[8] === 0x57 &&
        buf[9] === 0x45 &&
        buf[10] === 0x42 &&
        buf[11] === 0x50
    ) {
        return "webp"
    }
    // HEIC: ftypheic / ftypheix / ftypmif1 / ftypmsf1 (offset 4)
    if (
        buf.length >= 12 &&
        buf[4] === 0x66 &&
        buf[5] === 0x74 &&
        buf[6] === 0x79 &&
        buf[7] === 0x70
    ) {
        const brand = buf.slice(8, 12).toString("ascii")
        if (
            brand === "heic" ||
            brand === "heix" ||
            brand === "mif1" ||
            brand === "msf1"
        ) {
            return "heic"
        }
    }
    return null
}

/** Cheap heuristic for "this PDF is encrypted". The PDF spec puts an
 *  `/Encrypt` entry in the trailer dict when encrypted; reading the
 *  whole thing is overkill — a substring scan over the buffer is
 *  enough. False positives are rare (the literal token can technically
 *  appear in a content stream, but qpdf will give us a clean answer
 *  on the decrypt path either way). */
function looksEncrypted(buf: Buffer): boolean {
    // Search the last 2 KB first (trailer dict lives at the end). Fall
    // back to a full scan if not found — some producers stash
    // `/Encrypt` in xref-stream dicts mid-file.
    const tail = buf.slice(Math.max(0, buf.length - 2048))
    if (tail.includes(Buffer.from("/Encrypt"))) return true
    return buf.includes(Buffer.from("/Encrypt"))
}

/** Run a CLI command, capturing stdout/stderr. Throws with the stderr
 *  text on non-zero exit so callers can pattern-match. */
function run(
    cmd: string,
    args: string[],
    opts: { input?: Buffer } = {},
): Promise<{ stdout: Buffer; stderr: string }> {
    return new Promise((resolve, reject) => {
        const child = execFile(
            cmd,
            args,
            {
                encoding: "buffer" as any,
                maxBuffer: 64 * 1024 * 1024, // 64 MB — well above any single doc
            },
            (err, stdout, stderr) => {
                if (err) {
                    const e = err as Error & { stderr?: Buffer | string }
                    e.stderr =
                        typeof stderr === "string"
                            ? stderr
                            : (stderr as Buffer)?.toString("utf8") ?? ""
                    reject(e)
                    return
                }
                resolve({
                    stdout: stdout as unknown as Buffer,
                    stderr:
                        typeof stderr === "string"
                            ? stderr
                            : (stderr as Buffer)?.toString("utf8") ?? "",
                })
            },
        )
        if (opts.input) {
            child.stdin?.end(opts.input)
        }
    })
}

/** qpdf --decrypt: removes any password-based protection. We pass the
 *  password via `--password=` (qpdf ignores the flag if the file isn't
 *  encrypted, so calling with an empty password on an unprotected PDF
 *  is a no-op rather than an error).
 *
 *  Implementation note: qpdf 11.x (the version that ships with Debian
 *  Bookworm — what node:20-slim is built on) does NOT honour `-` as a
 *  stdin/stdout placeholder. It tries to open a file literally named
 *  "-" and fails with `qpdf: open -: No such file or directory`. The
 *  earlier streaming syntax `qpdf … -- - -` worked on qpdf 10 and
 *  newer 12.x but is broken in 11.x specifically. To stay portable
 *  across qpdf versions we round-trip via temp files — same pattern
 *  `gsCompress` already uses for ghostscript. */
async function qpdfDecrypt(buf: Buffer, password: string): Promise<Buffer> {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "polemarch-qpdf-"))
    const inPath = path.join(tmpDir, "in.pdf")
    const outPath = path.join(tmpDir, "out.pdf")
    try {
        await fs.writeFile(inPath, buf)
        await run("qpdf", [
            "--decrypt",
            `--password=${password}`,
            inPath,
            outPath,
        ])
        return await fs.readFile(outPath)
    } catch (err: any) {
        const stderr = String(err?.stderr ?? err?.message ?? "")
        if (/invalid password/i.test(stderr)) throw new PdfBadPassword()
        if (/password required/i.test(stderr)) throw new PdfPasswordRequired()
        throw err
    } finally {
        await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {})
    }
}

/** ghostscript compress at the given preset. `screen` is the most
 *  aggressive (72 DPI image downsample), `ebook` keeps text crisp at
 *  150 DPI. We try `ebook` first; fall back to `screen` if still over.
 *  Reads/writes via temp files because gs doesn't reliably stream. */
async function gsCompress(
    buf: Buffer,
    preset: "/ebook" | "/screen" | "/printer" = "/ebook",
): Promise<Buffer> {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "polemarch-pdf-"))
    const inPath = path.join(tmpDir, "in.pdf")
    const outPath = path.join(tmpDir, "out.pdf")
    try {
        await fs.writeFile(inPath, buf)
        await run("gs", [
            "-q",
            "-dNOPAUSE",
            "-dBATCH",
            "-dSAFER",
            "-sDEVICE=pdfwrite",
            "-dCompatibilityLevel=1.5",
            `-dPDFSETTINGS=${preset}`,
            "-dDetectDuplicateImages=true",
            "-dCompressFonts=true",
            `-sOutputFile=${outPath}`,
            inPath,
        ])
        return await fs.readFile(outPath)
    } finally {
        await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {})
    }
}

/** Compress an image with sharp. Loops over a quality ladder until the
 *  output fits MAX_BYTES, downscaling aggressively if the lowest
 *  quality still doesn't fit. JPEGs and HEIC source → JPEG output;
 *  PNG keeps lossless if the input is already small enough, else
 *  rasterises to JPEG. WebP keeps WebP. */
async function compressImage(buf: Buffer, kind: Kind): Promise<Buffer> {
    const qualities = [85, 75, 65, 55, 45]
    let pipeline = sharp(buf, { failOn: "error", animated: false })
    // Strip metadata — EXIF can carry GPS / device IDs the customer
    // didn't intend to share. Doesn't affect KYC validity.
    pipeline = pipeline.rotate().withMetadata({}) as any
    // Cap the longest edge at 2400 px on the first pass; if still big,
    // we'll downscale further below.
    pipeline = pipeline.resize({
        width: 2400,
        height: 2400,
        fit: "inside",
        withoutEnlargement: true,
    })

    const encode = async (
        p: sharp.Sharp,
        quality: number,
    ): Promise<Buffer> => {
        if (kind === "png") {
            // PNG → JPEG when shrinking. Document scans don't need
            // alpha, and JPEG saves an order of magnitude on size.
            return p.jpeg({ quality, mozjpeg: true }).toBuffer()
        }
        if (kind === "webp") {
            return p.webp({ quality }).toBuffer()
        }
        return p.jpeg({ quality, mozjpeg: true }).toBuffer()
    }

    for (const q of qualities) {
        const out = await encode(pipeline.clone(), q)
        if (out.length <= MAX_BYTES) return out
    }
    // Last resort: drop to 1600 px wide at q=40.
    const last = await sharp(buf, { failOn: "error" })
        .rotate()
        .withMetadata({})
        .resize({ width: 1600, fit: "inside", withoutEnlargement: true })
        .jpeg({ quality: 40, mozjpeg: true })
        .toBuffer()
    return last
}

export type ProcessOutcome = {
    /** The bytes to persist. Always ≤ MAX_BYTES. */
    buffer: Buffer
    /** What the pipeline did, surfaced in the audit log so we can spot
     *  customers whose docs are persistently bloated. */
    diagnostics: {
        kind: Kind
        original_bytes: number
        final_bytes: number
        was_encrypted: boolean
        decrypted: boolean
        compressed: boolean
        gs_pass: "/ebook" | "/screen" | null
    }
}

/**
 * Run the full pipeline. Throws typed errors callers can map to
 * specific 400/422 responses with a `code` field.
 */
export async function processCustomerDocument(
    buffer: Buffer,
    password: string | null = null,
): Promise<ProcessOutcome> {
    const kind = detectKind(buffer)
    if (!kind) {
        throw new UnsupportedFileType(null)
    }
    const originalBytes = buffer.length
    const diagnostics: ProcessOutcome["diagnostics"] = {
        kind,
        original_bytes: originalBytes,
        final_bytes: originalBytes,
        was_encrypted: false,
        decrypted: false,
        compressed: false,
        gs_pass: null,
    }

    if (kind === "pdf") {
        let working = buffer
        if (looksEncrypted(working)) {
            diagnostics.was_encrypted = true
            if (!password) throw new PdfPasswordRequired()
            working = await qpdfDecrypt(working, password)
            diagnostics.decrypted = true
        }
        // Always run a compression pass — most CMRs are 4–10 MB
        // unoptimised. ebook first, then screen if still over.
        if (working.length > MAX_BYTES) {
            try {
                const ebook = await gsCompress(working, "/ebook")
                if (ebook.length <= MAX_BYTES) {
                    working = ebook
                    diagnostics.gs_pass = "/ebook"
                    diagnostics.compressed = true
                } else {
                    const screen = await gsCompress(working, "/screen")
                    working = screen
                    diagnostics.gs_pass = "/screen"
                    diagnostics.compressed = true
                }
            } catch {
                // Compression itself failed — fall through to size check.
            }
        }
        if (working.length > MAX_BYTES) {
            throw new FileTooLarge(working.length)
        }
        diagnostics.final_bytes = working.length
        return { buffer: working, diagnostics }
    }

    // Images.
    let out = buffer
    if (out.length > MAX_BYTES) {
        out = await compressImage(out, kind)
        diagnostics.compressed = true
    }
    if (out.length > MAX_BYTES) throw new FileTooLarge(out.length)
    diagnostics.final_bytes = out.length
    return { buffer: out, diagnostics }
}
