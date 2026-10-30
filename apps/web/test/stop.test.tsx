// @vitest-environment jsdom
// A session doing work in the background says so, and Stop stops it there and then, with Force stop for one that
// does not stop when asked (owner, 30 Oct).
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const sent: Array<Record<string, unknown>> = []
vi.mock("../src/lib/connection", () => ({
  takeToken: () => "token",
  Connection: class {
    start() {}
    send(cmd: Record<string, unknown>) {
      sent.push(cmd)
      return Promise.resolve({ ok: true, data: [] })
    }
  },
}))
vi.mock("../src/lib/api", () => ({
  api: vi.fn(async () => ({ ok: false, status: 404, error: "no route" })),
}))
vi.mock("react-virtuoso", () => ({
  Virtuoso: ({
    data,
    itemContent,
  }: {
    data: unknown[]
    itemContent: (i: number, d: unknown) => React.ReactNode
  }) => (
    <div>
      {data.map((d, i) => (
        <div key={i}>{itemContent(i, d)}</div>
      ))}
    </div>
  ),
}))
globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
} as never

const { startConnection, useStore } = await import("../src/store")
const { Workspace, FORCE_AFTER_MS } = await import("../src/surfaces/Workspace")
const { Rail } = await import("../src/components/Rail")
startConnection()

const ID = "019a0000-0000-7000-8000-00000000000a"
const session = (over: Record<string, unknown> = {}) => ({
  id: ID,
  cwd: "C:\\dev\\Proscenia",
  project: "Proscenia",
  mode: "default" as const,
  state: "idle" as const,
  pendingApprovals: 0,
  createdAt: "2026-10-30T09:00:00Z",
  ...over,
})

beforeEach(() => {
  sent.length = 0
  useStore.setState({
    conn: "open",
    sessions: { [ID]: session({ background: ["Sweep the auth module", "Sweep billing"] }) },
    transcripts: {},
    route: "workspace",
    selectedSession: ID,
    panes: [ID],
    setupDone: true,
  })
})
afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

describe("work in the background", () => {
  it("says the session is working while background tasks run after the turn ended", () => {
    render(<Workspace />)
    const pane = screen.getByLabelText("Session Proscenia")
    expect(within(pane).getByText("Working in the background")).toBeTruthy()
    expect(within(pane).getByRole("status").textContent).toBe("2 tasks working in the background")
    expect(within(pane).getByText("Sweep the auth module, Sweep billing")).toBeTruthy()
    cleanup()
    render(<Rail onHide={() => undefined} />)
    const row = screen.getAllByRole("button", { name: /Proscenia/ })[0] as HTMLElement
    expect(row.textContent).toContain("Working")
  })

  it("stops everything with Stop, and offers Force stop if it is still working", () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    render(<Workspace />)
    expect(screen.queryByRole("button", { name: "Force stop" })).toBeNull()
    fireEvent.click(screen.getByRole("button", { name: "Stop" }))
    expect(sent.at(-1)).toEqual({ type: "stop_session", sessionId: ID })
    expect(screen.getByRole("button", { name: "Stopping" })).toBeTruthy()
    act(() => vi.advanceTimersByTime(FORCE_AFTER_MS + 1000))
    fireEvent.click(screen.getByRole("button", { name: "Force stop" }))
    expect(sent.at(-1)).toEqual({ type: "force_stop", sessionId: ID })
  })

  it("offers nothing to stop once the session has nothing to do", () => {
    useStore.setState({ sessions: { [ID]: session() } })
    render(<Workspace />)
    expect(screen.queryByRole("button", { name: "Stop" })).toBeNull()
  })

  it("says the session was force-stopped, keeping what is on screen", async () => {
    useStore.getState().addUserText(ID, "Sweep it all")
    useStore.getState().handleEvent({
      type: "session",
      info: session({ historyFrom: "sdk-1", restarted: { wasRunning: true, forced: true } }),
    })
    const items = useStore.getState().transcripts[ID]?.items ?? []
    expect(items.map((i) => i.kind)).toEqual(["user", "system"])
    expect(items[1]).toMatchObject({
      text: expect.stringContaining("You force-stopped this session"),
    })
    expect(sent.some((c) => c.type === "history_messages")).toBe(false)
  })
})
