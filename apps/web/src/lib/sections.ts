import type { IconName } from "../components/Icon"
import type { Route } from "../store"

/**
 * O48 (owner, 25 Nov): "I'd like the main menu items to open that menu. And then there are secondary groupings with
 * pill buttons along the top." Five main sections, each a sidebar item that opens it; a section's pages are pills
 * along the top of every page in it. One home for each page (docs/design/navigation-review.md).
 */
export interface NavSection {
  id: "work" | "ask" | "build" | "safety" | "settings"
  label: string
  icon: IconName
  pages: ReadonlyArray<{ route: Route; label: string }>
}

export const NAV_SECTIONS: readonly NavSection[] = [
  {
    id: "work",
    label: "Work",
    icon: "home",
    pages: [
      { route: "dashboard", label: "Dashboard" },
      { route: "sessions", label: "All sessions" },
      { route: "board", label: "Board" },
      { route: "usage", label: "Usage" },
    ],
  },
  {
    id: "ask",
    label: "Ask about code",
    icon: "chat",
    pages: [
      { route: "chat", label: "New question" },
      { route: "projects", label: "Projects" },
      { route: "memory", label: "Memory" },
      { route: "prompts", label: "Prompts" },
    ],
  },
  {
    id: "build",
    label: "Build",
    icon: "marketplace",
    pages: [
      { route: "mcp", label: "MCP servers" },
      { route: "marketplace", label: "Marketplace" },
    ],
  },
  {
    id: "safety",
    label: "Safety",
    icon: "policy",
    pages: [
      { route: "policy", label: "What Claude may do" },
      { route: "approver", label: "Approver" },
      { route: "audit", label: "Audit log" },
    ],
  },
  {
    id: "settings",
    label: "Settings",
    icon: "settings",
    pages: [
      { route: "settings", label: "Settings" },
      { route: "devices", label: "Phone and notifications" },
      { route: "doctor", label: "Doctor" },
      { route: "guide", label: "User guide" },
    ],
  },
]

/** The section a page belongs to; none for a session, Approvals, first run, setup, Home or an imported chat. */
export function sectionOf(route: Route): NavSection | undefined {
  return NAV_SECTIONS.find((s) => s.pages.some((p) => p.route === route))
}

const KEY = "codeh:section-last"

function readLast(): Record<string, string> {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? "{}") as unknown
    return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, string>) : {}
  } catch {
    return {}
  }
}

/** The page a section opens on: the one you last used in it (if it is still one of its pages), else its first. */
export function openingPage(s: NavSection): Route {
  const last = readLast()[s.id]
  return s.pages.find((p) => p.route === last)?.route ?? s.pages[0]!.route
}

/** Notes the page you are on, for its section to open there next time. */
export function rememberPage(route: Route): void {
  const s = sectionOf(route)
  if (!s) return
  try {
    localStorage.setItem(KEY, JSON.stringify({ ...readLast(), [s.id]: route }))
  } catch {
    // private mode: the section opens on its first page
  }
}
