import type { Health, SessionInfo } from "@gatehouse/shared/ws-protocol"
import type { Route } from "../store"

/**
 * The foot of the sidebar: every way a request reaches you away from the desk, by name. Green while at least one
 * works; one that does not work says so in the words.
 */
export function notifyLine(h: Pick<Health, "relay" | "push">): {
  ok: boolean
  neutral: boolean
  label: string
} {
  const ways = [
    ...(h.relay.state === "not-configured"
      ? []
      : [
          {
            name:
              h.relay.devices > 1 ? `the phone app (${h.relay.devices} phones)` : "the phone app",
            ok: h.relay.state === "connected",
          },
        ]),
    ...(h.push ?? []).map((p) => ({ name: p.channel === "ntfy" ? "ntfy" : "Slack", ok: p.ok })),
  ]
  if (ways.length === 0) return { ok: false, neutral: true, label: "No phone" }
  const named = ways.map((w) => (w.ok ? w.name : `${w.name} (not connected)`))
  return {
    ok: ways.some((w) => w.ok),
    neutral: false,
    label: `Notifying on ${named.join(", ")}`,
  }
}

/** Sessions in the rail, grouped by the folder their project sits in ("dev" for C:\dev\shop). */
export interface FolderGroup {
  folder: string
  label: string
  sessions: SessionInfo[]
}

const RANK: Record<SessionInfo["state"], number> = {
  waiting: 0,
  running: 1,
  starting: 1,
  idle: 2,
  error: 3,
  ended: 4,
}

/** An ended session the list can hide: not one that stopped with an error, and not one you have open. */
export function isHiddenEnded(s: SessionInfo, keep?: ReadonlySet<string | undefined>): boolean {
  return s.state === "ended" && !s.archived && !keep?.has(s.id)
}

const HIDE_ENDED_KEY = "gatehouse.rail.hideEnded"

/** On unless you turned it off. */
export function readHideEnded(): boolean {
  try {
    return localStorage.getItem(HIDE_ENDED_KEY) !== "0"
  } catch {
    return true
  }
}

export function saveHideEnded(on: boolean): void {
  try {
    localStorage.setItem(HIDE_ENDED_KEY, on ? "1" : "0")
  } catch {
    // storage blocked: the choice lasts until the window closes
  }
}

/** Chats sit in a group of their own, after your projects; pinned sessions in one before them all. */
const CHATS = "chats:"
const PINNED = "pinned:"

export function groupByFolder(
  list: SessionInfo[],
  /** Ended sessions leave the list, except ones you have open (owner, 31 Oct). */
  hide?: { ended: boolean; keep?: ReadonlySet<string | undefined> },
): FolderGroup[] {
  const groups = new Map<string, FolderGroup>()
  for (const s of list) {
    // Archived sessions leave the sidebar; Earlier sessions on Sessions still shows them.
    if (s.archived) continue
    if (hide?.ended && isHiddenEnded(s, hide.keep)) continue
    if (s.pinned) {
      const g = groups.get(PINNED) ?? { folder: PINNED, label: "Pinned", sessions: [] }
      g.sessions.push(s)
      groups.set(PINNED, g)
      continue
    }
    if (s.kind === "chat") {
      const g = groups.get(CHATS) ?? { folder: CHATS, label: "Chats", sessions: [] }
      g.sessions.push(s)
      groups.set(CHATS, g)
      continue
    }
    const parts = s.cwd.replaceAll("\\", "/").replace(/\/+$/, "").split("/")
    const folder = parts.slice(0, -1).join("/") || parts[0] || s.cwd
    const key = folder.toLowerCase()
    const g = groups.get(key) ?? { folder, label: folder.split("/").at(-1) || folder, sessions: [] }
    g.sessions.push(s)
    groups.set(key, g)
  }
  for (const g of groups.values())
    g.sessions.sort(
      (a, b) => RANK[a.state] - RANK[b.state] || b.createdAt.localeCompare(a.createdAt),
    )
  return [...groups.values()].sort(
    (a, b) =>
      Number(b.folder === PINNED) - Number(a.folder === PINNED) ||
      Number(a.folder === CHATS) - Number(b.folder === CHATS) ||
      a.label.localeCompare(b.label),
  )
}

/**
 * The sessions as the sidebar lists them, top to bottom, which is what Ctrl+1 to 9 count (owner's plan, W1-05):
 * pinned first, then each folder, then chats, hiding ended ones as the sidebar does.
 */
export function railOrder(
  list: SessionInfo[],
  hideEnded: boolean,
  keep?: ReadonlySet<string | undefined>,
): SessionInfo[] {
  return groupByFolder(list, { ended: hideEnded, ...(keep ? { keep } : {}) }).flatMap(
    (g) => g.sessions,
  )
}

/** Pages that can sit in the rail as well as in the menus. You choose which, with Edit sidebar. */
export const RAIL_PAGES: Array<{ route: Route; label: string }> = [
  { route: "approvals", label: "Approvals" },
  { route: "sessions", label: "All sessions" },
  { route: "usage", label: "Usage" },
  { route: "projects", label: "Projects" },
  { route: "memory", label: "Memory" },
  { route: "prompts", label: "Prompts" },
  { route: "marketplace", label: "Marketplace" },
  { route: "policy", label: "What Claude may do" },
  { route: "audit", label: "Audit log" },
  { route: "approver", label: "Approver" },
  { route: "devices", label: "Phone and notifications" },
  { route: "settings", label: "Settings" },
  { route: "guide", label: "User guide" },
]

const KEY = "gatehouse.rail.pages"
export const DEFAULT_RAIL_PAGES: Route[] = ["approvals", "policy"]

export function readRailPages(): Route[] {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? "null") as unknown
    // In the order you set; a page this version does not know is left out.
    if (Array.isArray(v)) {
      const known = new Set<string>(RAIL_PAGES.map((p) => p.route))
      return [...new Set(v.filter((r): r is Route => typeof r === "string" && known.has(r)))]
    }
  } catch {
    // a value from an older version, or none
  }
  return DEFAULT_RAIL_PAGES
}

export function saveRailPages(routes: Route[]): void {
  localStorage.setItem(KEY, JSON.stringify(routes))
}
