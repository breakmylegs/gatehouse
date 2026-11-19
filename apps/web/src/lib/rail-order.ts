import type { SessionInfo } from "@gatehouse/shared/ws-protocol"
import type { FolderGroup } from "./rail"

/**
 * T-023: your own order in the sidebar, by dragging. The order is kept on this computer with the sidebar's other
 * choices (a session you have not placed keeps the order the sidebar gives it, after those you have). Dropping a
 * session on another section moves it there, through what the sidebar already changes: Pinned pins it, a project
 * moves it into that project, and its own folder (or Chats) takes it out of Pinned and any project. A section a
 * session cannot belong to (another folder, Working) says so and changes nothing.
 */
const KEY = "gatehouse.rail.order"
const MAX = 500

export function readOrder(): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? "null") as unknown
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string").slice(0, MAX) : []
  } catch {
    return []
  }
}

export function saveOrder(ids: string[]): void {
  try {
    localStorage.setItem(KEY, JSON.stringify([...new Set(ids)].slice(0, MAX)))
  } catch {
    // storage blocked: the order lasts until the window closes
  }
}

/** Each section's sessions in your order: those you placed first, as placed, then the rest as they were. */
export function applyOrder(groups: FolderGroup[], order: string[]): FolderGroup[] {
  if (!order.length) return groups
  const at = new Map(order.map((id, i) => [id, i]))
  return groups.map((g) => {
    const placed = g.sessions.filter((s) => at.has(s.id)).sort((a, b) => at.get(a.id)! - at.get(b.id)!)
    return { ...g, sessions: [...placed, ...g.sessions.filter((s) => !at.has(s.id))] }
  })
}

/** The sidebar's ids with `dragged` moved to just before `before` (or to the end of `section` when none is given). */
export function moveBefore(shown: string[], dragged: string, before?: string, sectionIds?: string[]): string[] {
  const rest = shown.filter((id) => id !== dragged)
  if (before && rest.includes(before)) {
    rest.splice(rest.indexOf(before), 0, dragged)
    return rest
  }
  const last = sectionIds?.filter((id) => id !== dragged).at(-1)
  if (last && rest.includes(last)) {
    rest.splice(rest.indexOf(last) + 1, 0, dragged)
    return rest
  }
  return [...rest, dragged]
}

/** Moving a row one place up or down in its section, for the keyboard. */
export function moveBy(shown: string[], sectionIds: string[], id: string, by: -1 | 1): string[] {
  const i = sectionIds.indexOf(id)
  const j = i + by
  if (i < 0 || j < 0 || j >= sectionIds.length) return shown
  return by < 0 ? moveBefore(shown, id, sectionIds[j]) : moveBefore(shown, sectionIds[j]!, id)
}

export type SectionChange = { pinned?: boolean; group?: string | null }

/** The folder a coding session is listed under when it is in no project and not pinned, as the sidebar keys it. */
const homeOf = (s: SessionInfo) => {
  const parts = s.cwd.replaceAll("\\", "/").replace(/\/+$/, "").split("/")
  return (parts.slice(0, -1).join("/") || parts[0] || s.cwd).toLowerCase()
}

/** What dropping a session on a section changes: "same" for its own section, or why it cannot go there. */
export function dropChange(s: SessionInfo, section: FolderGroup): SectionChange | "same" | { refused: string } {
  const f = section.folder
  if (f === "pinned:") return s.pinned ? "same" : { pinned: true }
  if (f.startsWith("project:")) {
    const name = f.slice("project:".length)
    const mine = s.group ?? (s.kind === "chat" ? s.chatProject : undefined)
    return !s.pinned && mine?.toLowerCase() === name.toLowerCase() ? "same" : { ...(s.pinned ? { pinned: false } : {}), group: name }
  }
  if (f === "working:") return { refused: "Working lists the sessions running by themselves; it is not a place to put one." }
  const home = s.kind === "chat" ? f.startsWith("chats:") : f.toLowerCase() === homeOf(s)
  if (!home) return { refused: `${s.title ?? "This session"} stays under its own folder. Drop it on Pinned or a project instead.` }
  // A chat started in a chat project belongs to it unless you moved it.
  if (s.kind === "chat" && !s.group && s.chatProject)
    return s.pinned ? { pinned: false } : { refused: `${s.title ?? "This chat"} belongs to the ${s.chatProject} project. Drop it on Pinned or another project instead.` }
  if (!s.pinned && !s.group) return "same"
  return { ...(s.pinned ? { pinned: false } : {}), ...(s.group ? { group: null } : {}) }
}
