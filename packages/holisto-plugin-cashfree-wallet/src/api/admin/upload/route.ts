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
 * Admin-side mirror of `POST /store/upload`. Same processing pipeline
 * — strip PDF passwords (admin can supply `password` field in the
 * multipart body when uploading on behalf of a customer), compress to
 * ≤ 2 MB, return typed `code` on failure.
 */
export async function POST(req: MedusaRequest, res: MedusaResponse) {
    const file = (req as any).file as
        | { originalname?: string; buffer: Buffer }
        | undefined
    if (!file) return res.status(400).json({ message: "Missing file" })

    const password = (req.body as any)?.password
    const passwordStr =
        typeof password === "string" && password.length > 0 ? password : null

    let processed
    try {
        processed = await processCustomerDocument(file.buffer, passwordStr)
    } catch (err) {
        if (err instanceof PdfPasswordRequired) {
            return res
                .status(422)
                .json({ code: "pdf.password_required", message: err.message })
        }
        if (err instanceof PdfBadPassword) {
            return res
                .status(422)
                .json({ code: "pdf.bad_password", message: err.message })
        }
        if (err instanceof FileTooLarge) {
            return res.status(413).json({
                code: "file.too_large",
                max_bytes: MAX_BYTES,
                message: err.message,
            })
        }
        if (err instanceof UnsupportedFileType) {
            return res
                .status(415)
                .json({ code: "file.unsupported", message: err.message })
        }
        logger.error("admin upload pipeline failed", {
            error: (err as Error).message,
        })
        return res.status(500).json({ message: "Upload processing failed" })
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
