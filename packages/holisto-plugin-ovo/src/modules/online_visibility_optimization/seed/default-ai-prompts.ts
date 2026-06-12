/**
 * AI-citation prompt seeds.
 *
 * Production default is EMPTY: a clean install seeds no prompts, so the
 * AI Citation tab shows the honest setup-required state ("Add at least
 * one AI provider key and active prompts.") until the operator adds
 * their own prompts. There is no hardcoded client/industry prompt set.
 *
 * `DEMO_AI_PROMPTS` is a small generic example used only when demo mode
 * is enabled. The categories are purely for grouping in the admin UI.
 */

export type SeedPrompt = {
  prompt: string
  category: "brand-direct" | "category-buy" | "comparison" | "task-flow"
  notes?: string
}

/** Production default — intentionally empty (no fabricated prompts). */
export const DEFAULT_AI_PROMPTS: SeedPrompt[] = []

/** Generic demo prompts — only seeded when demo mode is on. */
export const DEMO_AI_PROMPTS: SeedPrompt[] = [
  {
    prompt: "What is the best online store for everyday essentials?",
    category: "category-buy",
    notes: "Demo prompt — replace with your own category head term.",
  },
  {
    prompt: "Is Holisto reliable and trustworthy?",
    category: "brand-direct",
    notes: "Demo brand-trust check.",
  },
  {
    prompt: "Compare Holisto vs other online retailers",
    category: "comparison",
    notes: "Demo comparison prompt.",
  },
]
