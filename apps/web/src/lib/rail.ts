import type { SessionInfo } from "@gatehouse/shared/ws-protocol"
import type { Route } from "../store"

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

/** Chats sit in a group of their own, after your projects. */
const CHATS = "chats:"

export function groupByFolder(list: SessionInfo[]): FolderGroup[] {
  const groups = new Map<string, FolderGroup>()
  for (const s of list) {
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
      Number(a.folder === CHATS) - Number(b.folder === CHATS) || a.label.localeCompare(b.label),
  )
}

/** Pages that can sit in the rail as well as in the menus. You choose which, with Edit sidebar. */
export const RAIL_PAGES: Array<{ route: Route; label: string }> = [
  { route: "approvals", label: "Approvals" },
  { route: "sessions", label: "All sessions" },
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
    if (Array.isArray(v)) return RAIL_PAGES.map((p) => p.route).filter((r) => v.includes(r))
  } catch {
    // a value from an older version, or none
  }
  return DEFAULT_RAIL_PAGES
}

export function saveRailPages(routes: Route[]): void {
  localStorage.setItem(KEY, JSON.stringify(routes))
}
