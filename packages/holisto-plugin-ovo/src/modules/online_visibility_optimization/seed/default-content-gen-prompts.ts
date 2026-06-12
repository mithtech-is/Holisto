export type SeedContentGenPrompt = {
  label: string
  kind: "content_gen"
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

export const DEFAULT_CONTENT_GEN_PROMPTS: SeedContentGenPrompt[] = []
