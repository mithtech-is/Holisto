import { model } from "@medusajs/framework/utils"

/**
 * Funnel-staged bucket for keyword targets. Replaces the flat
 * `(url, keyword)` list with a hierarchical taxonomy so operators can
 * track performance per intent / funnel-stage / sector / campaign.
 *
 * Examples:
 *   - "Brand"           (BOFU, pillar)   → <brand name>, <brand> app
 *   - "Buy intent"      (BOFU)           → buy zepto unlisted, buy oyo unlisted
 *     ├── "Zepto buy"   (BOFU)
 *     └── "OYO buy"     (BOFU)
 *   - "Tax + legal"     (MOFU)           → tax on unlisted shares, sebi rules
 *   - "Comparison"      (MOFU)           → nse vs bse, nsdl vs cdsl
 *   - "Education"       (TOFU)           → what are unlisted shares
 *   - "Sector"          (MOFU)           → best fintech unlisted
 *   - "News"            (TOFU)           → nse ipo update, oyo ipo date
 *
 * Hierarchy via `parent_group_id` — supports L1 → L2 → L3 nesting so
 * "Buy intent / Zepto buy" can roll up into "Buy intent" in dashboards.
 *
 * `audit_weight` multiplies the group's contribution to the overall
 * site-quality score in the audit dashboard — pillar groups can be
 * weighted 2× while long-tail experimental groups stay at 1×.
 *
 * `is_pillar` flags topical pillars whose performance gets surfaced
 * on the Groups Performance dashboard's leaderboard. Non-pillar
 * groups still chart but don't compete for the top tile.
 */
export const OvoSeoKeywordGroup = model.define("ovo_seo_keyword_group", {
  id: model.id().primaryKey(),

  /** Display name shown in the admin sidebar. Operator-edited;
   *  doesn't have to be SEO-friendly. */
  name: model.text(),

  /** Stable URL-safe identifier. Used in admin deep-links
   *  (`/app/ovo?tab=keywords&group=:slug`) and in any future public
   *  surface where a group becomes a content cluster hub. */
  slug: model.text(),

  /** Optional one-liner shown as a tooltip / drawer header. */
  description: model.text().nullable(),

  /** Tailwind-compatible accent color (e.g. "emerald", "amber",
   *  "rose") for visual grouping in tree + chart legend. */
  color: model.text().nullable(),

  /** Lucide icon name (e.g. "Target", "Tag", "Sparkles"). */
  icon: model.text().nullable(),

  /** Soft self-reference for hierarchy. Null = top-level group.
   *  Not a hard FK — we resolve in the service to avoid cascade
   *  surprises when an operator deletes a parent. */
  parent_group_id: model.text().nullable(),

  /** 1 = highest sort weight (pillar / brand), 5 = long tail. Drives
   *  default ordering in the sidebar. Operators can override per-group
   *  via `sort_order`. */
  priority: model.number().default(2),

  /** Manual sort position within the same parent. Higher = lower in
   *  list. Drag-reorder in admin updates this. */
  sort_order: model.number().default(0),

  /** Search intent classification — informs prompt selection when
   *  the AI content pipeline drafts pages targeting this group.
   *  One of: "transactional" | "informational" | "commercial" |
   *  "navigational" | "comparison". */
  intent: model.text().nullable(),

  /** Marketing-funnel position. One of: "TOFU" | "MOFU" | "BOFU".
   *  Drives the Groups Performance dashboard's funnel breakdown
   *  and biases internal-link scoring (TOFU → MOFU links over
   *  TOFU → TOFU loops). */
  funnel_stage: model.text().nullable(),

  /** Pillar groups surface on the leaderboard tile + get auto-link
   *  preference. Operator-curated rather than computed. */
  is_pillar: model.boolean().default(false),

  /** Multiplier for the group's contribution to the overall
   *  site-quality score in the OVO audit. 1.0 = default, 2.0 =
   *  doubled weight, 0.5 = de-emphasised. Bounded [0.1, 5.0] at
   *  the service layer. */
  audit_weight: model.number().default(1),
})
