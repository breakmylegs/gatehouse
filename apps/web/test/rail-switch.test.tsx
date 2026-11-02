// @vitest-environment jsdom
// The Chat | Code switch (owner, 2 Nov): the sidebar shows one side at a time. Chat lists chats grouped by project with
// a Chats section for the rest; Code lists coding sessions by folder. The choice is kept, and it follows what you open.
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { groupChats } from "../src/lib/rail"

vi.mock("../src/lib/connection", () => ({
  takeToken: () => "token",
  Connection: class {
    start() {}
    send() {
      return Promise.resolve({ ok: true })
    }
  },
}))
vi.mock("../src/lib/api", () => ({
  api: vi.fn(async () => ({ ok: false, status: 404, error: "no route" })),
}))
globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
} as never

const { startConnection, useStore } = await import("../src/store")
const { Rail } = await import("../src/components/Rail")
startConnection()

const base = { mode: "default" as const, state: "idle" as const, pendingApprovals: 0 }
const code = {
  ...base,
  id: "c1",
  cwd: "C:\\dev\\shop",
  project: "shop",
  createdAt: "2026-11-02T08:00:00Z",
}
const chat = (id: string, title: string, at: string, extra: Record<string, unknown> = {}) => ({
  ...base,
  id,
  kind: "chat" as const,
  mode: "plan" as const,
  cwd: `C:\\data\\chats\\${id}`,
  project: id,
  title,
  createdAt: at,
  ...extra,
})

beforeEach(() => {
  localStorage.clear()
  useStore.setState({
    route: "sessions",
    selectedSession: undefined,
    panes: [],
    sessions: {
      c1: code,
      h1: chat("h1", "Prague trip", "2026-11-01T10:00:00Z"),
      h2: chat("h2", "RFP talking points", "2026-11-02T10:00:00Z", { chatProject: "Centrica" }),
      h3: chat("h3", "Volumes", "2026-11-02T09:00:00Z", { chatProject: "Centrica" }),
    },
  })
})
afterEach(cleanup)

describe("the Chat | Code switch", () => {
  it("shows coding sessions on Code, and chats grouped by project on Chat, and remembers the choice", () => {
    render(<Rail onHide={() => undefined} />)
    const side = screen.getByRole("radiogroup", { name: "Chats or coding" })
    expect(within(side).getByRole("radio", { name: /Code/ }).getAttribute("aria-checked")).toBe(
      "true",
    )
    expect(screen.getByText("shop")).toBeTruthy()
    expect(screen.queryByText("Prague trip")).toBeNull()
    expect(screen.getByRole("button", { name: /New session/ })).toBeTruthy()

    fireEvent.click(within(side).getByRole("radio", { name: /Chat/ }))
    expect(useStore.getState().route).toBe("chat")
    expect(localStorage.getItem("gatehouse.railMode")).toBe("chat")
    expect(screen.queryByText("shop")).toBeNull()
    expect(screen.queryByRole("button", { name: /New session/ })).toBeNull()
    expect(screen.getByRole("button", { name: /New chat/ })).toBeTruthy()
    const project = screen.getByRole("region", { name: /Centrica/ })
    expect(within(project).getAllByText(/RFP talking points|Volumes/)).toHaveLength(2)
    expect(
      within(screen.getByRole("region", { name: /in Chats/ })).getByText("Prague trip"),
    ).toBeTruthy()
  })

  it("follows what you open: a coding session brings back the Code side", () => {
    localStorage.setItem("gatehouse.railMode", "chat")
    render(<Rail onHide={() => undefined} />)
    act(() => useStore.setState({ route: "workspace", selectedSession: "c1" }))
    expect(screen.getByRole("radio", { name: /Code/ }).getAttribute("aria-checked")).toBe("true")
    act(() => useStore.setState({ route: "workspace", selectedSession: "h1" }))
    expect(screen.getByRole("radio", { name: /Chat/ }).getAttribute("aria-checked")).toBe("true")
  })
})

describe("chats grouped for the Chat side", () => {
  it("puts pinned first, then each project by name, then chats in no project, newest first, without archived ones", () => {
    const list = [
      chat("a", "A", "2026-11-01T00:00:00Z", { chatProject: "Zeta" }),
      chat("b", "B", "2026-11-02T00:00:00Z"),
      chat("c", "C", "2026-11-03T00:00:00Z", { chatProject: "Alpha" }),
      chat("d", "D", "2026-11-04T00:00:00Z", { pinned: true, chatProject: "Alpha" }),
      chat("e", "E", "2026-11-05T00:00:00Z", { archived: true }),
      chat("f", "F", "2026-11-06T00:00:00Z"),
    ]
    expect(groupChats(list).map((g) => [g.label, g.sessions.map((s) => s.id)])).toEqual([
      ["Pinned", ["d"]],
      ["Alpha", ["c"]],
      ["Zeta", ["a"]],
      ["Chats", ["f", "b"]],
    ])
  })
})
