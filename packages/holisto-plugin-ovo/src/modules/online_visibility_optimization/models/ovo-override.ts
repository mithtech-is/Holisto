import { model } from "@medusajs/framework/utils"

/**
 * Per-entity OVO overrides — extends the singleton `ovo_setting` row
 * with per-product / per-category customisation.
 *
 * Site-wide defaults live in `ovo_setting`. When the storefront
 * renders a specific product or category page, it first looks up the
 * override row via `(entity_type, entity_id)` and merges the override
 * fields on top of the defaults. Any field set to `null`/empty falls
 * through to the site-wide default.
 *
 * Currently supported entity types:
 *   - "product"  — keyed by Medusa Product `id` (preferred) or `handle`
 *   - "category" — keyed by ProductCategory `id` or `handle`
 *
 * The unique index on `(entity_type, entity_id)` enforces one override
 * row per entity. Soft-deletes via `deleted_at` so revoking an
 * override is reversible.
 */
export const OvoOverride = model
  .define("ovo_override", {
    id: model.id().primaryKey(),

    /** "product" | "category" — kept loose so future entity types
     *  (knowledge article, glossary term) can join without a schema
     *  migration. Validation lives in the service. */
    entity_type: model.text(),

    /** Stable id for the entity. For products and categories we use
     *  the Medusa-generated id (prefixed `prod_…` / `pcat_…`) for
     *  uniqueness; the admin widget passes it from the page context. */
    entity_id: model.text(),

    // ── Meta overrides ─────────────────────────────────────────────
    /** Replaces the default page title (still wrapped by the OVO
     *  `title_template`). Empty/null = use auto-derived title. */
    seo_title: model.text().nullable(),
    /** Replaces the default meta description. */
    seo_description: model.text().nullable(),
    /** Custom OG image — absolute or site-relative. */
    og_image_url: model.text().nullable(),
    /** Override canonical URL (rare; usually let Next derive it). */
    canonical_url: model.text().nullable(),
    /** Per-page keywords — merged with site-wide defaults if set. */
    keywords: model.json().nullable(),

    // ── Indexing controls ──────────────────────────────────────────
    /** Marks the page as `noindex,follow` — useful for thin/legacy
     *  product pages that shouldn't compete in search. */
    noindex: model.boolean().default(false),

    // ── AEO ────────────────────────────────────────────────────────
    /** Per-page FAQ JSON-LD entries. Shape: `[{ question, answer }]`.
     *  Default behaviour is to replace the site-wide FAQ; if
     *  `inherit_site_faq` is true, the storefront emits site-wide +
     *  override merged. */
    faq: model.json().nullable(),
    /** When true, storefront concats the type-appropriate DEFAULT
     *  FAQ + this override's FAQ before emitting FAQPage JSON-LD.
     *  - product overrides → merges with `ovo_setting.default_product_faq`
     *  - category overrides → merges with `ovo_setting.default_category_faq`
     *  - page overrides → merges with `ovo_setting.faq` (brand-level)
     *  Default false = override REPLACES the default. Lets admins add a
     *  few entity-specific Q/As without duplicating common ones. */
    inherit_default_faq: model.boolean().default(false),

    // ── GEO/SGE ────────────────────────────────────────────────────
    /** Page-specific canonical summary paragraph. */
    summary_paragraph: model.text().nullable(),

    // ── E-E-A-T ────────────────────────────────────────────────────
    /** Page-specific author/reviewer attribution. Falls back to OVO
     *  citations defaults. */
    author: model.text().nullable(),
    reviewer: model.text().nullable(),
    /** ISO date string (YYYY-MM-DD). Drives the visible "Last updated"
     *  line + Article JSON-LD `dateModified`. */
    last_updated: model.text().nullable(),

    // ── Arbitrary JSON-LD ──────────────────────────────────────────
    /**
     * Raw schema.org JSON-LD blocks the storefront emits verbatim
     * inside `<script type="application/ld+json">` tags on this
     * entity's page. Use for HowTo, Event, Recipe, Article
     * supplements, Course, Dataset, or any schema we don't generate
     * structurally.
     *
     * Shape: an array of objects. Each object becomes its own
     * `<script>` tag. Validation on save: each entry must be a
     * non-null object with at least `@type` (and ideally `@context`)
     * — the API handler's zod schema enforces this.
     *
     * Example value:
     *   [
     *     { "@context": "https://schema.org", "@type": "HowTo",
     *       "name": "How to buy unlisted shares", "step": [...] },
     *     { "@context": "https://schema.org", "@type": "Event",
     *       "name": "AGM 2026", "startDate": "2026-09-15" }
     *   ]
     */
    custom_json_ld: model.json().nullable(),
    /** When true, storefront also emits the type-appropriate default
     *  custom JSON-LD blocks alongside this entity's blocks. Reserved
     *  for future site-level default JSON-LD; today this flag is
     *  harmless either way. */
    inherit_default_json_ld: model.boolean().default(false),

    /** Audit — id of admin user who last saved. */
    updated_by_user_id: model.text().nullable(),
  })
  .indexes([
    {
      // Enforce one override per (entity_type, entity_id). Service
      // upserts use this as the conflict target.
      on: ["entity_type", "entity_id"],
      unique: true,
      where: "deleted_at IS NULL",
    },
    {
      // Point-lookup index — every storefront product/category render
      // hits this. The unique index above could serve too, but a
      // dedicated single-column lookup pattern is what the service
      // queries most often.
      on: ["entity_type", "entity_id"],
      where: "deleted_at IS NULL",
    },
  ])
