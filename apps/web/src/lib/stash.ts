/**
 * T-043 (t3code review, O31): a stash of drafts. Put what you are writing aside, with the files attached to it, and
 * bring it back later in any session. Kept on this computer where the prompt box already keeps its draft (this
 * browser's local storage), the newest 20, and read tolerantly: anything it does not understand is left out.
 */
const KEY = "gatehouse.stash"
const MAX = 20

export interface StashedDraft {
  id: string
  /** When it was stashed, ISO. */
  at: string
  text: string
  /** Files attached to it, by their path in the session's folder. */
  files: string[]
  /** The project it was written in, to show beside it. */
  project?: string
}

export function stashed(): StashedDraft[] {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? "[]") as unknown
    if (!Array.isArray(v)) return []
    return v
      .filter((x): x is StashedDraft => !!x && typeof x === "object" && typeof (x as StashedDraft).id === "string" && typeof (x as StashedDraft).text === "string")
      .map((x) => ({ ...x, at: typeof x.at === "string" ? x.at : "", files: Array.isArray(x.files) ? x.files.filter((f) => typeof f === "string") : [] }))
  } catch {
    return []
  }
}

function save(list: StashedDraft[]): void {
  localStorage.setItem(KEY, JSON.stringify(list.slice(0, MAX)))
}

/** Puts a draft aside, newest first. Nothing to stash: undefined. */
export function stashDraft(text: string, files: string[], project?: string, now = new Date()): StashedDraft | undefined {
  if (!text.trim() && files.length === 0) return undefined
  const entry: StashedDraft = { id: `${now.getTime().toString(36)}${Math.random().toString(36).slice(2, 6)}`, at: now.toISOString(), text, files, ...(project ? { project } : {}) }
  save([entry, ...stashed()])
  return entry
}

/** Takes a stashed draft out of the stash to bring it back. */
export function takeStashed(id: string): StashedDraft | undefined {
  const list = stashed()
  const found = list.find((x) => x.id === id)
  if (found) save(list.filter((x) => x.id !== id))
  return found
}

export function dropStashed(id: string): void {
  save(stashed().filter((x) => x.id !== id))
}

/** A short name for a stashed draft: its first line, or how many files it carries. */
export function stashLabel(d: StashedDraft): string {
  const first = d.text.trim().split(/\r?\n/)[0] ?? ""
  if (first) return first.length > 60 ? `${first.slice(0, 59)}…` : first
  return d.files.length === 1 ? "1 file" : `${d.files.length} files`
}
