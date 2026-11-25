import type { RailMode } from "./railMode"

/**
 * O54 (owner, 25 Nov): the session you last had open on each side of the sidebar, Ask about code and Code, with the
 * panes it was in, so switching sides lands where you left that side rather than on a fixed page. Kept like the rail
 * mode, across restarts; read tolerantly, because an older or newer version may have written it.
 */
export interface LastOpen {
  selected: string
  panes: string[]
}
type Kinded = { id: string; kind?: string } | undefined

const KEY = "gatehouse.lastOpen"

export const sideOf = (s: Kinded): RailMode => (s?.kind === "chat" ? "chat" : "code")

function readAll(): Record<string, unknown> {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? "null") as unknown
    return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {}
  } catch {
    return {}
  }
}

function readSide(side: RailMode): LastOpen | undefined {
  const v = readAll()[side] as { selected?: unknown; panes?: unknown } | undefined
  if (!v || typeof v.selected !== "string" || !v.selected) return undefined
  const panes = Array.isArray(v.panes) ? v.panes.filter((p): p is string => typeof p === "string") : []
  return { selected: v.selected, panes }
}

/** Notes the session on screen in the workspace for its side, with the panes of that side beside it. */
export function noteOpen(
  route: string,
  selected: string | undefined,
  panes: readonly string[],
  sessions: Record<string, Kinded>,
): void {
  if (route !== "workspace" || !selected || !sessions[selected]) return
  const side = sideOf(sessions[selected])
  const mine = panes.filter((p) => sessions[p] && sideOf(sessions[p]) === side)
  const next = { selected, panes: mine.includes(selected) ? mine : [] }
  const all = readAll()
  const was = readSide(side)
  if (was && was.selected === next.selected && was.panes.join("\n") === next.panes.join("\n")) return
  try {
    localStorage.setItem(KEY, JSON.stringify({ ...all, [side]: next }))
  } catch {
    // storage blocked: the side opens on its first page next time
  }
}

/**
 * The session to reopen on a side, if it still exists and is still that side's: its panes too, without any that were
 * deleted since (fewer than two left is one session on its own). Nothing when there is none to go back to.
 */
export function lastOpenOf(side: RailMode, sessions: Record<string, Kinded>): LastOpen | undefined {
  const v = readSide(side)
  if (!v) return undefined
  const ok = (id: string) => sessions[id] !== undefined && sideOf(sessions[id]) === side
  if (!ok(v.selected)) return undefined
  const panes = [...new Set(v.panes.filter(ok))]
  return { selected: v.selected, panes: panes.length >= 2 && panes.includes(v.selected) ? panes : [] }
}
