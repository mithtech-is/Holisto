import type { SeedContentGenPrompt } from "./default-content-gen-prompts"

export const DEFAULT_MODERATION_PROMPT: Omit<
  SeedContentGenPrompt,
  "kind"
> & { kind: "moderation" } | null = null;
