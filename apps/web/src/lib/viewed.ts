/**
 * T-077 (t3code review, O31): files marked as viewed in the Changes pane, kept per session in the window's storage.
 * Each mark remembers the diff it was made on, so a file that changes again comes back unmarked.
 */
export type Viewed = Record<string, string>

const key = (sessionId: string) => `gatehouse.viewed.${sessionId}`

/** A short fingerprint of a diff (FNV-1a), enough to tell that it changed. */
export function fingerprint(diff: string): string {
  let h = 0x811c9dc5
  for (let i = 0; i < diff.length; i++) {
    h ^= diff.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return `${diff.length}:${(h >>> 0).toString(36)}`
}

/** What was kept, read tolerantly: anything that is not a path and a fingerprint is left out. */
export function readViewed(sessionId: string): Viewed {
  try {
    const v = JSON.parse(localStorage.getItem(key(sessionId)) ?? "null") as unknown
    if (!v || typeof v !== "object") return {}
    return Object.fromEntries(Object.entries(v).filter(([, f]) => typeof f === "string")) as Viewed
  } catch {
    return {}
  }
}

/** Marks a file viewed as its diff is now, or takes the mark off. */
export function setViewed(sessionId: string, viewed: Viewed, path: string, diff: string | undefined): Viewed {
  const next = { ...viewed }
  if (diff === undefined) delete next[path]
  else next[path] = fingerprint(diff)
  try {
    if (Object.keys(next).length) localStorage.setItem(key(sessionId), JSON.stringify(next))
    else localStorage.removeItem(key(sessionId))
  } catch {
    // storage blocked: the marks last until the window closes
  }
  return next
}

export const isViewed = (viewed: Viewed, f: { path: string; diff: string }): boolean =>
  viewed[f.path] === fingerprint(f.diff)
