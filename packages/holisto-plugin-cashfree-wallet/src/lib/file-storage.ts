/**
 * Local-disk file storage for KYC documents (PAN/Aadhaar cards, bank
 * proofs, CMR PDFs, Aadhaar photo crops).
 *
 * Writes under WALLET_UPLOAD_DIR (default `static/uploads`) and returns a
 * public URL under WALLET_UPLOAD_PUBLIC_PREFIX (default `/static/uploads`),
 * which Medusa serves as static content.
 *
 * Plain functions — no Medusa module. Replaces the old `polemarch`
 * upload shim.
 *
 * TODO (S3 portability): for multi-instance / container deploys, swap
 * these for Medusa's File module (`Modules.FILE` → createFiles/deleteFiles)
 * so uploads go to the client's configured provider (S3, etc.) instead of
 * ephemeral local disk.
 */
import { mkdir, writeFile, unlink } from "node:fs/promises"
import { join, extname } from "node:path"
import { randomUUID } from "node:crypto"

const UPLOAD_DIR = process.env.WALLET_UPLOAD_DIR || "static/uploads"
const PUBLIC_PREFIX = process.env.WALLET_UPLOAD_PUBLIC_PREFIX || "/static/uploads"

export async function uploadFile(input: {
  originalname?: string
  buffer: Buffer | Uint8Array
}): Promise<{ url: string }> {
  await mkdir(UPLOAD_DIR, { recursive: true })
  const ext = input.originalname ? extname(input.originalname) : ""
  const name = `${randomUUID()}${ext}`
  await writeFile(join(UPLOAD_DIR, name), input.buffer as any)
  return { url: `${PUBLIC_PREFIX}/${name}` }
}

export async function deleteStoredFile(url: string): Promise<{ ok: boolean }> {
  try {
    if (url && url.startsWith(PUBLIC_PREFIX)) {
      const rel = url.slice(PUBLIC_PREFIX.length).replace(/^\/+/, "")
      await unlink(join(UPLOAD_DIR, rel))
    }
  } catch {
    // best-effort delete
  }
  return { ok: true }
}
