// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { App } from "../src/App"
import { groupByFolder } from "../src/lib/rail"
import { useStore } from "../src/store"

const sent: unknown[] = []
vi.mock("../src/store", async (orig) => {
  const actual = await orig<typeof import("../src/store")>()
  return { ...actual, send: vi.fn(async (c: unknown) => (sent.push(c), { ok: true })) }
})
vi.mock("../src/lib/api", () => ({
  api: vi.fn(async () => ({ ok: false, status: 404, error: "no route" })),
}))
globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
} as never

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
const session = (id: string, cwd: string, state: "idle" | "waiting" | "running" = "idle") => ({
  id,
  cwd,
  project: cwd.split(/[\\/]/).at(-1) as string,
  mode: "default" as const,
  state,
  pendingApprovals: 0,
  createdAt: `2026-10-30T10:0${id.slice(1)}:00Z`,
})

beforeEach(() => {
  sent.length = 0
  localStorage.clear()
  useStore.setState({ route: "approvals", setupDone: true, panes: [], selectedSession: undefined })
  useStore.getState().handleEvent({
    type: "hello",
    sessions: [
      session("s1", "C:\\dev\\shop", "running"),
      session("s2", "C:\\dev\\blog", "waiting"),
      session("s3", "D:\\work\\api"),
    ],
    pending: [],
    health,
    usage: {},
  })
})
afterEach(cleanup)

describe("the sidebar", () => {
  it("groups sessions by the folder they sit in, those needing you first", () => {
    const groups = groupByFolder(Object.values(useStore.getState().sessions))
    expect(groups.map((g) => [g.label, g.sessions.map((s) => s.project)])).toEqual([
      ["dev", ["blog", "shop"]],
      ["work", ["api"]],
    ])
  })

  it("puts a session that needs you above newer ones", () => {
    const older = { ...session("s1", "C:/dev/old", "waiting"), createdAt: "2026-10-30T09:00:00Z" }
    const newer = { ...session("s2", "C:/dev/new", "running"), createdAt: "2026-10-30T11:00:00Z" }
    const newest = { ...session("s3", "C:/dev/idle"), createdAt: "2026-10-30T12:00:00Z" }
    expect(groupByFolder([newest, newer, older])[0]?.sessions.map((x) => x.project)).toEqual([
      "old",
      "new",
      "idle",
    ])
  })

  it("opens a session in the workspace from its row", async () => {
    render(<App />)
    const rail = screen.getByRole("navigation", { name: "Sidebar" })
    // The row itself, not its actions menu.
    await userEvent.click(within(rail).getAllByRole("button", { name: /shop/ })[0]!)
    expect(useStore.getState().route).toBe("workspace")
    expect(useStore.getState().selectedSession).toBe("s1")
  })

  it("keeps every other page in the profile menu, with the theme and help", async () => {
    render(<App />)
    await userEvent.click(screen.getByRole("button", { name: /Your profile and settings: alex/ }))
    const menu = screen.getByRole("menu")
    expect(within(menu).getByText("alex@example.com")).toBeTruthy()
    // Focus starts on the first action, and the arrow keys move.
    expect(within(menu).getByRole("menuitem", { name: "Settings" })).toHaveFocus()
    fireEvent.keyDown(menu, { key: "ArrowDown" })
    expect(within(menu).getByRole("menuitem", { name: "What Claude may do" })).toHaveFocus()
    await userEvent.click(within(menu).getByRole("menuitem", { name: "Jean-Claude dark" }))
    expect(useStore.getState().theme).toBe("dark")
    expect(screen.queryByRole("menu")).toBeNull()
  })

  it("closes a menu with Esc and gives focus back to its button", async () => {
    render(<App />)
    const more = screen.getByRole("button", { name: "More pages" })
    await userEvent.click(more)
    fireEvent.keyDown(screen.getByRole("menu"), { key: "Escape" })
    expect(screen.queryByRole("menu")).toBeNull()
    expect(more).toHaveFocus()
  })

  it("lets you choose which pages sit in it, and remembers", async () => {
    render(<App />)
    await userEvent.click(screen.getByRole("button", { name: "More pages" }))
    await userEvent.click(screen.getByRole("menuitem", { name: "Edit sidebar..." }))
    await userEvent.click(screen.getByRole("checkbox", { name: "Audit log" }))
    const rail = screen.getByRole("navigation", { name: "Sidebar" })
    expect(within(rail).getByRole("button", { name: "Audit log" })).toBeTruthy()
    expect(JSON.parse(localStorage.getItem("gatehouse.rail.pages") ?? "[]")).toContain("audit")
  })

  it("hides with Ctrl+B and comes back from its button, still saying what needs you", async () => {
    render(<App />)
    fireEvent.keyDown(window, { key: "b", ctrlKey: true })
    expect(screen.queryByRole("navigation", { name: "Sidebar" })).toBeNull()
    await userEvent.click(screen.getByRole("button", { name: /Sidebar/ }))
    expect(screen.getByRole("navigation", { name: "Sidebar" })).toBeTruthy()
  })
})
