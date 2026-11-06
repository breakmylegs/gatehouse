// @vitest-environment jsdom
// The Chat | Code switch (owner, 2 Nov): the sidebar shows one side at a time. Chat lists chats grouped by project with
// a Chats section for the rest; Code lists coding sessions by folder. The choice is kept, and it follows what you open.
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { groupChats, recencyOf } from "../src/lib/rail"

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

    // Owner, 6 Nov: the other side is Ask about code, for questions about your code sessions.
    fireEvent.click(within(side).getByRole("radio", { name: /Ask about code/ }))
    expect(useStore.getState().route).toBe("chat")
    expect(localStorage.getItem("gatehouse.railMode")).toBe("chat")
    expect(screen.queryByText("shop")).toBeNull()
    expect(screen.queryByRole("button", { name: /New session/ })).toBeNull()
    expect(screen.getByRole("button", { name: /New question/ })).toBeTruthy()
    const project = screen.getByRole("region", { name: /Centrica/ })
    expect(within(project).getAllByText(/RFP talking points|Volumes/)).toHaveLength(2)
    expect(
      // A chat in no project is under when it was started, which depends on today (CH-03).
      within(
        screen.getByRole("region", { name: /in (Today|Yesterday|Previous \d+ days|Older)$/ }),
      ).getByText("Prague trip"),
    ).toBeTruthy()
  })

  it("follows what you open: a coding session brings back the Code side", () => {
    localStorage.setItem("gatehouse.railMode", "chat")
    render(<Rail onHide={() => undefined} />)
    act(() => useStore.setState({ route: "workspace", selectedSession: "c1" }))
    expect(screen.getByRole("radio", { name: /Code/ }).getAttribute("aria-checked")).toBe("true")
    act(() => useStore.setState({ route: "workspace", selectedSession: "h1" }))
    expect(screen.getByRole("radio", { name: /Ask about code/ }).getAttribute("aria-checked")).toBe(
      "true",
    )
  })

  it("asks about a code session from its menu: the new question page, with that session chosen", async () => {
    render(<Rail onHide={() => undefined} />)
    fireEvent.click(screen.getByRole("button", { name: "Actions for shop" }))
    fireEvent.click(await screen.findByRole("menuitem", { name: "Ask about this session..." }))
    expect(useStore.getState()).toMatchObject({ route: "chat", newChatAbout: "c1" })
    expect(localStorage.getItem("gatehouse.railMode")).toBe("chat")
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
      chat("f", "F", "2026-11-06T09:00:00Z"),
    ]
    const now = new Date(2026, 10, 6, 18)
    expect(
      groupChats(list, undefined, now).map((g) => [g.label, g.sessions.map((s) => s.id)]),
    ).toEqual([
      ["Pinned", ["d"]],
      ["Alpha", ["c"]],
      ["Zeta", ["a"]],
      ["Today", ["f"]],
      ["Previous 7 days", ["b"]],
    ])
  })

  it("puts chats in no project under when they were started, as in Claude's desktop app (CH-03)", () => {
    const now = new Date(2026, 10, 6, 18)
    const at = (d: number, h = 12) => new Date(2026, 10, d, h).toISOString()
    expect(recencyOf(at(6, 0), now)).toBe("Today")
    expect(recencyOf(at(5, 23), now)).toBe("Yesterday")
    expect(recencyOf(at(5, 0), now)).toBe("Yesterday")
    expect(recencyOf(at(4), now)).toBe("Previous 7 days")
    expect(recencyOf(at(-1), now)).toBe("Previous 7 days")
    expect(recencyOf(at(-10), now)).toBe("Previous 30 days")
    expect(recencyOf(new Date(2026, 8, 1).toISOString(), now)).toBe("Older")
    expect(recencyOf("not a date", now)).toBe("Older")
    expect(recencyOf(at(9), now)).toBe("Today")
  })
})
