import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import {
    processCustomerDocument,
    PdfPasswordRequired,
    PdfBadPassword,
    FileTooLarge,
    UnsupportedFileType,
    MAX_BYTES,
} from "../../../utils/document-pipeline"
import { logger } from "../../../utils/logger"
import { uploadFile, deleteStoredFile } from "../../../lib/file-storage"

/**
 * POST /store/upload
 *
 * Customer-document upload — KYC card photos, CMR PDFs, deposit
 * proofs, profile selfies, etc. Every file flows through
 * `processCustomerDocument` which:
 *   - Strips PDF passwords (if the client supplied `password` in the
 *     same multipart body and the PDF is encrypted).
 *   - Compresses the file to ≤ 2 MB. PDFs go through ghostscript;
 *     images go through sharp.
 *
 * Errors are returned with a typed `code` so the storefront can show
 * the right banner without parsing the message:
 *   - `pdf.password_required` (422)
 *   - `pdf.bad_password`      (422)
 *   - `file.too_large`        (413)
 *   - `file.unsupported`      (415)
 */
export async function POST(req: MedusaRequest, res: MedusaResponse) {
    const file = (req as any).file as
        | { originalname?: string; buffer: Buffer }
        | undefined
    if (!file) {
        return res.status(400).json({ message: "Missing file" })
    }
    // multer parses non-file form fields into req.body.
    const password = (req.body as any)?.password
    const passwordStr =
        typeof password === "string" && password.length > 0 ? password : null

    let processed
    try {
        processed = await processCustomerDocument(file.buffer, passwordStr)
    } catch (err) {
        if (err instanceof PdfPasswordRequired) {
            return res.status(422).json({
                code: "pdf.password_required",
                message: err.message,
            })
        }
        if (err instanceof PdfBadPassword) {
            return res.status(422).json({
                code: "pdf.bad_password",
                message: err.message,
            })
        }
        if (err instanceof FileTooLarge) {
            return res.status(413).json({
                code: "file.too_large",
                max_bytes: MAX_BYTES,
                message: err.message,
            })
        }
        if (err instanceof UnsupportedFileType) {
            return res.status(415).json({
                code: "file.unsupported",
                message: err.message,
            })
        }
        // Unknown failure path. Log everything we have, but ALSO surface
        // a sanitised tail of the underlying error to the client so the
        // storefront can show the user something actionable instead of
        // a generic "Upload processing failed". Prior behaviour swallowed
        // qpdf/ghostscript/sharp stderr server-side and the customer
        // had no way to know if it was a corrupt PDF, a missing tool,
        // a permission issue, etc.
        const raw = err as Error & { stderr?: string; stdout?: string }
        const stderr = (raw?.stderr ?? "").toString().trim()
        const message = (raw?.message ?? "").toString().trim()
        logger.error("upload pipeline failed", {
            error: message,
            stderr: stderr.slice(0, 1000),
        })
        // Strip absolute paths from /tmp scratch dirs so we never leak
        // server-side filesystem layout in the customer-visible reason.
        const sanitise = (s: string) =>
            s
                .replace(/\/tmp\/[A-Za-z0-9._\-/]+/g, "<tmp>")
                .replace(/\/workspace\/[A-Za-z0-9._\-/]+/g, "<app>")
                .slice(0, 240)
        // Pick the most informative line: prefer the last non-empty
        // stderr line (CLI tools usually print the actual reason there)
        // before the wrapping "Command failed: …" preamble.
        const lastStderr =
            stderr
                .split(/\r?\n/)
                .map((l) => l.trim())
                .filter(Boolean)
                .pop() ?? ""
        const reason = sanitise(lastStderr || message) || "Unknown error"
        // Best-effort code routing for common patterns we've seen so the
        // storefront can branch (e.g. show "PDF is damaged" with a Retry
        // button, vs an OCR/processing toast).
        const code =
            /password|encrypt/i.test(reason)
                ? "pdf.processing_failed"
                : /open .*: No such file/i.test(reason) ||
                    /unsupported file format/i.test(reason)
                  ? "file.processing_failed"
                  : /command failed/i.test(message) || stderr
                    ? "pipeline.tool_failed"
                    : "upload.failed"
        return res.status(500).json({
            code,
            message: `Upload failed: ${reason}`,
            reason,
        })
    }

    try {
        const { url } = await uploadFile({
            originalname: file.originalname,
            buffer: processed.buffer,
        })
        return res.json({ url, diagnostics: processed.diagnostics })
    } catch (error: any) {
        return res.status(400).json({ message: error.message })
    }
}

export async function DELETE(req: MedusaRequest, res: MedusaResponse) {
    const url = (req.query?.url as string) || ""
    if (!url) return res.status(400).json({ message: "Missing url query parameter" })
    try {
        const result = await deleteStoredFile(url)
        return res.json(result)
    } catch (error: any) {
        return res.status(400).json({ message: error.message })
    }
}
