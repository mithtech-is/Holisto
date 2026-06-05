import { describe, expect, it } from "vitest"
import { DEFAULT_OVO_NEUTRAL } from "../src/modules/online_visibility_optimization/seed/default-ovo-neutral"
import { decryptString, encryptString, last4 } from "../src/modules/online_visibility_optimization/lib/crypto"

describe("OVO package", () => {
  it("uses neutral first-run settings", () => {
    expect(DEFAULT_OVO_NEUTRAL.brand.name).toBe("")
    expect(DEFAULT_OVO_NEUTRAL.brand.legal_name).toBe("")
    expect(DEFAULT_OVO_NEUTRAL.default_meta.keywords).toEqual([])
    expect(JSON.stringify(DEFAULT_OVO_NEUTRAL).toLowerCase()).not.toContain("polemarch")
  })

  it("encrypts, decrypts, and masks credential values", () => {
    process.env.OVO_ENCRYPTION_KEY = "test-key"
    const encrypted = encryptString("secret-value-1234")
    expect(encrypted).not.toContain("secret-value-1234")
    expect(decryptString(encrypted)).toBe("secret-value-1234")
    expect(last4("secret-value-1234")).toBe("1234")
  })
})
