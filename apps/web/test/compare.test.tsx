// @vitest-environment jsdom
// B22: the same first message to several models, side by side, and the one you keep recorded.
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { forwardRef } from "react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { CompareBar } from "../src/components/CompareBar"
import { send, useStore } from "../src/store"
import { NewChat } from "../src/surfaces/NewChat"

let n = 0
vi.mock("sonner", () => ({
  toast: Object.assign(() => undefined, { error: () => undefined }),
  Toaster: () => null,
}))
vi.mock("../src/store", async (orig) => {
  const actual = await orig<typeof import("../src/store")>()
  return {
    ...actual,
    send: vi.fn(async (c: { type: string }) =>
      c.type === "create_session" ? { ok: true, data: { sessionId: `c${++n}` } } : { ok: true },
    ),
  }
})
vi.mock("../src/lib/api", () => ({
  api: vi.fn(async () => ({ ok: false, status: 404, error: "no route" })),
}))
vi.mock("react-virtuoso", () => ({
  Virtuoso: forwardRef(function V() {
    return <div />
  }),
}))

const sent = () =>
  vi.mocked(send).mock.calls.map((c) => c[0] as { type: string } & Record<string, unknown>)

beforeEach(() => {
  n = 0
  vi.mocked(send).mockClear()
  useStore.setState({ compare: undefined, panes: [], route: "chat", sessions: { code1: { id: "code1", cwd: "C:/dev/shop", project: "shop", mode: "default", state: "idle", pendingApprovals: 0, createdAt: "2026-11-06T09:00:00Z" } as never }, transcripts: {} })
})
afterEach(cleanup)

describe("comparing answers", () => {
  it("starts one chat for each model chosen, the same message to each, and opens them side by side", async () => {
    render(<NewChat />)
    fireEvent.change(screen.getByRole("textbox", { name: /message|what/i }), {
      target: { value: "Plan a launch" },
    })
    fireEvent.click(screen.getByRole("checkbox", { name: "Compare answers from several models" }))
    const start = screen.getByRole("button", { name: "Ask" })
    expect(start).toBeDisabled()
    fireEvent.click(screen.getByRole("checkbox", { name: "Opus 5.5" }))
    fireEvent.click(screen.getByRole("checkbox", { name: "Sonnet 5.5" }))
    expect(start).toBeEnabled()
    fireEvent.click(start)
    await waitFor(() => expect(useStore.getState().route).toBe("workspace"))
    const made = sent().filter((c) => c.type === "create_session")
    expect(made.map((c) => c.model)).toEqual(["claude-opus-5-5", "claude-sonnet-5-5"])
    expect(
      sent()
        .filter((c) => c.type === "prompt")
        .map((c) => [c.sessionId, c.text]),
    ).toEqual([
      ["c1", "Plan a launch"],
      ["c2", "Plan a launch"],
    ])
    expect(useStore.getState()).toMatchObject({
      panes: ["c1", "c2"],
      compare: { ids: ["c1", "c2"] },
    })
  })

  it("keeps the one you choose: recorded first, then the others close", async () => {
    const chat = (id: string, model: string) => ({
      id,
      cwd: "C:/chats/x",
      project: "x",
      kind: "chat" as const,
      model,
      mode: "plan" as const,
      state: "idle" as const,
      pendingApprovals: 0,
      createdAt: "2026-11-03T09:00:00Z",
    })
    useStore.setState({
      sessions: { c1: chat("c1", "claude-opus-5-5"), c2: chat("c2", "claude-sonnet-5-5") },
      compare: { ids: ["c1", "c2"], at: Date.now() - 4000 },
      transcripts: {
        c2: {
          items: [{ id: "t", kind: "text", text: "Here is a plan", at: Date.now() }],
          todos: [],
          seq: 1,
        },
      } as never,
      panes: ["c1", "c2"],
    })
    render(<CompareBar sessionId="c2" />)
    expect(screen.getByRole("group", { name: "Comparing 2 answers" }).textContent).toMatch(
      /Sonnet 5\.5.*answered in 4 s/,
    )
    fireEvent.click(screen.getByRole("button", { name: "Keep this one" }))
    await waitFor(() => expect(useStore.getState().compare).toBeUndefined())
    expect(sent()).toEqual([
      { type: "compare_chosen", kept: "c2", others: ["c1"] },
      { type: "close_session", sessionId: "c1" },
    ])
    expect(useStore.getState().panes).toEqual(["c2"])
  })
})
