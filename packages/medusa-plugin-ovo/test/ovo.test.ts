import { describe, it, expect, beforeEach, afterEach } from "vitest"

import {
  encryptString,
  decryptString,
  last4,
} from "../src/modules/online_visibility_optimization/lib/crypto"
import { extractSignals } from "../src/modules/online_visibility_optimization/lib/ai-citation/extract"
import { classifyIntent } from "../src/modules/online_visibility_optimization/lib/intent-classifier"
import { INTENT_VALUES } from "../src/modules/online_visibility_optimization/lib/intent"
import { isDemoMode } from "../src/modules/online_visibility_optimization/lib/options"
import {
  DEFAULT_OVO,
  DEMO_OVO,
} from "../src/modules/online_visibility_optimization/seed/default-ovo"
import {
  DEFAULT_AI_PROMPTS,
  DEMO_AI_PROMPTS,
} from "../src/modules/online_visibility_optimization/seed/default-ai-prompts"
import { resolveDefaultSiteUrl } from "../src/modules/online_visibility_optimization/lib/site"

describe("crypto (credential encryption)", () => {
  beforeEach(() => {
    process.env.OVO_ENCRYPTION_KEY = "test-key-please-rotate"
  })
  afterEach(() => {
    delete process.env.OVO_ENCRYPTION_KEY
  })

  it("round-trips a value", () => {
    const secret = '{"type":"service_account","private_key":"abc"}'
    const enc = encryptString(secret)
    expect(enc).not.toContain("service_account")
    expect(enc.startsWith("v1:")).toBe(true)
    expect(decryptString(enc)).toBe(secret)
  })

  it("masks with last4 only", () => {
    expect(last4("supersecret-AB12")).toBe("AB12")
    expect(last4("")).toBe("")
  })

  it("throws on a tampered/foreign ciphertext (caller falls back)", () => {
    expect(() => decryptString("not-a-valid-blob")).toThrow()
  })
})

describe("AI citation signal extraction is brand-driven (never hardcoded)", () => {
  const answer =
    "1. Acme Store is a great option. Visit acme.com. Competitors include Globex."

  it("reports no brand mention when no brand is configured", () => {
    const s = extractSignals(answer)
    expect(s.mentions_brand).toBe(false)
    expect(s.links_brand).toBe(false)
  })

  it("detects the configured brand + domain + competitors + rank", () => {
    const s = extractSignals(answer, {
      name: "Acme Store",
      aliases: ["Acme"],
      domains: ["acme.com"],
      competitors: [{ canonical: "Globex", aliases: ["globex"] }],
    })
    expect(s.mentions_brand).toBe(true)
    expect(s.links_brand).toBe(true)
    expect(s.position).toBe(1)
    expect(s.competitor_mentions).toContain("Globex")
  })

  it("does not falsely match a different brand", () => {
    const s = extractSignals("Globex is the best.", {
      name: "Acme Store",
      aliases: [],
      domains: ["acme.com"],
      competitors: [],
    })
    expect(s.mentions_brand).toBe(false)
  })
})

describe("intent classifier", () => {
  it("classifies into the canonical buckets", () => {
    expect(classifyIntent("buy running shoes").intent).toBe("transactional")
    expect(classifyIntent("best running shoes").intent).toBe("commercial")
    expect(classifyIntent("what is a running shoe").intent).toBe(
      "informational",
    )
    expect(classifyIntent("login").intent).toBe("navigational")
  })

  it("INTENT_VALUES covers the four buckets", () => {
    expect([...INTENT_VALUES].sort()).toEqual(
      ["commercial", "informational", "navigational", "transactional"].sort(),
    )
  })
})

describe("demo mode is off by default (no fabricated data on clean install)", () => {
  afterEach(() => {
    delete process.env.OVO_DEMO_MODE
  })

  it("defaults to false", () => {
    delete process.env.OVO_DEMO_MODE
    expect(isDemoMode()).toBe(false)
  })

  it("honours OVO_DEMO_MODE=true", () => {
    process.env.OVO_DEMO_MODE = "true"
    expect(isDemoMode()).toBe(true)
  })
})

describe("neutral seeds (no hardcoded client identity)", () => {
  it("DEFAULT_OVO ships an empty brand and master switch off", () => {
    expect(DEFAULT_OVO.brand.name).toBe("")
    expect(DEFAULT_OVO.brand.legal_name).toBe("")
    expect(DEFAULT_OVO.master_enabled).toBe(false)
    expect(DEFAULT_OVO.robots.sitemap_url).toBeNull()
  })

  it("DEFAULT_AI_PROMPTS is empty so the AI Citation tab shows setup-required", () => {
    expect(DEFAULT_AI_PROMPTS).toHaveLength(0)
  })

  it("demo seeds are generic (Acme), never a real client", () => {
    expect(DEMO_OVO.brand.name).toBe("Acme Store")
    expect(DEMO_AI_PROMPTS.length).toBeGreaterThan(0)
  })

  it("no seed contains the original Polemarch identity", () => {
    const blob = JSON.stringify({ DEFAULT_OVO, DEMO_OVO, DEMO_AI_PROMPTS })
    expect(blob.toLowerCase()).not.toContain("polemarch")
    expect(blob.toLowerCase()).not.toContain("mithtech innovative")
  })
})

describe("resolveDefaultSiteUrl reads only env (no hardcoded host)", () => {
  afterEach(() => {
    delete process.env.OVO_SITE_URL
    delete process.env.NEXT_PUBLIC_SITE_URL
    delete process.env.STOREFRONT_URL
  })

  it("returns '' when nothing is configured", () => {
    expect(resolveDefaultSiteUrl()).toBe("")
  })

  it("prefers OVO_SITE_URL", () => {
    process.env.OVO_SITE_URL = "https://shop.example"
    expect(resolveDefaultSiteUrl()).toBe("https://shop.example")
  })
})
