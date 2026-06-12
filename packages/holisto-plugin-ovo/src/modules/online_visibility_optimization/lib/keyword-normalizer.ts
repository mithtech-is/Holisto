/**
 * Canonical keyword normalisation. Used by:
 *
 *   1. `OvoService.upsertKeywordTarget` — sets `normalized_keyword`
 *      on every write so the unique index `(normalized_keyword,
 *      target_country, language)` can dedup operator typos
 *      ("Unlisted Shares" vs "unlisted shares" vs "unlisted  shares").
 *
 *   2. `jobs/keyword-performance-rollup.ts` — matches
 *      `ovo_seo_query_history.query` to `ovo_seo_keyword_target` by
 *      `lower(query) = normalized_keyword`.
 *
 *   3. Migration20260516110000 — the backfill UPDATE uses the same
 *      regexp-replace as `lower(trim(regexp_replace(..., '\\s+', ' ',
 *      'g')))`. The JS form here adds NFKC + zero-width strip on top
 *      of that simpler SQL form; for legacy rows the simpler form is
 *      fine.
 *
 * Steps applied (in order):
 *
 *   1. Throw if input is `null` / `undefined` / non-string. Callers
 *      should already have validated; defensive guard.
 *   2. NFKC normalisation. Folds compatibility characters (full-width
 *      digits, ligatures, etc.) into their canonical equivalents.
 *   3. Strip zero-width characters (ZWJ U+200D, ZWNJ U+200C, ZWSP
 *      U+200B, BOM U+FEFF). Pasted-from-Word keywords sometimes
 *      smuggle these in and operators can't see them.
 *   4. Lowercase.
 *   5. Trim leading + trailing whitespace.
 *   6. Collapse internal whitespace runs (incl. tabs, newlines) to a
 *      single space.
 *
 * Throws if the result is empty (length 0) or exceeds
 * `KEYWORD_MAX_LENGTH` (200). The service translates these into
 * 400-shaped API responses; the migration backfill never produces an
 * empty result because the source `keyword` column is NOT NULL.
 */

export const KEYWORD_MAX_LENGTH = 200

const ZERO_WIDTH_RE = /[​-‍﻿]/g
const WHITESPACE_RUN_RE = /\s+/g

export class KeywordNormalisationError extends Error {
  constructor(
    public readonly code: "empty" | "too_long" | "non_string",
    message: string,
  ) {
    super(message)
    this.name = "KeywordNormalisationError"
  }
}

export function normalizeKeyword(input: unknown): string {
  if (typeof input !== "string") {
    throw new KeywordNormalisationError(
      "non_string",
      "keyword must be a string",
    )
  }

  const normalised = input
    .normalize("NFKC")
    .replace(ZERO_WIDTH_RE, "")
    .toLowerCase()
    .trim()
    .replace(WHITESPACE_RUN_RE, " ")

  if (normalised.length === 0) {
    throw new KeywordNormalisationError(
      "empty",
      "keyword normalises to empty string",
    )
  }
  if (normalised.length > KEYWORD_MAX_LENGTH) {
    throw new KeywordNormalisationError(
      "too_long",
      `keyword exceeds ${KEYWORD_MAX_LENGTH} chars after normalisation`,
    )
  }

  return normalised
}

/**
 * Soft variant used at read-time where we want to compare two
 * arbitrary strings (e.g. a GSC query string vs a stored target)
 * without throwing. Returns null on failure instead of throwing.
 */
export function tryNormalizeKeyword(input: unknown): string | null {
  try {
    return normalizeKeyword(input)
  } catch {
    return null
  }
}
