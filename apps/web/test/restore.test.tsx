// @vitest-environment jsdom
// After JCVC restarts or updates, the window comes back as it was: the same page and panes, each session's earlier
// conversation, and what you had typed but not sent (owner, 30 Oct: nothing lost).
import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const sent: Array<Record<string, unknown>> = []
let history: unknown[] = []
let release: () => void = () => undefined
vi.mock("../src/lib/connection", () => ({
  takeToken: () => "token",
  Connection: class {
    start() {}
    send(cmd: Record<string, unknown>) {
      sent.push(cmd)
      if (cmd.type === "history_messages")
        return new Promise((r) => (release = () => r({ ok: true, data: history })))
      return Promise.resolve({ ok: true })
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

const info = (over: Record<string, unknown> = {}) => ({
  id: "019a0000-0000-7000-8000-00000000000a",
  cwd: "C:\\dev\\shop",
  project: "shop",
  mode: "default" as const,
  state: "idle" as const,
  pendingApprovals: 0,
  createdAt: "2026-10-30T09:00:00Z",
  ...over,
})

beforeEach(() => {
  sent.length = 0
  history = []
  localStorage.clear()
  vi.resetModules()
})
afterEach(cleanup)

describe("after a restart", () => {
  it("shows what was said before, once, ahead of anything new, and says a turn was cut off", async () => {
    const { useStore, startConnection } = await import("../src/store")
    startConnection()
    history = [
      {
        type: "user",
        message: { role: "user", content: "Fix the login bug" },
        parent_tool_use_id: null,
      },
      {
        type: "assistant",
        message: { content: [{ type: "text", text: "Fixed it in auth.ts." }] },
        parent_tool_use_id: null,
      },
    ]
    const s = info({ historyFrom: "sdk-a", restarted: { wasRunning: true } })
    const h = useStore.getState().handleEvent
    h({ type: "session", info: s })
    h({ type: "session", info: { ...s, state: "running" } })
    expect(sent.filter((c) => c.type === "history_messages")).toEqual([
      { type: "history_messages", sdkSessionId: "sdk-a", cwd: "C:\\dev\\shop" },
    ])
    // Something new arrives before the earlier conversation is read; its ids are made the same way.
    for (const text of ["Now", "Then"])
      h({
        type: "sdk_message",
        sessionId: s.id,
        message: { type: "assistant", message: { content: [{ type: "text", text }] } },
      })
    release()
    await vi.waitFor(() =>
      expect(
        useStore.getState().transcripts[s.id]?.items.map((i) => [i.kind, "text" in i && i.text]),
      ).toEqual([
        ["user", "Fix the login bug"],
        ["text", "Fixed it in auth.ts."],
        [
          "system",
          "JCVC restarted while Claude was working, so that turn stopped. Send a message to carry on.",
        ],
        ["text", "Now"],
        ["text", "Then"],
      ]),
    )
    const items = useStore.getState().transcripts[s.id]?.items ?? []
    // Times JCVC did not see are not invented, and no id is used twice.
    expect(items.slice(0, 3).every((i) => i.at === undefined)).toBe(true)
    expect(new Set(items.map((i) => i.id)).size).toBe(items.length)
  })

  it("asks for nothing for a session that starts fresh", async () => {
    const { useStore, startConnection } = await import("../src/store")
    startConnection()
    useStore.getState().handleEvent({ type: "session", info: info() })
    expect(sent.filter((c) => c.type === "history_messages")).toEqual([])
  })

  it("opens on the page and panes you had", async () => {
    localStorage.setItem("gatehouse.setup", "done")
    const first = await import("../src/store")
    first.useStore.setState({ route: "workspace", panes: ["a", "b"], selectedSession: "a" })
    vi.resetModules()
    const next = await import("../src/store")
    expect(next.useStore.getState()).toMatchObject({
      route: "workspace",
      panes: ["a", "b"],
      selectedSession: "a",
    })
    expect(next.START_ROUTE).toBe("workspace")
    // A page that is only a step on the way, such as starting a chat, opens Approvals instead.
    next.useStore.setState({ route: "chat" })
    vi.resetModules()
    expect((await import("../src/store")).useStore.getState().route).toBe("approvals")
  })

  it("keeps what you typed and had not sent", async () => {
    localStorage.setItem("gatehouse.setup", "done")
    const { useStore } = await import("../src/store")
    const { Workspace } = await import("../src/surfaces/Workspace")
    const s = info()
    useStore.setState({
      conn: "open",
      sessions: { [s.id]: s },
      route: "workspace",
      selectedSession: s.id,
      panes: [s.id],
    })
    render(<Workspace />)
    fireEvent.change(screen.getByRole("textbox", { name: "Prompt" }), {
      target: { value: "half a thought" },
    })
    await new Promise((r) => setTimeout(r, 400))
    cleanup()
    render(<Workspace />)
    expect((screen.getByRole("textbox", { name: "Prompt" }) as HTMLTextAreaElement).value).toBe(
      "half a thought",
    )
  })
})
