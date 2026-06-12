/**
 * Symmetric encryption for OVO credential columns.
 *
 * Replaces the original host-app wallet-module crypto dependency with a
 * self-contained AES-256-GCM implementation so the plugin carries no
 * cross-module coupling. The key is derived from `OVO_ENCRYPTION_KEY`.
 *
 * Ciphertext format (versioned so we can rotate the scheme later):
 *
 *     v1:<ivHex>:<authTagHex>:<cipherHex>
 *
 * `decryptString` throws on a malformed / wrong-key blob; every caller
 * in the service wraps it in try/catch and falls back to the env var,
 * so a corrupt column never 500s a request or crashes a cron.
 */
import crypto from "crypto"

const ALGO = "aes-256-gcm"
const VERSION = "v1"
// Fixed salt is fine here: the secret entropy lives in OVO_ENCRYPTION_KEY,
// and a per-value random salt would have to be stored alongside the IV
// anyway. Rotating the salt is a v2 concern.
const SALT = "medusa-plugin-ovo::v1"

let warned = false

/**
 * Derive a stable 32-byte key from OVO_ENCRYPTION_KEY. When the env var
 * is absent we fall back to a constant dev key and warn once — this
 * keeps local/demo installs usable, but production MUST set the env var
 * (documented in the README) for the encryption to be meaningful.
 */
function getKey(): Buffer {
  const secret = process.env.OVO_ENCRYPTION_KEY
  if (!secret) {
    if (!warned) {
      warned = true
      // eslint-disable-next-line no-console
      console.warn(
        "[ovo] OVO_ENCRYPTION_KEY is not set — credentials are encrypted " +
          "with an insecure development key. Set OVO_ENCRYPTION_KEY in " +
          "production.",
      )
    }
    return crypto.scryptSync("ovo-insecure-dev-key", SALT, 32)
  }
  return crypto.scryptSync(secret, SALT, 32)
}

export function encryptString(plaintext: string): string {
  const iv = crypto.randomBytes(12)
  const cipher = crypto.createCipheriv(ALGO, getKey(), iv)
  const enc = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ])
  const tag = cipher.getAuthTag()
  return `${VERSION}:${iv.toString("hex")}:${tag.toString("hex")}:${enc.toString(
    "hex",
  )}`
}

export function decryptString(blob: string): string {
  const parts = blob.split(":")
  if (parts.length !== 4 || parts[0] !== VERSION) {
    throw new Error("ovo_crypto_malformed_ciphertext")
  }
  const [, ivHex, tagHex, dataHex] = parts
  const decipher = crypto.createDecipheriv(
    ALGO,
    getKey(),
    Buffer.from(ivHex, "hex"),
  )
  decipher.setAuthTag(Buffer.from(tagHex, "hex"))
  const dec = Buffer.concat([
    decipher.update(Buffer.from(dataHex, "hex")),
    decipher.final(),
  ])
  return dec.toString("utf8")
}

/** Last 4 chars of a plaintext value, for drift detection in the UI. */
export function last4(value: string): string {
  if (!value) return ""
  return value.slice(-4)
}
