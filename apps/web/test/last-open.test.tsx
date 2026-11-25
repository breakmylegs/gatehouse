// @vitest-environment jsdom
// O54 (owner, 25 Nov): switching the sidebar between Code and Ask about code lands on the session you last had open on
// that side, in its panes, kept across restarts; New question (or the session list for Code) only when that session
// has gone or there is none. The Ask about code section does the same. Shared code, so the Mac and Windows agree.
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

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
const { lastOpenOf } = await import("../src/lib/lastOpen")
startConnection()

const base = { mode: "default" as const, state: "idle" as const, pendingApprovals: 0, createdAt: "2026-11-02T08:00:00Z" }
const code = (id: string) => ({ ...base, id, cwd: `C:\\dev\\${id}`, project: id })
const chat = (id: string) => ({ ...base, id, kind: "chat" as const, mode: "plan" as const, cwd: `C:\\data\\chats\\${id}`, project: id, title: `Question ${id}` })
const all = { c1: code("c1"), c2: code("c2"), h1: chat("h1"), h2: chat("h2") }

const side = () => screen.getByRole("radiogroup", { name: "Chats or coding" })
const toAsk = () => fireEvent.click(within(side()).getByRole("radio", { name: /Ask about code/ }))
const toCode = () => fireEvent.click(within(side()).getByRole("radio", { name: /^Code/ }))
const view = () => {
  const s = useStore.getState()
  return { route: s.route, selected: s.selectedSession, panes: s.panes }
}

beforeEach(() => {
  localStorage.clear()
  useStore.setState({ route: "sessions", selectedSession: undefined, panes: [], focusPane: 0, sessions: { ...all } })
})
afterEach(cleanup)

describe("switching sides reopens what you last had open (O54)", () => {
  it("lands on the chat you last had open, and back on Code on the session you left", () => {
    render(<Rail onHide={() => undefined} />)
    act(() => useStore.setState({ route: "workspace", selectedSession: "c2" }))
    act(() => useStore.setState({ route: "workspace", selectedSession: "h1" }))
    act(() => useStore.setState({ route: "sessions" }))
    toAsk()
    expect(view()).toMatchObject({ route: "workspace", selected: "h1" })
    toCode()
    expect(view()).toMatchObject({ route: "workspace", selected: "c2" })
  })

  it("restores the split panes the session was open in", () => {
    render(<Rail onHide={() => undefined} />)
    act(() => useStore.setState({ route: "workspace", selectedSession: "h2", panes: ["h1", "h2"], focusPane: 1 }))
    act(() => useStore.setState({ route: "workspace", selectedSession: "c1", panes: [] }))
    toAsk()
    expect(view()).toEqual({ route: "workspace", selected: "h2", panes: ["h1", "h2"] })
    expect(useStore.getState().focusPane).toBe(1)
  })

  it("keeps it across a restart, as the rail mode is kept", () => {
    localStorage.setItem("gatehouse.lastOpen", JSON.stringify({ chat: { selected: "h2", panes: [] }, extra: 1 }))
    render(<Rail onHide={() => undefined} />)
    toAsk()
    expect(view()).toMatchObject({ route: "workspace", selected: "h2" })
  })

  it("opens New question, or the session list for Code, when there is none or it was deleted", () => {
    render(<Rail onHide={() => undefined} />)
    toAsk()
    expect(view().route).toBe("chat")
    act(() => useStore.setState({ route: "workspace", selectedSession: "c1" }))
    act(() => useStore.setState({ route: "workspace", selectedSession: "h1" }))
    const { c1: _c, h1: _h, ...rest } = all
    act(() => useStore.setState({ sessions: rest }))
    toCode()
    expect(view().route).toBe("sessions")
    toAsk()
    expect(view().route).toBe("chat")
  })

  it("leaves out a deleted pane, and never reopens a session on the other side's switch", () => {
    localStorage.setItem("gatehouse.lastOpen", JSON.stringify({ chat: { selected: "h1", panes: ["h1", "gone", "c1"] }, code: { selected: "h1", panes: [] } }))
    expect(lastOpenOf("chat", all)).toEqual({ selected: "h1", panes: [] })
    expect(lastOpenOf("code", all)).toBeUndefined()
    localStorage.setItem("gatehouse.lastOpen", "not json")
    expect(lastOpenOf("chat", all)).toBeUndefined()
  })

  it("the Ask about code section reopens the last chat too", () => {
    render(<Rail onHide={() => undefined} />)
    act(() => useStore.setState({ route: "workspace", selectedSession: "h2" }))
    act(() => useStore.setState({ route: "sessions" }))
    fireEvent.click(screen.getByRole("button", { name: "Ask about code" }))
    expect(view()).toMatchObject({ route: "workspace", selected: "h2" })
  })
})
