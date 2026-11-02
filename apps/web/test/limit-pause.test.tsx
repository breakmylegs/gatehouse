// @vitest-environment jsdom
// A session Codehouse paused at the plan's 5-hour limit says so, and can be started at once (owner, 31 Oct).
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { useStore } from "../src/store"
import { Workspace } from "../src/surfaces/Workspace"
import { markStopping, reduce, emptyTranscript } from "../src/lib/transcript"

const sent: Array<Record<string, unknown>> = []
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
  toast: Object.assign(() => undefined, { error: () => undefined }),
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
        paused: { percent: 96, wasRunning: true, until: "2026-10-31T14:20:00+00:00" },
      },
    },
    transcripts: {},
    pending: {},
    panes: [],
    selectedSession: "s1",
  })
})
afterEach(cleanup)

describe("a session paused at the plan limit", () => {
  it("says why and when it starts again, and Start now asks the Host to start it", async () => {
    render(<Workspace />)
    expect(screen.getByRole("status")).toHaveTextContent(
      /Paused\. The plan's 5-hour limit reached 96%/,
    )
    expect(screen.getByRole("status")).toHaveTextContent(/part way through a turn/)
    expect(screen.getByRole("status")).toHaveTextContent(
      /starts again by itself when the limit resets at/,
    )
    fireEvent.click(screen.getByRole("button", { name: "Start now" }))
    await waitFor(() => expect(sent).toContainEqual({ type: "resume_session", sessionId: "s1" }))
  })

  it("shows Paused beside the name, and nothing once it has started again", () => {
    const { rerender } = render(<Workspace />)
    expect(screen.getAllByText("Paused").length).toBeGreaterThan(0)
    useStore.setState((st) => ({ sessions: { s1: { ...st.sessions.s1!, paused: undefined } } }))
    rerender(<Workspace />)
    expect(screen.queryByRole("button", { name: "Start now" })).toBeNull()
    expect(screen.queryByText("Paused")).toBeNull()
  })

  it("words the stopped turn as a pause, not as an error", () => {
    let t = markStopping(emptyTranscript(), "plan-limit")
    t = reduce(t, { type: "result", subtype: "error_during_execution", is_error: true, result: "" })
    expect(t.items.at(-1)).toMatchObject({
      kind: "result",
      isError: false,
      stopped: true,
      text: expect.stringMatching(/paused this turn because the plan's 5-hour limit/),
    })
  })
})

describe("what the transcript says about a pause", () => {
  it("has a line for the pause and for starting again", async () => {
    const { describeEvent } = await import("../src/store")
    expect(describeEvent("paused", { percent: 95.4 })).toMatch(/Paused: .* reached 95%/)
    expect(describeEvent("resumed", { by: "limit-reset" })).toMatch(
      /limit reset, so this session started again/,
    )
    expect(describeEvent("resumed", { by: "you" })).toBe("You started this session again.")
  })
})
