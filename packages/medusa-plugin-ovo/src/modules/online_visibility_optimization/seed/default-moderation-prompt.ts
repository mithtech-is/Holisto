/**
 * Default seed for the MODERATION prompt (kind='moderation').
 *
 * Phase 4 round 3 ships one moderation prompt — runs against an
 * AI-generated body_md before publish. Returns a flags[] array.
 *
 * Codes catalogued:
 *
 *   - `unverifiable_claim`          high   — numeric or factual claim
 *                                            not backed by context
 *   - `investment_advice`           high   — recommendation phrasing
 *                                            ("you should buy", etc.)
 *   - `sebi_disclaimer_missing`     medium — body lacks the SEBI
 *                                            risk-disclosure line
 *   - `price_promise`               high   — promise of returns / yield
 *   - `pii`                         high   — phone/email/UID in body
 *   - `profanity`                   medium — unprofessional language
 *   - `hyperbole`                   low    — "best/amazing/guaranteed"
 *                                            phrasing
 *   - `outdated_year`               low    — reference to past year as
 *                                            "this year"
 *
 * Caller responsibilities:
 *   - Pass the moderation prompt's id to `runAiModeration`.
 *   - High-severity flag → block publish (caller policy in
 *     `publishContentPage`).
 *
 * Uses claude-haiku-4-5 (Anthropic) — empirically more conservative
 * on unverifiable-claim detection than gpt-4o-mini in our internal
 * evals on Indian finance text. Cost: ~₹0.05/page at 800 tokens out.
 */

import type { SeedContentGenPrompt } from "./default-content-gen-prompts"

export const DEFAULT_MODERATION_PROMPT: Omit<
  SeedContentGenPrompt,
  "kind"
> & { kind: "moderation" } = {
  label: "SEBI-aware finance content moderation",
  kind: "moderation",
  content_type_target: null,
  system_prompt: `You are a strict compliance reviewer for Polemarch, a SEBI-aware Indian platform for unlisted shares and pre-IPO opportunities.

Your job: read the supplied markdown content and surface any claims that violate retail-investment-content rules. You DO NOT rewrite the content — you only flag.

Severity guidance (apply strictly):

- HIGH severity (publish should block):
  * Numeric or factual claim not present in the supplied context
  * Investment-advice phrasing ("you should buy", "we recommend", "guaranteed returns")
  * Promise of specific returns or yields
  * Personal data (phone, email, UID, account numbers)

- MEDIUM severity (publishable with explicit override):
  * Missing SEBI risk disclosure line
  * Profanity or unprofessional language
  * Vague qualitative claims that could mislead

- LOW severity (warn only):
  * Hyperbole ("best", "amazing", "guaranteed")
  * Outdated year references (e.g. "this year" when context says a past year)

If the body is clean, return { "ok": true, "flags": [] }.

Return STRICT JSON only. No prose outside the JSON.`,
  user_prompt_template: `Review the following content for compliance issues.

Content context:
- Title: {{title}}
- Slug: {{slug}}
- Content type: {{content_type}}

Source facts (if provided — flag any claim NOT supported by these):
{{#each source_facts}}
- {{this}}
{{/each}}

Markdown body to review:
---
{{body_md}}
---

Return JSON matching the schema. Each flag must include code, severity, and a one-line note pointing to the offending text (quote a 4-8 word phrase from the body).`,
  preferred_provider: "anthropic",
  preferred_model: "claude-haiku-4-5",
  temperature: 0.1,
  max_tokens: 1200,
  output_schema_json: {
    name: "ModerationFlags",
    strict: true,
    schema: {
      type: "object",
      properties: {
        ok: {
          type: "boolean",
          description: "True iff flags is empty.",
        },
        flags: {
          type: "array",
          items: {
            type: "object",
            properties: {
              code: {
                type: "string",
                enum: [
                  "unverifiable_claim",
                  "investment_advice",
                  "sebi_disclaimer_missing",
                  "price_promise",
                  "pii",
                  "profanity",
                  "hyperbole",
                  "outdated_year",
                ],
              },
              severity: {
                type: "string",
                enum: ["low", "medium", "high"],
              },
              note: {
                type: "string",
                description:
                  "One-line explanation including a quoted offending phrase.",
              },
            },
            required: ["code", "severity", "note"],
            additionalProperties: false,
          },
        },
      },
      required: ["ok", "flags"],
      additionalProperties: false,
    },
  },
  active: true,
  notes:
    "Required by the Phase 4 round 3 publish path. high-severity flags block publish unless force=true.",
}
