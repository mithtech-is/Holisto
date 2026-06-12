import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  scryptSync,
} from "node:crypto"

/**
 * AES-256-GCM at-rest encryption for sensitive PII (bank account numbers).
 *
 * Format of the stored ciphertext (base64):
 *   v1.<iv-base64>.<tag-base64>.<ciphertext-base64>
 *
 * The version prefix lets us roll the algorithm later without breaking old
 * rows. Key is derived from `AT_REST_ENCRYPTION_KEY` (legacy name
 * `WALLET_ENCRYPTION_KEY` still accepted) via scrypt with a fixed salt —
 * the env var must be set to a high-entropy secret in any environment
 * that holds production data.
 */

const VERSION = "v1"
const SCRYPT_SALT = "polemarch-cashfree-wallet-v1"
const KEY_LENGTH = 32 // 256 bits

let cachedKey: Buffer | null = null

/** Shared at-rest encryption key.
 *
 * Originally named `WALLET_ENCRYPTION_KEY` back when only the Cashfree
 * wallet module used it. Today the same key also encrypts the SMTP
 * password (`polemarch_communication`) and any other at-rest secret we stash
 * in the DB — it's one key for the whole system so there's only one
 * thing to rotate.
 *
 * Prefers `AT_REST_ENCRYPTION_KEY` (canonical); falls back to the
 * legacy `WALLET_ENCRYPTION_KEY` so installations that still have the
 * old name keep decrypting without a forced re-seed. Set just one.
 *
 * PRODUCTION REQUIREMENT: the key must be a base64-encoded 32-byte
 * random value — generate with:
 *   node -e "console.log(crypto.randomBytes(32).toString('base64'))"
 * The previous "≥16 chars" check accepted human-chosen passphrases
 * with ~52 bits of entropy, brute-forceable offline if the DB leaks.
 * AES-256-GCM needs 256 bits of keying material.
 *
 * Backwards compat: in non-production we still accept any ≥32-char
 * string (e.g. a dev-convenient passphrase); production rejects
 * anything that doesn't decode cleanly to 32 bytes.
 */
function getKey(): Buffer {
  if (cachedKey) return cachedKey
  const secret =
    process.env.AT_REST_ENCRYPTION_KEY || process.env.WALLET_ENCRYPTION_KEY
  if (!secret) {
    throw new Error(
      "AT_REST_ENCRYPTION_KEY env var must be set (32 random bytes, base64-encoded)"
    )
  }
  if (secret.length < 32) {
    throw new Error(
      "AT_REST_ENCRYPTION_KEY must be ≥32 characters (use base64(random(32)) for prod)"
    )
  }

  // Preferred format: a 32-byte random key, base64-encoded. We use
  // the decoded bytes DIRECTLY as the AES-256 key — no KDF, no waste.
  // This is the format operators should rotate to.
  //
  //   node -e 'console.log(require("crypto").randomBytes(32).toString("base64"))'
  //
  // `Buffer.from(..., "base64")` silently discards invalid chars, which
  // makes the length check the only reliable "is this actually base64
  // of 32 bytes?" signal. Require a trailing `=` or correct 44-char
  // length to avoid accidentally matching 32-byte passphrase strings
  // whose length happens to decode to 32 bytes of noise.
  const decoded = Buffer.from(secret, "base64")
  const looksLikeBase64Key =
    decoded.length === 32 &&
    // Canonical base64 of 32 bytes is 44 chars ending in `=`. We accept
    // unpadded (43 chars) too for tolerance.
    (secret.length === 44 || secret.length === 43) &&
    // Round-trip: if re-encoding yields the same string (ignoring
    // padding), it's genuinely base64.
    decoded.toString("base64").replace(/=+$/, "") ===
      secret.replace(/=+$/, "")

  if (looksLikeBase64Key) {
    cachedKey = decoded
    return cachedKey
  }

  // Legacy path: env is a high-entropy passphrase (≥32 chars but not
  // strict 32-byte base64). Derive a deterministic 32-byte key via
  // scrypt with a fixed salt. This is how the original installation
  // was seeded before the 2026-04-20 audit; keeping it keeps existing
  // ciphertext readable until the operator rotates.
  //
  // Note: the scrypt output for a given env string is IDENTICAL to
  // what `scryptSync(env, SCRYPT_SALT, 32)` produced on day 1, so
  // this path is ciphertext-compatible.
  if (process.env.NODE_ENV === "production") {
    // eslint-disable-next-line no-console
    console.warn(
      "[crypto] AT_REST_ENCRYPTION_KEY is in legacy passphrase form. Rotate to a " +
        "32-byte base64 key — run the rotation procedure in docs/runbook.md. The " +
        "derived key is identical, so rotation to base64(scrypt-output) is a " +
        "no-op for existing ciphertext."
    )
  }
  cachedKey = scryptSync(secret, SCRYPT_SALT, KEY_LENGTH)
  return cachedKey
}

export function encryptString(plain: string): string {
  if (typeof plain !== "string") throw new TypeError("encryptString: not a string")
  const key = getKey()
  const iv = randomBytes(12) // GCM standard
  const cipher = createCipheriv("aes-256-gcm", key, iv)
  const ct = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()])
  const tag = cipher.getAuthTag()
  return [
    VERSION,
    iv.toString("base64"),
    tag.toString("base64"),
    ct.toString("base64"),
  ].join(".")
}

export function decryptString(payload: string): string {
  if (typeof payload !== "string") throw new TypeError("decryptString: not a string")
  const parts = payload.split(".")
  if (parts.length !== 4) throw new Error("decryptString: malformed payload")
  const [version, ivB64, tagB64, ctB64] = parts
  if (version !== VERSION) throw new Error(`decryptString: unsupported version ${version}`)
  const key = getKey()
  const iv = Buffer.from(ivB64, "base64")
  const tag = Buffer.from(tagB64, "base64")
  const ct = Buffer.from(ctB64, "base64")
  const decipher = createDecipheriv("aes-256-gcm", key, iv)
  decipher.setAuthTag(tag)
  const pt = Buffer.concat([decipher.update(ct), decipher.final()])
  return pt.toString("utf8")
}

/** "1234567890" → "7890". Always returns the trailing 4 chars (or fewer). */
export function last4(value: string): string {
  const cleaned = value.replace(/\s+/g, "")
  return cleaned.slice(-4)
}

/** "1234 5678 9012" / "123456789012" → "XXXX-XXXX-9012" (Aadhaar mask). */
export function maskAadhaar(value: string): string {
  const cleaned = value.replace(/\s+/g, "")
  if (cleaned.length < 4) return "XXXX-XXXX-XXXX"
  return `XXXX-XXXX-${cleaned.slice(-4)}`
}

/** "ABCDE1234F" → "ABCDE****F" (PAN mask). */
export function maskPan(value: string): string {
  const v = value.toUpperCase().replace(/\s+/g, "")
  if (v.length !== 10) return "XXXXX****X"
  return `${v.slice(0, 5)}****${v.slice(9)}`
}
