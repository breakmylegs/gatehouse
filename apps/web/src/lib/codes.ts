/**
 * A short, stable code for each session, like a flight number: two letters from the project and three digits from
 * the session id, plus a ribbon colour so the same session is recognisable across the board, the workspace and split
 * panes. Colour is never the only cue: the code is always shown with it.
 */
const RIBBONS = [
  "oklch(62% 0.15 258)",
  "oklch(64% 0.14 152)",
  "oklch(66% 0.16 50)",
  "oklch(60% 0.17 330)",
  "oklch(66% 0.12 200)",
  "oklch(62% 0.16 292)",
  "oklch(68% 0.14 110)",
  "oklch(60% 0.15 20)",
]

function hash(text: string): number {
  let h = 2166136261
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

function letters(project: string): string {
  const clean = project.replace(/[^A-Za-z0-9]/g, "")
  if (clean.length === 0) return "JC"
  const first = clean[0] ?? "J"
  const next = clean.slice(1).match(/[bcdfghjklmnpqrstvwxyz]/i)?.[0] ?? clean[1] ?? "C"
  return (first + next).toUpperCase()
}

export function sessionCode(s: { id: string; project: string }): string {
  return `${letters(s.project)} ${100 + (hash(s.id) % 900)}`
}

export function sessionRibbon(s: { id: string }): string {
  return RIBBONS[hash(s.id) % RIBBONS.length] ?? RIBBONS[0]!
}
