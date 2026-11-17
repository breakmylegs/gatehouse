import type { UiMode } from "./modes"

/**
 * T-017 (t3code review): the model, effort and mode a new session starts with are the ones you chose last time, and a
 * folder you have started in before starts as you last started there (its default). Kept in this window only.
 * An Extreme approval mode is never remembered: a session that answers everything by itself is something you choose
 * each time, so it starts in Manual instead.
 */
export interface Choices {
  model: string
  effort: string
  mode: UiMode
}

const KEY = "gatehouse.newSession.v1"
const NEVER_REMEMBERED: readonly string[] = ["extreme", "extremeMax"]

interface Kept {
  last?: Partial<Choices>
  byFolder?: Record<string, Partial<Choices>>
}

/** One spelling of a folder, so C:\dev\Shop\ and c:/dev/shop are the same project. */
export const folderKey = (folder: string) => folder.trim().replace(/[\\/]+$/, "").replace(/\\/g, "/").toLowerCase()

function read(): Kept {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? "{}") as Kept
    return v && typeof v === "object" ? v : {}
  } catch {
    return {}
  }
}

function clean(c: Partial<Choices> | undefined): Partial<Choices> {
  if (!c) return {}
  return {
    ...(typeof c.model === "string" ? { model: c.model } : {}),
    ...(typeof c.effort === "string" ? { effort: c.effort } : {}),
    ...(typeof c.mode === "string" && !NEVER_REMEMBERED.includes(c.mode) ? { mode: c.mode } : {}),
  }
}

/** What a new session starts with: the folder's own last choices, else your last ones. */
export function choicesFor(folder?: string): Partial<Choices> {
  const k = read()
  const own = folder?.trim() ? k.byFolder?.[folderKey(folder)] : undefined
  return own ? clean(own) : clean(k.last)
}

/** Whether this folder has choices of its own. */
export const hasFolderChoices = (folder: string) => Boolean(folder.trim() && read().byFolder?.[folderKey(folder)])

/** Kept once a session has started with them, for next time and for that folder. */
export function rememberChoices(folder: string, c: Choices): void {
  const k = read()
  const kept = clean(c)
  const byFolder = { ...(k.byFolder ?? {}) }
  if (folder.trim()) byFolder[folderKey(folder)] = kept
  // At most 200 folders, the newest kept.
  const names = Object.keys(byFolder)
  for (const n of names.slice(0, Math.max(0, names.length - 200))) delete byFolder[n]
  try {
    localStorage.setItem(KEY, JSON.stringify({ last: kept, byFolder }))
  } catch {
    // A full store only means the next session starts with the usual choices.
  }
}
