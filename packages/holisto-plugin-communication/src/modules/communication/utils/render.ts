// @ts-nocheck
export type RenderContext = Record<string, unknown>

const BRAND_ALIASES: Record<string, string> = {
  brand: "brand.brand_name",
  company_name: "brand.company_name",
  storefront_url: "brand.storefront_url",
  tagline: "brand.tagline",
  support_email: "brand.support_email",
  support_phone: "brand.support_phone",
  address: "brand.address",
  whatsapp_bot: "brand.whatsapp_bot_label",
}

export function readPath(input: RenderContext, rawPath: string): unknown {
  const path = BRAND_ALIASES[rawPath] ?? rawPath
  return path.split(".").reduce<unknown>((current, segment) => {
    if (current === null || current === undefined) return undefined
    if (typeof current !== "object") return undefined
    return (current as Record<string, unknown>)[segment]
  }, input)
}

export function renderTemplate(
  template: string,
  context: RenderContext,
  options: { keepUnknown?: boolean } = {},
): string {
  return String(template ?? "").replace(/\{\{\s*([^{}]+?)\s*\}\}/g, (match, key) => {
    const normalized = String(key).trim()
    if (/^\d+$/.test(normalized)) return match
    const value = readPath(context, normalized)
    if (value === undefined || value === null) {
      return options.keepUnknown ? match : ""
    }
    return String(value)
  })
}

export function renderJsonTemplate<T>(value: T, context: RenderContext): T {
  if (typeof value === "string") {
    return renderTemplate(value, context, { keepUnknown: true }) as T
  }
  if (Array.isArray(value)) {
    return value.map((entry) => renderJsonTemplate(entry, context)) as T
  }
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {}
    for (const [key, entry] of Object.entries(value)) {
      out[key] = renderJsonTemplate(entry, context)
    }
    return out as T
  }
  return value
}

export function extractVariables(template: string): string[] {
  const found = new Set<string>()
  String(template ?? "").replace(/\{\{\s*([^{}]+?)\s*\}\}/g, (_match, key) => {
    const normalized = String(key).trim()
    if (!/^\d+$/.test(normalized)) found.add(normalized)
    return ""
  })
  return [...found].sort()
}
