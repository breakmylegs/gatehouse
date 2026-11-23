/**
 * E-074, code reading drills (Expansion E6). Questions made from the project's tours (D-079), each step checked against
 * the code index: where a symbol lives, and what it does (from the tour's own note). Each question links to its code,
 * the symbol's file and line, and each answer gets an explanation: right or wrong, it says where the answer is and
 * what the tour says about it. Wrong choices come from the same tour, so they are plausible. The same tours always
 * make the same questions.
 */
export interface DrillStep {
  title: string
  symbol: string
  note?: string
  state: "ok" | "moved" | "gone"
  at?: { file: string; line: number }
}

export interface Drill {
  id: string
  tour: string
  kind: "where" | "what"
  prompt: string
  choices: string[]
  answer: number
  explanation: string
  link: { file: string; line: number }
}

/** A stable order from a string, so the same tour makes the same drills. */
function seeded(key: string): () => number {
  let h = 2166136261
  for (const c of key) h = Math.imul(h ^ c.charCodeAt(0), 16777619) >>> 0
  return () => {
    h = Math.imul(h ^ (h >>> 15), 2246822507) >>> 0
    h = Math.imul(h ^ (h >>> 13), 3266489909) >>> 0
    return ((h ^= h >>> 16) >>> 0) / 4294967296
  }
}

function choicesWith(right: string, others: string[], rand: () => number): { choices: string[]; answer: number } {
  const wrong = [...new Set(others.filter((o) => o !== right))]
  for (let i = wrong.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1))
    ;[wrong[i], wrong[j]] = [wrong[j]!, wrong[i]!]
  }
  const choices = [right, ...wrong.slice(0, 3)]
  for (let i = choices.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1))
    ;[choices[i], choices[j]] = [choices[j]!, choices[i]!]
  }
  return { choices, answer: choices.indexOf(right) }
}

export function makeDrills(tours: Array<{ name: string; title: string; steps: DrillStep[] }>): Drill[] {
  const out: Drill[] = []
  for (const t of tours) {
    // Only steps whose symbol the index still finds: a question must link to real code.
    const live = t.steps.filter((s): s is DrillStep & { at: { file: string; line: number } } => s.state !== "gone" && !!s.at)
    const files = live.map((s) => s.at.file)
    const notes = live.map((s) => s.note?.trim()).filter((n): n is string => !!n)
    live.forEach((s, i) => {
      const rand = seeded(`${t.name}:${s.symbol}:${i}`)
      const where = `${s.at.file}`
      if (new Set(files).size >= 2) {
        const c = choicesWith(where, files, rand)
        out.push({
          id: `${t.name}:${i}:where`,
          tour: t.title,
          kind: "where",
          prompt: `Which file is ${s.symbol} in?`,
          ...c,
          explanation: `${s.symbol} is in ${where}, at line ${s.at.line}.${s.note ? ` The tour says: ${s.note}` : ""}`,
          link: s.at,
        })
      }
      if (s.note?.trim() && notes.length >= 2) {
        const c = choicesWith(s.note.trim(), notes, rand)
        out.push({
          id: `${t.name}:${i}:what`,
          tour: t.title,
          kind: "what",
          prompt: `What does ${s.symbol} do?`,
          ...c,
          explanation: `The tour's step "${s.title}" says ${s.symbol}: ${s.note.trim()} Read it at ${where}, line ${s.at.line}.`,
          link: s.at,
        })
      }
    })
  }
  return out
}
