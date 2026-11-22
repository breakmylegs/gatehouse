/**
 * D-079, codebase tours (Frontier build). A tour is a file in the project's .codehouse/tours folder: a title and
 * ordered steps, each naming a symbol (a function, class, type) and the file it is in, with a note. Every step is
 * linked to the symbol's line through the C-036 code index, and a step broken by later changes is flagged: the symbol
 * gone, or moved to another file (the new place shown). Claude can be asked to write one from the index.
 */
import fs from "node:fs"
import path from "node:path"

export interface TourStep {
  title: string
  symbol: string
  file: string
  note?: string
}

export interface Tour {
  name: string
  title: string
  steps: TourStep[]
}

export interface CheckedStep extends TourStep {
  state: "ok" | "moved" | "gone"
  /** Where the symbol is now: its line when ok, its new file and line when moved. */
  at?: { file: string; line: number }
}

export const TOURS_DIR = path.join(".codehouse", "tours")

/** The project's tours, read tolerantly: a file that is not a tour is left out, with why. */
export function readTours(root: string): { tours: Tour[]; errors: string[] } {
  const dir = path.join(root, TOURS_DIR)
  const tours: Tour[] = []
  const errors: string[] = []
  let names: string[] = []
  try {
    names = fs.readdirSync(dir).filter((n) => n.toLowerCase().endsWith(".json")).sort()
  } catch {
    return { tours, errors }
  }
  for (const n of names.slice(0, 50)) {
    try {
      const v = JSON.parse(fs.readFileSync(path.join(dir, n), "utf8")) as { title?: unknown; steps?: unknown }
      const steps = Array.isArray(v.steps)
        ? (v.steps as Array<Record<string, unknown>>)
            .filter((s) => typeof s.symbol === "string" && typeof s.file === "string")
            .slice(0, 100)
            .map((s) => ({ title: typeof s.title === "string" ? s.title : String(s.symbol), symbol: String(s.symbol), file: String(s.file).replace(/\\/g, "/"), ...(typeof s.note === "string" ? { note: s.note } : {}) }))
        : []
      if (!steps.length) {
        errors.push(`${n}: no steps naming a symbol and its file`)
        continue
      }
      tours.push({ name: n.replace(/\.json$/i, ""), title: typeof v.title === "string" ? v.title : n, steps })
    } catch {
      errors.push(`${n}: not JSON`)
    }
  }
  return { tours, errors }
}

/** Each step against the index: where its symbol is now, or that it moved or is gone. */
export function checkTour(tour: Tour, symbols: (name: string) => Array<{ path: string; name: string; line: number }>): CheckedStep[] {
  return tour.steps.map((s) => {
    const found = symbols(s.symbol).filter((x) => x.name === s.symbol)
    const here = found.find((x) => x.path === s.file)
    if (here) return { ...s, state: "ok" as const, at: { file: here.path, line: here.line } }
    const elsewhere = found[0]
    return elsewhere ? { ...s, state: "moved" as const, at: { file: elsewhere.path, line: elsewhere.line } } : { ...s, state: "gone" as const }
  })
}

/** The prompt that asks Claude to write a tour, in the format the tours read. */
export function tourPrompt(topic: string): string {
  const slug = topic.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "tour"
  return [
    `Write a codebase tour of ${topic.trim().slice(0, 200)} for a newcomer, as .codehouse/tours/${slug}.json.`,
    'Its shape: {"title": "...", "steps": [{"title": "...", "symbol": "the exact name of a function, class or type", "file": "its path from the project folder, with forward slashes", "note": "one or two sentences on why it matters here"}]}.',
    "Five to twelve steps, in the order to read them. Name only symbols that exist; change nothing else.",
  ].join("\n")
}
