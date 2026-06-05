/**
 * Default seed list of CONTENT-GENERATION prompts (kind='content_gen').
 *
 * Distinct from `default-ai-prompts.ts` (citation tracking) — those
 * are user-side prompts run against AI assistants to MEASURE how
 * they cite us. These prompts INSTRUCT an AI to PRODUCE content for
 * a specific page template.
 *
 * Auto-inserted on first run when no content_gen prompts exist.
 * Operators edit/extend from the admin once seeded.
 *
 * Voice + constraints across all 4:
 *
 *   - Indian retail-investor audience; SEBI-aware
 *   - Avoid hyperbole, avoid investment advice
 *   - Indian numbering (lakh, crore), Indian English
 *   - Strict JSON output (response_format=json_schema)
 *   - Risk + tax disclaimers inline
 *
 * Model defaults pick gpt-4o-mini (cheapest reasonable Indian-English
 * finance content) for routine generation; anthropic claude-haiku-4-5
 * is reserved for moderation passes in Phase 4 round 3.
 *
 * `output_schema_json` is OpenAI's response_format schema shape:
 *   { name, strict, schema: { type, properties, required } }
 */

export type SeedContentGenPrompt = {
  /** Operator-facing label — surfaces in the admin prompt picker. */
  label: string
  kind: "content_gen"
  /** Which content-type the prompt is designed for. Null = any. */
  content_type_target: string | null
  system_prompt: string
  user_prompt_template: string
  preferred_provider: "openai" | "anthropic"
  preferred_model: string
  temperature: number
  max_tokens: number
  output_schema_json: Record<string, unknown>
  active: boolean
  notes?: string
}

/** Shared system prompt — every content_gen call gets this as the
 *  baseline voice + safety policy. Per-template prompts append their
 *  specific instructions in `user_prompt_template`. */
const SHARED_SYSTEM_PROMPT = `You are an expert Indian retail-investment writer for Polemarch, a SEBI-aware platform for unlisted shares and pre-IPO opportunities. You write clear, factually careful, regulatory-disclosure-savvy explainers for retail Indian investors.

Rules — observe all:
- Indian English. Indian numbering: lakh (1,00,000), crore (1,00,00,000).
- Numbers, dates, prices come from the supplied context. Never invent figures.
- No investment advice. Frame as information + risk-flagged context.
- Always include a one-line SEBI risk disclosure: "Unlisted shares are illiquid and carry capital loss risk. This is informational, not investment advice."
- Avoid hyperbole ("amazing", "guaranteed", "best ever"). Stay neutral.
- Markdown body. Use H2 sections, short paragraphs, bullet lists where helpful.
- Return STRICT JSON matching the supplied schema. No prose outside the JSON.`

/** Reusable JSON-schema fragments — keeps the seed compact. */
const BASE_OUTPUT_PROPS = {
  title: {
    type: "string",
    description: "50-60 chars. Includes primary keyword.",
  },
  excerpt: {
    type: "string",
    description: "140-160 chars. Marketing summary.",
  },
  body_md: {
    type: "string",
    description: "Markdown body. 800-1400 words.",
  },
  faq: {
    type: "array",
    items: {
      type: "object",
      properties: {
        question: { type: "string" },
        answer: { type: "string" },
      },
      required: ["question", "answer"],
      additionalProperties: false,
    },
    description: "4-6 retail-investor FAQs.",
  },
  ai_summary: {
    type: "string",
    description:
      "2-3 sentences, neutral. Used in /llm.txt + related-content rails.",
  },
} as const

const REQUIRED_FIELDS = [
  "title",
  "excerpt",
  "body_md",
  "faq",
  "ai_summary",
] as const

export const DEFAULT_CONTENT_GEN_PROMPTS: SeedContentGenPrompt[] = [
  /* ── Comparison page ─────────────────────────────────────────── */
  {
    label: "Comparison page (A vs B)",
    kind: "content_gen",
    content_type_target: "comparison",
    system_prompt: SHARED_SYSTEM_PROMPT,
    user_prompt_template: `Write a comparison page: "{{entity_a.name}} vs {{entity_b.name}}".

Subject A — {{entity_a.name}}
- Description: {{entity_a.description}}
- Sector: {{entity_a.sector}}
- Last known valuation: ₹{{entity_a.valuation_inr_cr}} Cr
- Founded: {{entity_a.founded_year}}

Subject B — {{entity_b.name}}
- Description: {{entity_b.description}}
- Sector: {{entity_b.sector}}
- Last known valuation: ₹{{entity_b.valuation_inr_cr}} Cr
- Founded: {{entity_b.founded_year}}

Template-rendered draft (for reference; rewrite freely):
---
{{template_body_md}}
---

Structure the body_md with these H2 sections in order:
1. At a glance — 1-paragraph framing
2. Business model & sector — how each company makes money
3. Valuation & key ratios — last round, multiples, growth trajectory
4. Liquidity & demat process — how a retail investor can actually buy
5. Risks & disclosures — sector + company-specific risks

Include a comparison table inside body_md (markdown pipe table) with 6-8 rows.`,
    preferred_provider: "openai",
    preferred_model: "gpt-4o-mini",
    temperature: 0.3,
    max_tokens: 2400,
    output_schema_json: {
      name: "ComparisonPage",
      strict: true,
      schema: {
        type: "object",
        properties: {
          ...BASE_OUTPUT_PROPS,
          verdict: {
            type: "string",
            description:
              "1-2 sentence neutral framing — NOT a recommendation.",
          },
        },
        required: [...REQUIRED_FIELDS, "verdict"],
        additionalProperties: false,
      },
    },
    active: true,
    notes:
      "Used by /compare/[slug] template generation. Reverse-order slugs 301 to the alphabetical canonical.",
  },

  /* ── Category page (best-{sector}-...) ───────────────────────── */
  {
    label: "Category landing (sector / theme)",
    kind: "content_gen",
    content_type_target: "category",
    system_prompt: SHARED_SYSTEM_PROMPT,
    user_prompt_template: `Write a category landing page: "Best {{sector}} unlisted shares in India {{current_year}}".

Sector: {{sector}}
Top companies in this sector (sorted by last-known valuation):
{{#each top_companies}}
- {{this.name}} — ₹{{this.valuation_inr_cr}} Cr (sector: {{../sector}})
{{/each}}

Template-rendered draft (rewrite freely):
---
{{template_body_md}}
---

Structure body_md with these H2 sections:
1. Why {{sector}} unlisted shares matter in {{current_year}}
2. The top {{top_companies.length}} {{sector}} unlisted names — one H3 per company
3. How {{sector}} valuations are set — multiples + comparables
4. How to buy {{sector}} unlisted shares on Polemarch
5. Risks specific to {{sector}}

Each H3 company section: 2-3 sentences + a "[View {{name}} →](/invest/{{handle}})" link.`,
    preferred_provider: "openai",
    preferred_model: "gpt-4o-mini",
    temperature: 0.35,
    max_tokens: 3000,
    output_schema_json: {
      name: "CategoryLanding",
      strict: true,
      schema: {
        type: "object",
        properties: {
          ...BASE_OUTPUT_PROPS,
          suggested_keywords: {
            type: "array",
            items: { type: "string" },
            description: "6-10 long-tail variations.",
          },
        },
        required: [...REQUIRED_FIELDS, "suggested_keywords"],
        additionalProperties: false,
      },
    },
    active: true,
    notes:
      "Used by best-{sector}-unlisted-shares template. Expects calcula-resolved top_companies list.",
  },

  /* ── Valuation page (single company narrative) ────────────────── */
  {
    label: "Valuation page (per-company narrative)",
    kind: "content_gen",
    content_type_target: "valuation",
    system_prompt: SHARED_SYSTEM_PROMPT,
    user_prompt_template: `Write the narrative thesis + risks section for the {{company_name}} valuation page.

Company facts (authoritative — do not contradict):
- Name: {{company_name}}
- ISIN: {{isin}}
- Sector: {{sector}}
- Latest valuation: ₹{{latest_valuation_inr}} Cr ({{valuation_methodology}})
- Valuation date: {{valuation_date}}
- 52-week range: {{price_low}}–{{price_high}}

Template-rendered draft (rewrite freely):
---
{{template_body_md}}
---

Output two markdown sections concatenated in body_md:

## Investment thesis
(3-4 paragraphs — why this name matters in the sector, growth drivers, comparable benchmarks. Cite the supplied figures. End with the SEBI risk disclosure line.)

## Risks & disclosures
(3-5 specific risks — regulatory, liquidity, sector, governance. One bullet each.)

Note: facts (valuation, ISIN, dates) render from Calcula at page-render time. Your job is the narrative.`,
    preferred_provider: "openai",
    preferred_model: "gpt-4o-mini",
    temperature: 0.25,
    max_tokens: 2200,
    output_schema_json: {
      name: "ValuationNarrative",
      strict: true,
      schema: {
        type: "object",
        properties: {
          ...BASE_OUTPUT_PROPS,
          analyst_rating: {
            type: "string",
            enum: [
              "watchlist",
              "below_radar",
              "high_conviction",
              "hold",
              "avoid",
            ],
            description:
              "Operator-style tagging. NOT shown to readers as a recommendation.",
          },
        },
        required: [...REQUIRED_FIELDS, "analyst_rating"],
        additionalProperties: false,
      },
    },
    active: true,
    notes:
      "Narrative-only. ValuationPage stores thesis_md + risks_md; facts live in Calcula.",
  },

  /* ── Tool landing (calculator / lookup explainer) ─────────────── */
  {
    label: "Tool landing (calculator / lookup)",
    kind: "content_gen",
    content_type_target: "tool",
    system_prompt: SHARED_SYSTEM_PROMPT,
    user_prompt_template: `Write the landing page for the {{tool_name}} tool.

Tool details:
- Name: {{tool_name}}
- Type: {{tool_type}}
- Purpose: {{tool_description}}

Template-rendered draft (rewrite freely):
---
{{template_body_md}}
---

The interactive form embeds below your content. Structure body_md as:
1. H1 already set by the template — start at H2.
2. ## What this tool does — 1 paragraph, plain English.
3. ## When to use it — 2-3 use cases, each a short paragraph.
4. ## How to interpret the result — explain the output number / category.
5. ## Tax + regulatory context — relevant Indian tax/SEBI notes; flag uncertainty.

Tone: practical, not promotional. Treat this as a help-doc, not marketing.`,
    preferred_provider: "openai",
    preferred_model: "gpt-4o-mini",
    temperature: 0.3,
    max_tokens: 1800,
    output_schema_json: {
      name: "ToolLanding",
      strict: true,
      schema: {
        type: "object",
        properties: BASE_OUTPUT_PROPS,
        required: [...REQUIRED_FIELDS],
        additionalProperties: false,
      },
    },
    active: true,
    notes: "Used by /tools/[slug] template generation.",
  },
]
