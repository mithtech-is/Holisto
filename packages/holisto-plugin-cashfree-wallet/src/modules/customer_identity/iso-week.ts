/**
 * ISO 8601 week computed in Asia/Kolkata wall time.
 *
 * Returned `iso_year` is the *ISO* year (the year that owns the week),
 * not the calendar year — Jan 1 may live in W52/W53 of the previous
 * ISO year. The displayed `YY` should be derived from this same ISO
 * year so the year+week pair always names a unique week.
 */
export function istIsoWeek(input: Date | string): {
  isoYear: number
  isoWeek: number
} {
  const d = typeof input === "string" ? new Date(input) : input
  // Shift the UTC instant by +5h30m and read it via UTC getters so the
  // components reflect IST wall time without depending on the host TZ.
  const istMs = d.getTime() + 5.5 * 60 * 60 * 1000
  const ist = new Date(istMs)
  const y = ist.getUTCFullYear()
  const m = ist.getUTCMonth()
  const day = ist.getUTCDate()

  // Standard ISO week algorithm: project to the Thursday of the same
  // ISO week, then count weeks since the first Thursday of that ISO
  // year (which always sits in calendar W1).
  const target = new Date(Date.UTC(y, m, day))
  const dayOfWeek = (target.getUTCDay() + 6) % 7 // 0 = Mon
  target.setUTCDate(target.getUTCDate() - dayOfWeek + 3)
  const isoYear = target.getUTCFullYear()
  const firstThursday = new Date(Date.UTC(isoYear, 0, 4))
  const firstThursdayDow = (firstThursday.getUTCDay() + 6) % 7
  firstThursday.setUTCDate(firstThursday.getUTCDate() - firstThursdayDow + 3)
  const isoWeek =
    1 + Math.round((target.getTime() - firstThursday.getTime()) / (7 * 86400000))
  return { isoYear, isoWeek }
}

/** Format the storage triple as the displayed `NNNNYYWW` string. */
export function formatClientId(
  seq: number,
  isoYear: number,
  isoWeek: number,
): string {
  const nnnn = String(seq).padStart(4, "0")
  const yy = String(isoYear % 100).padStart(2, "0")
  const ww = String(isoWeek).padStart(2, "0")
  return `${nnnn}${yy}${ww}`
}

/** Strict shape check for the displayed string (8 ASCII digits). */
export function isClientIdShape(s: string): boolean {
  return /^\d{8}$/.test(s)
}
