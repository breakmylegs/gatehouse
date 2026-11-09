// @vitest-environment jsdom
// B22: the same first message to several models, side by side, and the one you keep recorded.
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { forwardRef } from "react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { CompareBar } from "../src/components/CompareBar"
import { api } from "../src/lib/api"
import { send, useStore } from "../src/store"
import { NewChat } from "../src/surfaces/NewChat"
import { Sessions } from "../src/surfaces/Sessions"

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
  useStore.setState({
    compare: undefined,
    panes: [],
    route: "chat",
    sessions: {
      code1: {
        id: "code1",
        cwd: "C:/dev/shop",
        project: "shop",
        mode: "default",
        state: "idle",
        pendingApprovals: 0,
        createdAt: "2026-11-06T09:00:00Z",
      } as never,
    },
    transcripts: {},
  })
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

describe("best of several runs, each in its own worktree (G25)", () => {
  it("starts each run in a worktree with the same prompt, and opens them side by side", async () => {
    render(<Sessions />)
    fireEvent.change(screen.getByRole("textbox", { name: /^Folder/ }), {
      target: { value: "C:\\dev\\shop" },
    })
    fireEvent.click(screen.getByRole("checkbox", { name: /Work in a new worktree/ }))
    fireEvent.change(screen.getByRole("combobox", { name: "Runs" }), { target: { value: "3" } })
    const start = screen.getByRole("button", { name: "Start 3 runs" })
    expect(start).toBeDisabled()
    fireEvent.change(screen.getByRole("textbox", { name: /What every run is asked to do/ }), {
      target: { value: "Add a basket" },
    })
    fireEvent.click(start)
    await waitFor(() => expect(useStore.getState().route).toBe("workspace"))
    const made = sent().filter((c) => c.type === "create_session")
    expect(made).toHaveLength(3)
    for (const m of made) expect(m).toMatchObject({ cwd: "C:\\dev\\shop", worktree: {} })
    expect(
      sent()
        .filter((c) => c.type === "prompt")
        .map((c) => c.text),
    ).toEqual(["Add a basket", "Add a basket", "Add a basket"])
    expect(useStore.getState()).toMatchObject({
      panes: ["c1", "c2", "c3"],
      compare: { ids: ["c1", "c2", "c3"] },
    })
  })

  it("shows each run's changes, tests and calls that asked, and keeping one removes the others' worktrees after you say yes", async () => {
    const run = (id: string) => ({
      id,
      cwd: `C:/dev/shop.worktrees/${id}`,
      project: "shop",
      kind: "code" as const,
      mode: "default" as const,
      state: "idle" as const,
      pendingApprovals: 0,
      createdAt: "2026-11-09T09:00:00Z",
      worktree: { branch: `codehouse/${id}`, repo: "C:/dev/shop" },
    })
    vi.mocked(send).mockImplementation(async (c: { type: string }) =>
      c.type === "changes"
        ? {
            ok: true,
            data: {
              files: [
                { added: 10, removed: 2 },
                { added: 3, removed: 0 },
              ],
            },
          }
        : { ok: true },
    )
    useStore.setState({
      sessions: { r1: run("r1"), r2: run("r2") },
      compare: { ids: ["r1", "r2"], at: Date.now() },
      transcripts: {
        r1: {
          items: [{ id: "a", kind: "tool", toolUseId: "t1", name: "Bash", input: {} }],
          todos: [],
          seq: 1,
          testsFailing: false,
        },
      } as never,
      decisions: {
        t1: {
          outcome: "allow",
          decidedBy: "human-desktop",
          ruleId: "x",
          reason: "",
          risk: 50,
          at: 1,
        },
      },
      panes: ["r1", "r2"],
    })
    render(<CompareBar sessionId="r1" />)
    const bar = screen.getByRole("group", { name: "Comparing 2 runs" })
    await waitFor(() => expect(bar.textContent).toContain("2 files +13 -2"), { timeout: 4000 })
    expect(bar.textContent).toContain("tests passing")
    expect(bar.textContent).toContain("1 call asked or stopped")
    fireEvent.click(screen.getByRole("button", { name: "Keep this one" }))
    expect(sent().some((c) => c.type === "compare_chosen")).toBe(false)
    fireEvent.click(screen.getByRole("button", { name: "Keep this run" }))
    await waitFor(() => expect(useStore.getState().compare).toBeUndefined())
    expect(sent().filter((c) => c.type !== "changes")).toEqual([
      { type: "compare_chosen", kept: "r1", others: ["r2"] },
      { type: "close_session", sessionId: "r2" },
    ])
    expect(vi.mocked(api)).toHaveBeenCalledWith("POST", "/api/worktrees/remove", {
      path: "C:/dev/shop.worktrees/r2",
      force: true,
    })
  })
})
