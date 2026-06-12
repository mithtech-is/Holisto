import type { MedusaContainer } from "@medusajs/framework/types"
import { logger } from "./logger"
import { uploadFile } from "../lib/file-storage"

/**
 * Persist the holder photo Cashfree returns on
 * `/verification/offline-aadhaar/verify` so we can use it as the
 * storefront profile-picture fallback (profile_photo → aadhaar_photo
 * → avatar) and for admin visual identification.
 *
 * Cashfree's response shapes the photo three ways across versions:
 *   raw.photo            — base64 string ("data:image/jpeg;base64,…" OR bare base64)
 *   raw.photo_base64     — base64 string
 *   raw.photo_link       — CDN URL
 * We probe in that order. Returns the local /static URL we re-hosted
 * the bytes at, or null if no photo was present (or extraction failed
 * — we never fail the calling route over a missing photo).
 */
export async function extractAndPersistAadhaarPhoto(
  scope: MedusaContainer,
  rawResponse: Record<string, unknown>,
  customerIdShort: string,
): Promise<string | null> {
  // Cashfree's offline-Aadhaar verify response is inconsistent about
  // which key carries the face crop. Observed in production:
  //   - rawResponse.photo            → base64 (no data-URL prefix)
  //   - rawResponse.photo_base64     → base64
  //   - rawResponse.face_image       → base64
  //   - rawResponse.photo_link       → either a URL OR a raw base64
  //                                     string. We saw the latter in
  //                                     a real customer response on
  //                                     2026-05-04, so assume nothing.
  // Strategy: collect every candidate value, then sort by "looks like
  // base64" vs "looks like URL". URL = starts with http(s)://.
  const candidates: Array<{ kind: "b64" | "url"; value: string }> = []
  const probe = (v: unknown) => {
    if (typeof v !== "string") return
    const s = v.trim()
    if (!s) return
    if (/^https?:\/\//i.test(s)) candidates.push({ kind: "url", value: s })
    else candidates.push({ kind: "b64", value: s })
  }
  probe(rawResponse.photo)
  probe(rawResponse.photo_base64)
  probe((rawResponse as any).face_image)
  probe(rawResponse.photo_link)
  // Prefer a base64 candidate (one network round-trip cheaper) but
  // fall back to a URL if that's all we have.
  const photoB64 = candidates.find((c) => c.kind === "b64")?.value ?? null
  const photoLink = candidates.find((c) => c.kind === "url")?.value ?? null

  let buffer: Buffer | null = null
  let extension = ".jpg"

  if (photoB64) {
    // Strip a `data:image/...;base64,` prefix if present.
    const dataUrlMatch = photoB64.match(/^data:(image\/[a-z]+);base64,(.*)$/i)
    if (dataUrlMatch) {
      if (dataUrlMatch[1].toLowerCase().includes("png")) extension = ".png"
      buffer = Buffer.from(dataUrlMatch[2], "base64")
    } else {
      try {
        buffer = Buffer.from(photoB64, "base64")
        // Sniff magic bytes — JPEG starts FF D8, PNG starts 89 50 4E 47.
        // Default to .jpg above; bump to .png when bytes match.
        if (
          buffer.length >= 4 &&
          buffer[0] === 0x89 &&
          buffer[1] === 0x50 &&
          buffer[2] === 0x4e &&
          buffer[3] === 0x47
        ) {
          extension = ".png"
        }
      } catch {
        buffer = null
      }
    }
  } else if (photoLink) {
    try {
      const dl = await fetch(photoLink, { method: "GET" })
      if (!dl.ok) throw new Error(`photo_link fetch ${dl.status}`)
      const ab = await dl.arrayBuffer()
      buffer = Buffer.from(ab)
      const ct = (dl.headers.get("content-type") ?? "").toLowerCase()
      if (ct.includes("png")) extension = ".png"
    } catch (err) {
      logger.warn("aadhaar photo fetch failed (non-blocking)", {
        error: (err as Error).message,
      })
      return null
    }
  }

  if (!buffer || buffer.length < 32) {
    // Very small buffers are almost always empty / placeholder — skip
    // to avoid stamping a useless URL onto the customer.
    return null
  }

  try {
    const safeFilename = `aadhaar_photo_${customerIdShort}_${Date.now()}${extension}`
    const saved = await uploadFile({
      originalname: safeFilename,
      buffer,
    })
    return (saved?.url as string) ?? null
  } catch (err) {
    logger.warn("aadhaar photo save failed (non-blocking)", {
      error: (err as Error).message,
    })
    return null
  }
}
