// @vitest-environment jsdom
// A session coming back after a restart is listed at once; what you write waits until it has started (owner, 31 Oct).
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { readInit } from "../src/lib/sessionMeta"
import { useStore } from "../src/store"
import { Workspace } from "../src/surfaces/Workspace"

const sent: Array<Record<string, unknown>> = []
const errors: string[] = []
vi.mock("../src/store", async (orig) => {
  const actual = await orig<typeof import("../src/store")>()
  return {
    ...actual,
    send: vi.fn(async (cmd: Record<string, unknown>) => {
      sent.push(cmd)
      return { ok: true }
    }),
  }
})
vi.mock("sonner", () => ({
  toast: Object.assign((m: string) => errors.push(m), { error: (m: string) => errors.push(m) }),
  Toaster: () => null,
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

beforeEach(() => {
  sent.length = 0
  errors.length = 0
  useStore.setState({
    sessions: {
      s1: {
        id: "s1",
        cwd: "C:/dev/shop",
        project: "shop",
        mode: "default",
        state: "idle",
        pendingApprovals: 0,
        createdAt: "2026-10-31T10:00:00Z",
      },
    },
    transcripts: {},
    pending: {},
    panes: [],
    selectedSession: "s1",
    meta: {
      s1: readInit({
        type: "system",
        subtype: "init",
        slash_commands: ["review"],
        skills: ["pdf"],
      })!,
    },
  })
})
afterEach(cleanup)

const prompts = () => sent.filter((c) => c.type === "prompt")

describe("a session still coming back", () => {
  it("keeps what you write and sends nothing until it has started", async () => {
    useStore.setState((st) => ({ sessions: { s1: { ...st.sessions.s1!, state: "starting" } } }))
    render(<Workspace />)
    const box = screen.getByRole("textbox", { name: "Prompt" }) as HTMLTextAreaElement
    fireEvent.change(box, { target: { value: "carry on with the tests" } })
    fireEvent.keyDown(box, { key: "Enter" })
    await waitFor(() => expect(errors).toEqual([expect.stringMatching(/still starting/)]))
    expect(prompts()).toEqual([])
    expect(box.value).toBe("carry on with the tests")
  })

  it("says it is being brought back, with the seconds so far, and Close puts it away at once", async () => {
    useStore.setState((st) => ({
      sessions: { s1: { ...st.sessions.s1!, state: "starting", restarted: { wasRunning: false } } },
    }))
    render(<Workspace />)
    expect(screen.getByRole("status")).toHaveTextContent(/Bringing this session back/)
    fireEvent.click(screen.getByRole("button", { name: "Close this session" }))
    await waitFor(() => expect(sent).toContainEqual({ type: "close_session", sessionId: "s1" }))
  })

  it("shows no such line once it has started", () => {
    render(<Workspace />)
    expect(screen.queryByRole("button", { name: "Close this session" })).toBeNull()
  })
})
