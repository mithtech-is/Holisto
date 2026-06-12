// @ts-nocheck
import crypto from "node:crypto"

const VERSION = "v1"
const IV_LENGTH = 12
const TAG_LENGTH = 16

function keyFromSecret(secret: string): Buffer {
  if (!secret || secret.length < 16) {
    throw new Error("Communication encryption secret must be at least 16 characters")
  }
  return crypto.createHash("sha256").update(secret).digest()
}

export function encryptSecret(value: string | null | undefined, secret: string): string | null {
  if (value === null || value === undefined || value === "") return null
  const iv = crypto.randomBytes(IV_LENGTH)
  const cipher = crypto.createCipheriv("aes-256-gcm", keyFromSecret(secret), iv)
  const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()])
  const tag = cipher.getAuthTag()
  return [VERSION, iv.toString("base64url"), tag.toString("base64url"), encrypted.toString("base64url")].join(".")
}

export function decryptSecret(value: string | null | undefined, secret: string): string | null {
  if (!value) return null
  const [version, ivRaw, tagRaw, encryptedRaw] = value.split(".")
  if (version !== VERSION || !ivRaw || !tagRaw || !encryptedRaw) {
    throw new Error("Unsupported encrypted secret format")
  }
  const decipher = crypto.createDecipheriv(
    "aes-256-gcm",
    keyFromSecret(secret),
    Buffer.from(ivRaw, "base64url"),
  )
  decipher.setAuthTag(Buffer.from(tagRaw, "base64url"))
  return Buffer.concat([
    decipher.update(Buffer.from(encryptedRaw, "base64url")),
    decipher.final(),
  ]).toString("utf8")
}

export function maskSecret(value: string | null | undefined): string | null {
  if (!value) return null
  if (value.length <= 6) return "***"
  return `${value.slice(0, 3)}***${value.slice(-3)}`
}
