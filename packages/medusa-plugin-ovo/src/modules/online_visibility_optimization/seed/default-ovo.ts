/**
 * Default OVO settings.
 *
 * The production default (`DEFAULT_OVO`) is intentionally NEUTRAL: no
 * brand identity, no domain, no prompts. A clean install therefore
 * renders honest "setup-required" / empty states everywhere until the
 * operator fills in their own brand, credentials, and content from the
 * admin UI. There is no hardcoded client data.
 *
 * `DEMO_OVO` is a generic, obviously-fictional example ("Acme Store")
 * used ONLY when demo mode is on (`OVO_DEMO_MODE=true` or the plugin
 * option `demo_mode: true`). It never ships as the real default.
 */

export const DEFAULT_BRAND = {
  name: "",
  alt_names: [] as string[],
  legal_name: "",
  slogan: "",
  description: "",
  logo_url: "",
  founding_year: "",
  founding_place: "",
  parent_org: null as { name: string; url: string } | null,
  contact_points: [] as Array<Record<string, unknown>>,
  postal_address: null as Record<string, unknown> | null,
  founders: [] as Array<Record<string, unknown>>,
  press_mentions: [] as Array<Record<string, unknown>>,
}

export const DEFAULT_META = {
  title_default: "",
  title_template: "%s",
  description_fallback: "",
  keywords: [] as string[],
  og_image_url: null as string | null,
  twitter_handle: null as string | null,
  locale: "en",
}

export const DEFAULT_ROBOTS = {
  disallow_paths: [] as string[],
  sitemap_url: null as string | null,
}

export const DEFAULT_SITEMAP_SHARDS = {
  static: true,
  products: true,
  taxonomy: true,
  knowledge: false,
}

export const DEFAULT_ENTITY = {
  same_as: [] as string[],
  knows_about: [] as string[],
  services: [] as Array<{ name: string; description?: string; url?: string }>,
}

export const DEFAULT_FAQ: Array<{ question: string; answer: string }> = []

export const DEFAULT_CITATIONS = {
  author: null as string | null,
  reviewer: null as string | null,
  last_updated: null as string | null,
}

export const DEFAULT_LLMS_TXT = {
  short_md: "",
  full_md: "",
}

export const DEFAULT_BOT_POLICY = {
  retrieval_bots: "allow" as "allow" | "deny",
  training_bots: "allow" as "allow" | "deny",
  scraper_bots: "deny" as "allow" | "deny",
  overrides: {} as Record<string, "allow" | "deny">,
}

export const DEFAULT_RETRIEVAL = {
  prefer_h2_breaks: true,
  chunk_size_tokens: 512,
  emit_jsonl_export: false,
}

export const DEFAULT_GENERATIVE = {
  question_intent_keywords: [] as string[],
  summary_paragraph: "",
  source_attribution_text: "",
}

/**
 * Neutral production default. Channel toggles default ON (they are just
 * control surfaces — without configured brand/credentials each surface
 * still shows an empty/setup state), but `master_enabled` defaults OFF
 * so the storefront isn't driven by empty settings until the operator
 * opts in.
 */
export const DEFAULT_OVO = {
  master_enabled: false,
  seo_enabled: true,
  geo_enabled: true,
  aeo_enabled: true,
  llmo_enabled: true,
  eeo_enabled: true,
  kgo_enabled: true,
  reo_enabled: true,
  sgeo_enabled: true,
  brand: DEFAULT_BRAND,
  default_meta: DEFAULT_META,
  robots: DEFAULT_ROBOTS,
  sitemap_shards: DEFAULT_SITEMAP_SHARDS,
  entity: DEFAULT_ENTITY,
  faq: DEFAULT_FAQ,
  citations: DEFAULT_CITATIONS,
  llms_txt: DEFAULT_LLMS_TXT,
  bot_policy: DEFAULT_BOT_POLICY,
  retrieval: DEFAULT_RETRIEVAL,
  generative: DEFAULT_GENERATIVE,
}

/**
 * Generic demo settings — used only when demo mode is enabled. "Acme
 * Store" is a deliberately fictional placeholder so it is never mistaken
 * for real client data.
 */
export const DEMO_OVO = {
  ...DEFAULT_OVO,
  master_enabled: true,
  brand: {
    ...DEFAULT_BRAND,
    name: "Acme Store",
    alt_names: ["Acme", "Acme Online"],
    legal_name: "Acme Commerce Inc.",
    slogan: "Everyday essentials, delivered.",
    description:
      "Acme Store is a demo storefront used to showcase the OVO plugin. Replace this with your own brand details.",
  },
  default_meta: {
    ...DEFAULT_META,
    title_default: "Acme Store",
    title_template: "%s | Acme Store",
    description_fallback: "Acme Store — a demo storefront for the OVO plugin.",
    keywords: ["acme", "demo store", "online visibility"],
  },
  entity: {
    same_as: ["https://example.com/acme"],
    knows_about: ["ecommerce", "online visibility optimization"],
    services: [
      {
        name: "Online store",
        description: "Demo product catalogue.",
        url: "https://example.com/",
      },
    ],
  },
  generative: {
    question_intent_keywords: [
      "what is acme store",
      "is acme store reliable",
    ],
    summary_paragraph:
      "Acme Store is a demo brand used to illustrate the OVO plugin's GEO/AEO surfaces.",
    source_attribution_text: "Source: example.com — demo data.",
  },
}
