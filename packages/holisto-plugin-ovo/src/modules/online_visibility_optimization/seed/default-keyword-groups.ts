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

export const DEFAULT_KEYWORD_GROUPS: SeedKeywordGroup[] = []
