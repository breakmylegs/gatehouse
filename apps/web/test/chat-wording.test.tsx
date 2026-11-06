// @vitest-environment jsdom
// A chat is a conversation with Claude, not Claude Code, so its screens do not say Claude Code (owner, 31 Oct,
// screenshot d3b9c0). A coding session still does.
import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { useStore } from "../src/store"
import { NewChat } from "../src/surfaces/NewChat"
import { Workspace } from "../src/surfaces/Workspace"

let hold: (() => void) | undefined
vi.mock("../src/store", async (orig) => {
  const actual = await orig<typeof import("../src/store")>()
  return {
    ...actual,
    send: vi.fn(async (cmd: Record<string, unknown>) => {
      // The session takes its time to start, so the start line stays on screen.
      if (cmd.type === "create_session") await new Promise<void>((r) => (hold = r))
      return { ok: true, data: { sessionId: "c1" } }
    }),
  }
})
vi.mock("sonner", () => ({
  toast: Object.assign(() => undefined, { error: () => undefined }),
  Toaster: () => null,
}))
vi.mock("../src/lib/api", () => ({
  api: vi.fn(async () => ({ ok: false, status: 404, error: "no route" })),
}))
vi.mock("react-virtuoso", () => ({ Virtuoso: () => <div /> }))
globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
} as never

const info = (kind?: "chat") => ({
  id: "s1",
  cwd: "C:/dev/shop",
  project: "shop",
  mode: kind ? ("plan" as const) : ("default" as const),
  state: "error" as const,
  pendingApprovals: 0,
  createdAt: "2026-10-31T10:00:00Z",
  ...(kind ? { kind } : {}),
})

beforeEach(() => {
  hold = undefined
  useStore.setState({ sessions: { code1: { id: "code1", cwd: "C:/dev/shop", project: "shop", mode: "default", state: "idle", pendingApprovals: 0, createdAt: "2026-11-06T09:00:00Z" } as never }, transcripts: {}, panes: [], route: "chat", pending: {} })
})
afterEach(() => {
  hold?.()
  cleanup()
})

describe("starting a chat", () => {
  it("says it is starting your chat, and never Claude Code", async () => {
    render(<NewChat />)
    fireEvent.change(screen.getByRole("textbox", { name: "What do you want to know?" }), {
      target: { value: "How do vite proxies work?" },
    })
    fireEvent.click(screen.getByRole("button", { name: "Ask" }))
    expect(await screen.findByText("Starting your chat")).toBeTruthy()
    expect(document.body.textContent).not.toMatch(/Claude Code/)
  })
})

describe("a chat that stopped without saying why", () => {
  it("names Claude, and a coding session still names Claude Code", () => {
    useStore.setState({ sessions: { s1: info("chat") as never }, selectedSession: "s1" })
    const { unmount } = render(<Workspace />)
    expect(screen.getByRole("alert").textContent).toContain("Claude did not say why")
    expect(screen.getByRole("alert").textContent).not.toContain("Claude Code")
    unmount()
    useStore.setState({ sessions: { s1: info() as never }, selectedSession: "s1" })
    render(<Workspace />)
    expect(screen.getByRole("alert").textContent).toContain("Claude Code did not say why")
  })
})
