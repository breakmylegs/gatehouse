import type { Route } from "../store"

/**
 * Everything the palette (Ctrl+K) can do, in one list, so a menu and the palette cannot drift apart (owner's plan,
 * W1-05, G1 and U1). It moves you around and switches how Codehouse looks. It has no allow, deny or kill action on
 * purpose: a decision always happens on the card, with its own safeguards.
 */
export interface AppCommand {
  id: string
  label: string
  group: "Pages" | "Actions"
  /** The page this belongs to: on that page it ranks first. */
  page?: Route
  /** Words that find it besides its label. */
  keywords?: string
  /** Its key, shown beside it and in the shortcut sheet. */
  keys?: string
  run: () => void
}

/** What the commands need to know and do. Built where the app state is. */
export interface CommandContext {
  theme: "light" | "dark"
  themeFollows: boolean
  hideEnded: boolean
  /** The session bar under the prompt box is folded away. */
  barFolded: boolean
  setBarFolded: (folded: boolean) => void
  go: (route: Route) => void
  setTheme: (theme: "light" | "dark") => void
  followSystem: () => void
  toggleHelp: () => void
  /** Opens a part of the window that keeps its own state: the sidebar, accounts, shortcuts, the palette. */
  fire: (
    event: "codeh:toggle-rail" | "codeh:accounts" | "codeh:shortcuts" | "codeh:hide-ended",
  ) => void
}

/** The pages, with the words the sidebar and menus already use for them. */
export const PAGES: Array<{ route: Route; label: string; keywords?: string }> = [
  { route: "dashboard", label: "Dashboard", keywords: "home overview today" },
  { route: "approvals", label: "Approvals", keywords: "needs you waiting requests" },
  { route: "sessions", label: "New session", keywords: "start earlier resume" },
  { route: "sessions", label: "All sessions", keywords: "list board earlier resume" },
  { route: "chat", label: "New chat", keywords: "talk conversation" },
  { route: "workspace", label: "Workspace", keywords: "session conversation panes" },
  { route: "policy", label: "What Claude may do", keywords: "policy rules choices" },
  { route: "audit", label: "Audit log", keywords: "history decisions record" },
  { route: "approver", label: "Approver", keywords: "rules engine" },
  { route: "devices", label: "Phone and notifications", keywords: "devices ntfy slack relay" },
  { route: "usage", label: "Usage", keywords: "cost tokens spending plan" },
  { route: "projects", label: "Projects", keywords: "chat knowledge files instructions" },
  { route: "memory", label: "Memory", keywords: "remember forget chats preferences" },
  { route: "prompts", label: "Prompts", keywords: "saved library templates skills" },
  { route: "marketplace", label: "Marketplace", keywords: "plugins skills install extensions" },
  { route: "doctor", label: "Doctor", keywords: "check health problems diagnose fix troubleshoot" },
  { route: "settings", label: "Settings", keywords: "options preferences" },
  { route: "guide", label: "User guide", keywords: "help manual" },
]

/** Every key Codehouse answers to, for the shortcut sheet. The registry's own keys come first. */
export const BINDINGS: Array<{ keys: string; label: string }> = [
  { keys: "Ctrl K", label: "Search and commands" },
  { keys: "Ctrl /", label: "Keyboard shortcuts" },
  { keys: "Ctrl B", label: "Hide or show the sidebar" },
  { keys: "F1", label: "Help for this page" },
  { keys: "Ctrl 1 to 9", label: "Show the first to ninth session in the sidebar" },
  { keys: "Ctrl Shift A", label: "Approvals: move to the request card" },
  { keys: "Alt Up, Alt Down", label: "Approvals: the previous or next request" },
  { keys: "Ctrl Enter", label: "Allow once on a request, or send a chat or prompt" },
  {
    keys: "D, M, E, R, Shift S",
    label: "A request card: deny, deny with message, edit, remember, stop session",
  },
  { keys: "Esc", label: "Close a menu or a dialog" },
  { keys: "Ctrl Shift End", label: "A conversation: jump to the latest" },
  { keys: "Ctrl Shift K", label: "The kill switch: asks before it stops everything" },
  { keys: "Right, Left, Up, Down", label: "A line of work: open, close, the line before or after" },
  { keys: "Ctrl Shift C", label: "A conversation: copy Claude's last reply" },
  { keys: "Ctrl Shift ;", label: "A conversation: copy the last code block" },
]

/** The commands for this moment: the pages, then what changes how Codehouse looks and what it shows. */
export function buildCommands(c: CommandContext): AppCommand[] {
  const pages: AppCommand[] = PAGES.map((p) => ({
    id: `go:${p.route}:${p.label}`,
    label: p.label,
    group: "Pages",
    page: p.route,
    ...(p.keywords ? { keywords: p.keywords } : {}),
    run: () => c.go(p.route),
  }))
  const actions: AppCommand[] = [
    {
      id: "accounts",
      label: "Accounts...",
      group: "Actions",
      keywords: "sign in profile organisation",
      run: () => c.fire("codeh:accounts"),
    },
    {
      id: "theme",
      label: c.theme === "dark" ? "Codehouse light" : "Codehouse dark",
      group: "Actions",
      keywords: "theme switch dark light colours",
      run: () => c.setTheme(c.theme === "dark" ? "light" : "dark"),
    },
    ...(c.themeFollows
      ? []
      : [
          {
            id: "theme-follow",
            label: "Follow Windows theme",
            group: "Actions" as const,
            keywords: "theme system automatic",
            run: c.followSystem,
          },
        ]),
    {
      id: "help",
      label: "Help for this page",
      group: "Actions",
      keys: "F1",
      keywords: "explain",
      run: c.toggleHelp,
    },
    {
      id: "palette",
      label: "Search and commands",
      group: "Actions",
      keys: "Ctrl K",
      run: () => window.dispatchEvent(new Event("codeh:palette")),
    },
    {
      id: "shortcuts",
      label: "Keyboard shortcuts",
      group: "Actions",
      keys: "Ctrl /",
      keywords: "keys bindings",
      run: () => c.fire("codeh:shortcuts"),
    },
    {
      id: "rail",
      label: "Hide or show the sidebar",
      group: "Actions",
      keys: "Ctrl B",
      run: () => c.fire("codeh:toggle-rail"),
    },
    {
      id: "session-bar",
      label: c.barFolded ? "Show model and settings" : "Hide settings under the prompt box",
      group: "Actions",
      page: "workspace",
      keywords: "session bar fold model effort mode",
      run: () => c.setBarFolded(!c.barFolded),
    },
    {
      id: "hide-ended",
      label: c.hideEnded ? "Show ended sessions" : "Hide ended sessions",
      group: "Actions",
      keywords: "sidebar list",
      run: () => c.fire("codeh:hide-ended"),
    },
  ]
  return [...pages, ...actions]
}

/** The page you are on first: its own commands, then the rest in their order. */
export function rankCommands(list: AppCommand[], route: Route): AppCommand[] {
  return [...list.filter((x) => x.page === route), ...list.filter((x) => x.page !== route)]
}
