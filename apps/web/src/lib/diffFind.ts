/**
 * T-062 (t3code review, O31): find text across every file of a change, folded files included. Searches the lines a
 * diff adds, removes or keeps for context, not its headers, ignoring case.
 */
export interface DiffMatch {
  path: string
  /** The line's number in the file after the change, or before it for a removed line. */
  line: number
  sign: "+" | "-" | " "
  text: string
}

/** The most matches listed; the count still says how many there were. */
export const MAX_MATCHES = 200

export function findInDiffs(
  files: ReadonlyArray<{ path: string; diff: string; binary?: boolean }>,
  query: string,
): { matches: DiffMatch[]; total: number; files: number } {
  const q = query.trim().toLowerCase()
  const matches: DiffMatch[] = []
  let total = 0
  const hit = new Set<string>()
  if (!q) return { matches, total, files: 0 }
  for (const f of files) {
    if (f.binary) continue
    let before = 0
    let after = 0
    for (const raw of f.diff.split(/\r?\n/)) {
      const head = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(raw)
      if (head) {
        before = Number(head[1])
        after = Number(head[2])
        continue
      }
      if (raw.startsWith("+++") || raw.startsWith("---") || raw.startsWith("\\")) continue
      const sign = raw[0]
      if (sign !== "+" && sign !== "-" && sign !== " ") continue
      const text = raw.slice(1)
      const line = sign === "-" ? before : after
      if (sign !== "+") before++
      if (sign !== "-") after++
      if (!text.toLowerCase().includes(q)) continue
      total++
      hit.add(f.path)
      if (matches.length < MAX_MATCHES) matches.push({ path: f.path, line, sign, text })
    }
  }
  return { matches, total, files: hit.size }
}
