/**
 * Canonical list of search-intent buckets, shared by the keyword API
 * routes (for zod enum validation) and the classifier. Kept in its own
 * tiny module so route files can import the values without pulling in
 * the full classifier implementation.
 *
 * The `as const` tuple shape is what `z.enum(INTENT_VALUES)` expects.
 */
export const INTENT_VALUES = [
  "informational",
  "navigational",
  "transactional",
  "commercial",
] as const

export type SearchIntent = (typeof INTENT_VALUES)[number]
