import assert from "node:assert/strict"
import test from "node:test"

test("encrypts secrets at rest and decrypts with the same key", async () => {
  const { decryptSecret, encryptSecret, maskSecret } = await import("../src/modules/communication/utils/crypto.ts")
  const secret = "a-long-test-encryption-key"
  const encrypted = encryptSecret("provider-token", secret)
  assert.notEqual(encrypted, "provider-token")
  assert.equal(decryptSecret(encrypted, secret), "provider-token")
})

test("masks visible secret values", async () => {
  const { maskSecret } = await import("../src/modules/communication/utils/crypto.ts")
  assert.equal(maskSecret("abcdef123456"), "abc***456")
  assert.equal(maskSecret("abc"), "***")
})

test("encryption with empty value returns null", async () => {
  const { encryptSecret } = await import("../src/modules/communication/utils/crypto.ts")
  assert.equal(encryptSecret(null, "test-key-16-chars!"), null)
  assert.equal(encryptSecret("", "test-key-16-chars!"), null)
  assert.equal(encryptSecret(undefined, "test-key-16-chars!"), null)
})

test("decryption with null value returns null", async () => {
  const { decryptSecret } = await import("../src/modules/communication/utils/crypto.ts")
  assert.equal(decryptSecret(null, "test-key-16-chars!"), null)
  assert.equal(decryptSecret(undefined, "test-key-16-chars!"), null)
})

test("different keys produce different ciphertexts", async () => {
  const { encryptSecret } = await import("../src/modules/communication/utils/crypto.ts")
  const value = "my-secret-value"
  const encrypted1 = encryptSecret(value, "key-one-16-chars!!")
  const encrypted2 = encryptSecret(value, "key-two-16-chars!!")
  assert.notEqual(encrypted1, encrypted2)
})

test("throws on invalid encrypted format", async () => {
  const { decryptSecret } = await import("../src/modules/communication/utils/crypto.ts")
  assert.throws(() => decryptSecret("invalid-format", "test-key-16-chars!"), /Unsupported encrypted secret format/)
  assert.throws(() => decryptSecret("v1.abc", "test-key-16-chars!"), /Unsupported encrypted secret format/)
})
