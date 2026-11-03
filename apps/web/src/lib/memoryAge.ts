/** After this long a memory is flagged, so you can check it is still true (B24). */
export const STALE_DAYS = 90

const DAY = 86_400_000

/**
 * How old a memory is, in words ("today", "3 days ago", "4 months ago"), and whether it is past STALE_DAYS. A memory
 * with no date it can read (from an older version) counts as old, so it is checked.
 */
export function memoryAge(at: string, now = Date.now()): { words: string; stale: boolean } {
  const t = Date.parse(at)
  if (!Number.isFinite(t) || t <= 0) return { words: "date not known", stale: true }
  const days = Math.max(0, Math.floor((now - t) / DAY))
  const stale = days > STALE_DAYS
  if (days === 0) return { words: "today", stale }
  if (days === 1) return { words: "yesterday", stale }
  if (days < 31) return { words: `${days} days ago`, stale }
  const months = Math.floor(days / 30.44)
  if (months < 12) return { words: months === 1 ? "a month ago" : `${months} months ago`, stale }
  const years = Math.floor(days / 365.25)
  return { words: years === 1 ? "a year ago" : `${years} years ago`, stale }
}
