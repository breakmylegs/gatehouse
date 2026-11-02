// @vitest-environment jsdom
// One list of commands for the menus and the palette, Ctrl+1 to 9, the shortcut sheet, and the page you are on
// ranking first (owner's plan, W1-05, G1 and U1).
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { App } from "../src/App"
import {
  BINDINGS,
  buildCommands,
  PAGES,
  rankCommands,
  type CommandContext,
} from "../src/lib/commands"
import { railOrder } from "../src/lib/rail"
import { useStore } from "../src/store"

vi.mock("../src/store", async (orig) => {
  const actual = await orig<typeof import("../src/store")>()
  return { ...actual, send: vi.fn(async () => ({ ok: true })) }
})
vi.mock("../src/lib/api", () => ({
  api: vi.fn(async () => ({ ok: false, status: 404, error: "no route" })),
}))
vi.mock("sonner", () => ({
  toast: Object.assign(() => undefined, { error: () => undefined }),
  Toaster: () => null,
}))
globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
} as never
Element.prototype.scrollIntoView ??= () => {}

const health = {
  approver: { state: "up" as const, errors: [] },
  relay: { state: "not-configured" as const, devices: 0 },
  signin: {
    signedIn: true,
    email: "alex@example.com",
    organization: "Example Ltd",
    managedPolicy: "detected" as const,
    orgOk: true,
  },
  killSwitch: { engaged: false, approverConfirmed: true },
  pwsh: { running: true },
}
const session = (
  id: string,
  cwd: string,
  state: "idle" | "running" | "ended" = "idle",
  more: Record<string, unknown> = {},
) => ({
  id,
  cwd,
  project: cwd.split(/[\/]/).at(-1) as string,
  mode: "default" as const,
  state,
  pendingApprovals: 0,
  createdAt: `2026-10-30T10:0${id.slice(1)}:00Z`,
  ...more,
})

beforeEach(() => {
  localStorage.clear()
  useStore.setState({
    route: "approvals",
    setupDone: true,
    panes: [],
    selectedSession: undefined,
    theme: "light",
  })
  useStore.getState().handleEvent({
    type: "hello",
    sessions: [
      session("s1", "C:\dev\shop", "running"),
      session("s2", "C:\dev\blog"),
      session("s3", "D:\work\api"),
      session("s4", "D:\work\docs", "ended"),
    ],
    pending: [],
    health,
    usage: {},
  })
})
afterEach(cleanup)

const ctx = (over: Partial<CommandContext> = {}): CommandContext => ({
  theme: "light",
  themeFollows: false,
  hideEnded: true,
  barFolded: false,
  setBarFolded: () => undefined,
  go: () => undefined,
  setTheme: () => undefined,
  followSystem: () => undefined,
  toggleHelp: () => undefined,
  fire: () => undefined,
  ...over,
})
const labels = (c: Partial<CommandContext> = {}) => buildCommands(ctx(c)).map((x) => x.label)

describe("every menu action is in the palette", () => {
  it("the profile menu and the More menu offer nothing the palette does not", async () => {
    // A kept theme choice, so the menu also offers Follow Windows theme.
    useStore.setState({ themeFollows: false })
    render(<App />)
    const known = new Set([
      ...labels({ theme: "light" }),
      ...labels({ theme: "dark", themeFollows: true }),
      ...labels({ themeFollows: false }),
    ])
    await userEvent.click(screen.getByRole("button", { name: /Your profile and settings/ }))
    const profile = within(screen.getByRole("menu"))
      .getAllByRole("menuitem")
      .map((i) => i.textContent?.replace(/F1$|Ctrl K$/, "").trim() ?? "")
    expect(profile.length).toBeGreaterThan(5)
    expect(profile).toContain("Follow Windows theme")
    for (const name of profile) expect(known.has(name), `profile menu: ${name}`).toBe(true)
    fireEvent.keyDown(screen.getByRole("menu"), { key: "Escape" })
    await userEvent.click(screen.getByRole("button", { name: "More pages" }))
    const more = within(screen.getByRole("menu"))
      .getAllByRole("menuitem")
      .map((i) => i.textContent?.trim() ?? "")
    expect(more.length).toBeGreaterThan(3)
    for (const name of more.filter((n) => n !== "Edit sidebar..."))
      expect(known.has(name), `More menu: ${name}`).toBe(true)
  })

  it("every page of the app is a command", () => {
    const routes = new Set(buildCommands(ctx()).flatMap((c) => (c.page ? [c.page] : [])))
    for (const p of PAGES) expect(routes.has(p.route)).toBe(true)
    for (const r of [
      "dashboard",
      "chat",
      "usage",
      "approver",
      "guide",
      "devices",
      "audit",
      "policy",
      "settings",
    ])
      expect(routes.has(r as never), r).toBe(true)
  })
})

describe("Ctrl+1 to 9", () => {
  it("shows the session in that place in the sidebar, and nothing when there is none", () => {
    render(<App />)
    const order = railOrder(Object.values(useStore.getState().sessions), true)
    // The ended one is hidden, as in the sidebar, so it is not counted.
    expect(order.map((s) => s.id)).not.toContain("s4")
    fireEvent.keyDown(window, { key: "3", ctrlKey: true })
    expect(useStore.getState()).toMatchObject({ route: "workspace", selectedSession: order[2]!.id })
    fireEvent.keyDown(window, { key: "1", ctrlKey: true })
    expect(useStore.getState().selectedSession).toBe(order[0]!.id)
    // The fourth session has ended and the sidebar hides it, so there is no fourth place.
    useStore.setState({ route: "approvals", selectedSession: undefined })
    fireEvent.keyDown(window, { key: "4", ctrlKey: true })
    expect(useStore.getState()).toMatchObject({ route: "approvals", selectedSession: undefined })
    useStore.setState({ route: "approvals" })
    fireEvent.keyDown(window, { key: "9", ctrlKey: true })
    expect(useStore.getState().route).toBe("approvals")
  })
})

describe("the page you are on ranks its commands first", () => {
  it("puts them in their own group above the rest", async () => {
    render(<App />)
    useStore.setState({ route: "workspace", selectedSession: "s1" })
    fireEvent.keyDown(window, { key: "k", ctrlKey: true })
    const dialog = await screen.findByRole("dialog", { name: "Command palette" })
    const groups = [...dialog.querySelectorAll("[cmdk-group-heading]")].map((h) => h.textContent)
    expect(groups[0]).toContain("On this page")
    expect(within(dialog).getByText("Hide settings under the prompt box")).toBeTruthy()
  })

  it("lists the current page's commands before the others", () => {
    const list = buildCommands(ctx())
    const ranked = rankCommands(list, "usage")
    expect(ranked[0]!.page).toBe("usage")
    expect(ranked).toHaveLength(list.length)
    expect(new Set(ranked.map((c) => c.id)).size).toBe(list.length)
  })
})

describe("the shortcut sheet", () => {
  it("opens with Ctrl+/, lists every binding, and closes with Esc", async () => {
    render(<App />)
    fireEvent.keyDown(window, { key: "/", ctrlKey: true })
    const sheet = await screen.findByRole("dialog", { name: "Keyboard shortcuts" })
    for (const b of BINDINGS) {
      expect(within(sheet).getAllByText(b.label).length, b.label).toBeGreaterThan(0)
      expect(within(sheet).getByText(b.keys), b.keys).toBeTruthy()
    }
    fireEvent.keyDown(sheet, { key: "Escape" })
    expect(screen.queryByRole("dialog", { name: "Keyboard shortcuts" })).toBeNull()
  })

  it("lists every key the commands carry", () => {
    const sheet = new Set(BINDINGS.map((b) => b.keys))
    for (const c of buildCommands(ctx()))
      if (c.keys) expect(sheet.has(c.keys), `${c.label}: ${c.keys}`).toBe(true)
  })
})
