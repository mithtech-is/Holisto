/**
 * Seed list of Phase 1 keyword groups for OVO.
 *
 * Inserted on first run via `OvoService.seedDefaultKeywordGroupsIfEmpty`
 * when `ovo_seo_keyword_group` is empty. Operators then add / edit
 * from the admin Keywords tab — the seeder never re-runs once a row
 * exists.
 *
 * Why these eight groups: they cover the canonical funnel segments
 * for an Indian unlisted-shares platform without forcing operators
 * to commit to a deeper taxonomy upfront. The seed picks `is_pillar`
 * for the four groups most directly tied to revenue (Brand, Buy
 * intent, Sector, Comparison) so the Groups Performance dashboard's
 * leaderboard surfaces meaningful tiles on day one.
 *
 * Slug convention: kebab-case, lowercase, ASCII only. The DB enforces
 * a partial-unique index on `(slug) WHERE deleted_at IS NULL` so
 * re-seeding after a soft-delete is OK.
 *
 * Hierarchy: this seed is flat. Operators can later drag sub-groups
 * under any parent ("Buy intent / Zepto buy", "Sector / Fintech") via
 * the admin sidebar.
 */

export type SeedKeywordGroup = {
  name: string
  slug: string
  description?: string
  color?: string
  icon?: string
  priority: number
  sort_order: number
  intent?:
    | "transactional"
    | "informational"
    | "commercial"
    | "navigational"
    | "comparison"
  funnel_stage?: "TOFU" | "MOFU" | "BOFU"
  is_pillar?: boolean
  audit_weight?: number
}

export const DEFAULT_KEYWORD_GROUPS: SeedKeywordGroup[] = [
  {
    name: "Brand",
    slug: "brand",
    description:
      "Direct brand queries (polemarch, polemarch app, polemarch login). " +
      "These should ALL rank #1; anything outside top-3 is an incident.",
    color: "rose",
    icon: "Sparkles",
    priority: 1,
    sort_order: 10,
    intent: "navigational",
    funnel_stage: "BOFU",
    is_pillar: true,
    audit_weight: 2.0,
  },
  {
    name: "Buy intent",
    slug: "buy-intent",
    description:
      "High-commercial-intent queries — 'buy zepto unlisted', 'invest in " +
      "oyo pre-ipo', etc. Drives the revenue path.",
    color: "green",
    icon: "ShoppingBag",
    priority: 1,
    sort_order: 20,
    intent: "transactional",
    funnel_stage: "BOFU",
    is_pillar: true,
    audit_weight: 1.5,
  },
  {
    name: "Sector",
    slug: "sector",
    description:
      "Sector-led discovery: 'best fintech unlisted shares', 'top logistics " +
      "pre-ipo'. Feeds the programmatic Sector category pages.",
    color: "purple",
    icon: "Tag",
    priority: 1,
    sort_order: 30,
    intent: "commercial",
    funnel_stage: "MOFU",
    is_pillar: true,
    audit_weight: 1.3,
  },
  {
    name: "Comparison",
    slug: "comparison",
    description:
      "Head-to-head and category-versus queries: 'nse vs bse', " +
      "'nsdl vs cdsl', 'unlisted shares vs mutual funds'.",
    color: "orange",
    icon: "ArrowsRightLeft",
    priority: 1,
    sort_order: 40,
    intent: "comparison",
    funnel_stage: "MOFU",
    is_pillar: true,
    audit_weight: 1.3,
  },
  {
    name: "Tax + legal",
    slug: "tax-legal",
    description:
      "Tax + SEBI + RBI queries. 'tax on unlisted shares', 'sebi rules " +
      "for pre-ipo', 'long-term capital gains on unlisted'.",
    color: "amber",
    icon: "ShieldCheck",
    priority: 2,
    sort_order: 50,
    intent: "informational",
    funnel_stage: "MOFU",
    is_pillar: false,
    audit_weight: 1.0,
  },
  {
    name: "Education",
    slug: "education",
    description:
      "Top-of-funnel explainers — 'what are unlisted shares', 'how do " +
      "pre-ipo investments work', 'is private equity safe for retail'.",
    color: "blue",
    icon: "BookOpen",
    priority: 2,
    sort_order: 60,
    intent: "informational",
    funnel_stage: "TOFU",
    is_pillar: false,
    audit_weight: 1.0,
  },
  {
    name: "News",
    slug: "news",
    description:
      "Newsy / time-sensitive queries: 'nse ipo update', 'oyo ipo date', " +
      "'zepto valuation 2026'. Drives the /news content type.",
    color: "sky",
    icon: "Newspaper",
    priority: 3,
    sort_order: 70,
    intent: "informational",
    funnel_stage: "TOFU",
    is_pillar: false,
    audit_weight: 0.8,
  },
  {
    name: "Tooling",
    slug: "tooling",
    description:
      "Calculator + lookup + how-to-do-X queries that map to /tools " +
      "pages — 'unlisted share calculator', 'how to download cmr'.",
    color: "teal",
    icon: "Calculator",
    priority: 3,
    sort_order: 80,
    intent: "informational",
    funnel_stage: "MOFU",
    is_pillar: false,
    audit_weight: 0.8,
  },
]
