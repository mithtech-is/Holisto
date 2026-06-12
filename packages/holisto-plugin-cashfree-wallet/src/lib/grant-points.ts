/**
 * No-op replacement for the dropped gamification points engine.
 *
 * The KYC / bank / demat / order code paths call `grantPointsForEvent(...)`
 * fire-and-forget. With points removed, this returns an inert result and
 * awards nothing. Self-contained (no module imports) so it builds without
 * the gamification module.
 */
export type GrantArgs = {
  scope: any
  customer_id: string
  event_kind: string
  amount: number
  source: string
  reference_type?: string | null
  reference_id?: string | null
  idempotency_key?: string | null
  note?: string | null
  admin_user_id?: string | null
  event_params?: Record<string, unknown>
}

export type GrantResult = {
  awarded: boolean
  lifetime_points: number
  available_points: number
  new_tier: string | null
  unlocked_achievements: Array<{
    id: string
    code: string
    name: string
    points_reward: number
  }>
  completed_quests: Array<{
    id: string
    code: string
    title: string
    points_reward: number
  }>
}

export async function grantPointsForEvent(
  _args: GrantArgs
): Promise<GrantResult> {
  return {
    awarded: false,
    lifetime_points: 0,
    available_points: 0,
    new_tier: null,
    unlocked_achievements: [],
    completed_quests: [],
  }
}
