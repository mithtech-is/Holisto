import { model } from "@medusajs/framework/utils"

/**
 * Singleton row holding all Online Visibility Optimization (OVO) configuration.
 *
 * Mirrors a singleton-settings pattern (single
 * row, `singleton_key = "default"`) so the admin UI can use one GET/POST
 * flow regardless of which channels are toggled. The storefront fetches
 * the public projection of this row and uses it to drive every visibility
 * surface — `<title>`, OpenGraph, JSON-LD, robots.txt, sitemap shards,
 * `/llms.txt`, etc.
 *
 * Channel toggles short-circuit the corresponding storefront emission.
 * `master_enabled = false` is the kill switch — every channel is gated
 * on it AND its own per-channel flag.
 *
 * The JSON columns intentionally store loosely-typed shapes — admins
 * iterate on copy faster than the backend can ship migrations, and a
 * jsonb blob lets the admin UI add/remove sub-fields without an ALTER
 * TABLE for every tweak.
 */
export const OvoSetting = model.define("ovo_setting", {
  id: model.id().primaryKey(),
  singleton_key: model.text().default("default"),

  // ── Master + per-channel toggles ─────────────────────────────────
  master_enabled: model.boolean().default(true),
  seo_enabled: model.boolean().default(true),
  geo_enabled: model.boolean().default(true), // Generative Engine Optimization
  aeo_enabled: model.boolean().default(true), // Answer Engine Optimization
  llmo_enabled: model.boolean().default(true), // LLM Optimization (training-data shaping)
  eeo_enabled: model.boolean().default(true), // Entity Engine Optimization
  kgo_enabled: model.boolean().default(true), // Knowledge Graph Optimization
  reo_enabled: model.boolean().default(true), // Retrieval Engine Optimization
  sgeo_enabled: model.boolean().default(true), // Search Generative Experience Optimization

  // ── General / brand identity ─────────────────────────────────────
  /**
   * Drives Organization JSON-LD + meta defaults.
   * Shape:
   *   {
   *     name: string
   *     alt_names: string[]
   *     legal_name: string
   *     slogan: string
   *     description: string
   *     logo_url: string                     // absolute or site-relative
   *     founding_year: string
   *     founding_place: string
   *     parent_org: { name: string; url: string }
   *     contact_points: Array<{
   *       contact_type: string               // "customer support" | "media relations" | ...
   *       telephone?: string
   *       email?: string
   *       area_served?: string
   *       available_language?: string[]
   *       hours?: { days: string[]; opens: string; closes: string }
   *     }>
   *     postal_address: {
   *       street: string; city: string; region: string;
   *       postal_code: string; country: string
   *     }
   *     // Named founders. Emitted as Organization.founder Person
   *     // nodes (KGO signal) AND rendered in the homepage
   *     // FounderStrip — the trust surface every Tier-1 unlisted-
   *     // shares competitor has that we didn't.
   *     founders?: Array<{
   *       name: string
   *       role: string
   *       bio: string
   *       photo_url: string                  // absolute or site-relative
   *       linkedin_url: string
   *     }>
   *     // "As seen in" press wall — homepage PressStrip. Auto-hides
   *     // when empty, so the strip doesn't ship as a stub.
   *     press_mentions?: Array<{
   *       publication: string                // "Economic Times"
   *       headline: string
   *       url: string
   *       date?: string                      // ISO yyyy-mm-dd, optional
   *       logo_url?: string
   *     }>
   *   }
   */
  brand: model.json().nullable(),

  /**
   * Site-wide meta defaults. Shape:
   *   {
   *     title_default: string
   *     title_template: string                // e.g. "%s | <Brand>"
   *     description_fallback: string
   *     keywords: string[]
   *     og_image_url: string | null
   *     twitter_handle: string | null
   *     locale: string                        // "en_IN"
   *   }
   */
  default_meta: model.json().nullable(),

  // ── SEO ──────────────────────────────────────────────────────────
  /**
   * Robots / crawler policy. Shape:
   *   {
   *     disallow_paths: string[]
   *     sitemap_url?: string                  // absolute, defaults to {SITE_URL}/sitemap.xml
   *   }
   */
  robots: model.json().nullable(),

  /**
   * Sitemap shard toggles. Shape:
   *   { static: boolean; products: boolean; taxonomy: boolean; knowledge: boolean }
   */
  sitemap_shards: model.json().nullable(),

  // ── KGO / EEO ────────────────────────────────────────────────────
  /**
   * Entity-graph signals. Shape:
   *   {
   *     same_as: string[]                     // social profile URLs, Wikidata, etc.
   *     knows_about: string[]                 // topic entities
   *     services: Array<{ name: string; description?: string; url?: string }>
   *   }
   */
  entity: model.json().nullable(),

  // ── AEO ──────────────────────────────────────────────────────────
  /**
   * Brand-level FAQPage entries — rendered on pages that explicitly
   * mount `<FaqSchema />` (currently /how-it-works). Targets brand
   * questions ("Is investing in unlisted shares safe?").
   *
   * Shape: Array<{ question: string; answer: string }>
   */
  faq: model.json().nullable(),

  /**
   * Default FAQ for product pages — emitted on every /invest/[id]
   * UNLESS the per-product override sets its own (or the override
   * sets `inherit_default_faq` = true to merge).
   *
   * Shape: Array<{ question: string; answer: string }>
   */
  default_product_faq: model.json().nullable(),

  /**
   * Default FAQ for category pages — same cascade as
   * `default_product_faq` but applied to taxonomy / bucket pages.
   *
   * Shape: Array<{ question: string; answer: string }>
   */
  default_category_faq: model.json().nullable(),

  /**
   * E-E-A-T defaults. Shape:
   *   { author?: string; reviewer?: string; last_updated?: string }
   */
  citations: model.json().nullable(),

  // ── LLMO ─────────────────────────────────────────────────────────
  /**
   * Replaces the static /public/llms.txt + /public/llms-full.txt files.
   * Shape: { short_md: string; full_md: string }
   * Storefront serves these from `/llms.txt` and `/llms-full.txt` as
   * `text/plain`.
   */
  llms_txt: model.json().nullable(),

  /**
   * Per-bot allow/deny policy. Shape:
   *   {
   *     retrieval_bots: "allow" | "deny"
   *     training_bots: "allow" | "deny"
   *     scraper_bots: "allow" | "deny"          // SemrushBot, AhrefsBot, MJ12bot, DotBot
   *     overrides: Record<string, "allow" | "deny">  // per-UA override, e.g. { GPTBot: "deny" }
   *   }
   * Bot taxonomy:
   *   - retrieval: OAI-SearchBot, ChatGPT-User, PerplexityBot, Perplexity-User,
   *                YouBot, Google-Extended
   *   - training:  GPTBot, ClaudeBot, Claude-Web, anthropic-ai, cohere-ai,
   *                Bytespider, meta-externalagent, CCBot, Applebot-Extended,
   *                Amazonbot, DuckAssistBot, Diffbot
   *   - scraper:   SemrushBot, AhrefsBot, MJ12bot, DotBot
   */
  bot_policy: model.json().nullable(),

  // ── REO ──────────────────────────────────────────────────────────
  /**
   * Retrieval-engine hints for downstream RAG consumers. Shape:
   *   {
   *     prefer_h2_breaks: boolean
   *     chunk_size_tokens: number             // hint only; not enforced
   *     emit_jsonl_export: boolean            // v2: enables /store/export.jsonl
   *   }
   */
  retrieval: model.json().nullable(),

  // ── SGEO / GEO ───────────────────────────────────────────────────
  /**
   * Generative-search shaping. Shape:
   *   {
   *     question_intent_keywords: string[]
   *     summary_paragraph: string             // 2-3 sentence canonical answer
   *     source_attribution_text: string       // appended to AI Overview citations
   *   }
   */
  generative: model.json().nullable(),

  // ── External API credentials (AES-256-GCM at rest) ──────────────
  //
  // These let ops paste/rotate keys from `/app/ovo` without redeploys.
  // All three columns store the encrypted blob produced by
  // the OVO crypto helper (system-wide encryption key
  // `AT_REST_ENCRYPTION_KEY`). The admin GET returns only mask+last4;
  // plaintext never leaves the service layer.
  //
  // Lookup contract (service-side): DB row first, env-var fallback.
  // This lets a fresh install use env-only credentials AND lets ops
  // override env at runtime via the admin without restarting the
  // container.

  /** GSC service-account JSON (the whole `client_email + private_key`
   *  object as a single-line string). Encrypted. Read by
   *  `getApiCredentials()` and passed to `parseGscConfig`. */
  gsc_service_account_json_encrypted: model.text().nullable(),

  /** Bing Webmaster API key. Encrypted. */
  bing_webmaster_api_key_encrypted: model.text().nullable(),

  // ── AI-citation provider keys (columns added by Migration20260515300000
  //    / 20260516xxxxxx). Encrypted at rest; read by getApiCredentials()
  //    and used by the AI-citation tracker. These MUST be declared on the
  //    model (not just in the migration) or the generated update silently
  //    drops them on save. ─────────────────────────────────────────────
  /** OpenAI API key (`sk-...`). Encrypted. */
  openai_api_key_encrypted: model.text().nullable(),

  /** Anthropic API key (`sk-ant-...`). Encrypted. */
  anthropic_api_key_encrypted: model.text().nullable(),

  /** Perplexity API key (`pplx-...`). Encrypted. */
  perplexity_api_key_encrypted: model.text().nullable(),

  /** Google AI Studio (Gemini) API key. Encrypted. */
  google_ai_api_key_encrypted: model.text().nullable(),

  // SpaceSerp API key column dropped by Migration20260515220000 —
  // provider was abandoned in 2025; see migration file for context.

  /** Ahrefs API key for keyword-difficulty + search-volume refresh.
   *  Encrypted at rest using the OVO crypto helper.
   *  Optional — keyword tracking works without external difficulty
   *  data; this just enriches the Keywords admin tab. */
  ahrefs_api_key_encrypted: model.text().nullable(),

  /** SEMrush API key — alternative provider for difficulty +
   *  search volume. Encrypted. Same optionality as Ahrefs. */
  semrush_api_key_encrypted: model.text().nullable(),

  // ── Keyword tracking defaults ────────────────────────────────────
  /**
   * Phase 1 keyword-tracking configuration. Shape:
   *   {
   *     default_country: string                // ISO 3166-1 alpha-2, default "IN"
   *     default_language: string               // BCP-47, default "en"
   *     default_difficulty_provider: "ahrefs" | "semrush" | "none"
   *     gsc_property_url: string | null        // sc-domain:your-domain.example or https://your-domain.example
   *     snapshot_window_days: number           // default 28 — dashboard default window
   *     rollup_matching: "exact" | "trigram"   // v1: exact; v2: trigram (pg_trgm)
   *     auto_status_threshold: {               // auto-flip behaviour for `status`
   *       won_position_max: number             // default 10 (top-10 = won)
   *       lost_regression_ranks: number        // default 3 (regress >3 ranks below target = lost)
   *     }
   *     bulk_import_cap: number                // safety cap on CSV row count, default 5000
   *   }
   *
   * Missing keys fall through to hardcoded defaults in the service —
   * adding a key here is a non-breaking change because all consumers
   * use `cfg.keyword_tracking?.X ?? DEFAULT`.
   */
  keyword_tracking: model.json().nullable(),

  /** Audit — id of admin user who last saved. */
  updated_by_user_id: model.text().nullable(),
})
