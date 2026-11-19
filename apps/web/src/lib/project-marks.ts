import type { FolderGroup } from "./rail"

/**
 * T-092: projects in the sidebar, each with a monogram (its initials, in a colour of its own, the same every time), and
 * pinned to the top or archived out of the way by you. Kept on this computer with the sidebar's other choices. The
 * sidebar's own groups (Pinned, Working, the chat periods) are not projects and are left as they are.
 */
const KEY = "gatehouse.rail.sections"

export interface SectionPrefs {
  pinned: string[]
  archived: string[]
}

/** A project group or a folder group: what can carry a monogram and be pinned or archived. */
export const isProjectSection = (folder: string) => !/^(pinned|working|chats):/.test(folder)

/** Up to two letters: the first of the first two words (or camel-case parts), else the first two of one word. */
export function monogram(name: string): string {
  const words = name
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean)
  if (!words.length) return "?"
  const two = words.length > 1 ? words[0]![0]! + words[1]![0]! : words[0]!.slice(0, 2)
  return two.toUpperCase()
}

/** A hue for the monogram from the name: the same name, the same colour. */
export function hueOf(name: string): number {
  let h = 0
  for (const c of name.toLowerCase()) h = (h * 31 + c.charCodeAt(0)) % 360
  return h
}

export function readSections(): SectionPrefs {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? "null") as Partial<SectionPrefs> | null
    const list = (x: unknown) => (Array.isArray(x) ? x.filter((y): y is string => typeof y === "string").slice(0, 200) : [])
    return { pinned: list(v?.pinned), archived: list(v?.archived) }
  } catch {
    return { pinned: [], archived: [] }
  }
}

export function saveSections(p: SectionPrefs): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(p))
  } catch {
    // storage blocked: the choice lasts until the window closes
  }
}

const keyOf = (folder: string) => folder.toLowerCase()

/** Pin or unpin, archive or bring back, a section: pinning brings an archived one back, archiving unpins it. */
export function setSection(p: SectionPrefs, folder: string, what: "pin" | "unpin" | "archive" | "unarchive"): SectionPrefs {
  const k = keyOf(folder)
  const without = (xs: string[]) => xs.filter((x) => x !== k)
  if (what === "pin") return { pinned: [...without(p.pinned), k], archived: without(p.archived) }
  if (what === "unpin") return { ...p, pinned: without(p.pinned) }
  if (what === "archive") return { pinned: without(p.pinned), archived: [...without(p.archived), k] }
  return { ...p, archived: without(p.archived) }
}

/**
 * The sections in their order: the sidebar's own groups first as they were, then your pinned projects in the order you
 * pinned them, then the rest; archived ones left out unless asked for. Also how many are archived.
 */
export function arrangeSections(groups: FolderGroup[], p: SectionPrefs, showArchived = false): { groups: FolderGroup[]; archived: number } {
  const archived = new Set(p.archived)
  const at = new Map(p.pinned.map((k, i) => [k, i]))
  // The sidebar's own: Pinned and Working stay at the top, the chat groups at the bottom, as they were.
  const top = groups.filter((g) => /^(pinned|working):/.test(g.folder))
  const bottom = groups.filter((g) => g.folder.startsWith("chats:"))
  const projects = groups.filter((g) => isProjectSection(g.folder))
  const hidden = projects.filter((g) => archived.has(keyOf(g.folder)))
  const shown = projects.filter((g) => showArchived || !archived.has(keyOf(g.folder)))
  const pinned = shown.filter((g) => at.has(keyOf(g.folder))).sort((a, b) => at.get(keyOf(a.folder))! - at.get(keyOf(b.folder))!)
  const rest = shown.filter((g) => !at.has(keyOf(g.folder)))
  return { groups: [...top, ...pinned, ...rest, ...bottom], archived: hidden.length }
}
