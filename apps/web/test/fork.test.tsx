// @vitest-environment jsdom
// B13: fork an open session, or hand a side task to a new one (in a new worktree if you like), from the session's
// menu; both keep its mode, approval, model, effort and account, never looser.
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const sent: Array<Record<string, unknown>> = []
vi.mock("../src/store", async (orig) => {
  const actual = await orig<typeof import("../src/store")>()
  return {
    ...actual,
    send: vi.fn(async (cmd: Record<string, unknown>) => {
      sent.push(cmd)
      return cmd.type === "create_session" ? { ok: true, data: { sessionId: "s2" } } : { ok: true }
    }),
  }
})
vi.mock("../src/lib/api", () => ({
  api: vi.fn(async () => ({ ok: false, status: 404, error: "no route" })),
}))
globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
} as never

const { useStore } = await import("../src/store")
const { Rail } = await import("../src/components/Rail")

const session = (o: Record<string, unknown> = {}) => ({
  id: "s1",
  cwd: "C:\\dev\\shop",
  project: "shop",
  title: "Checkout work",
  mode: "acceptEdits" as const,
  extreme: true,
  model: "claude-opus-5-5",
  effort: "high" as const,
  account: "work",
  state: "idle" as const,
  pendingApprovals: 0,
  createdAt: "2026-11-03T01:00:00Z",
  sdkSessionId: "sdk-1",
  ...o,
})

beforeEach(() => {
  sent.length = 0
  localStorage.clear()
  useStore.setState({
    // The sidebar lists the sessions of the account you are looking at.
    activeAccount: "work",
    route: "sessions",
    panes: [],
    selectedSession: undefined,
    sessions: { s1: session() },
  })
})
afterEach(cleanup)

const menu = async () => {
  render(<Rail onHide={() => undefined} />)
  fireEvent.click(screen.getByRole("button", { name: "Actions for Checkout work" }))
  return screen.getByRole("menu")
}

describe("forking an open session", () => {
  it("starts a fork beside it, keeping its mode, approval, model, effort and account", async () => {
    fireEvent.click(within(await menu()).getByRole("menuitem", { name: "Fork" }))
    await waitFor(() => expect(sent.find((c) => c.type === "create_session")).toBeTruthy())
    expect(sent.find((c) => c.type === "create_session")).toEqual({
      type: "create_session",
      cwd: "C:\\dev\\shop",
      mode: "acceptEdits",
      extreme: true,
      model: "claude-opus-5-5",
      effort: "high",
      account: "work",
      resume: "sdk-1",
      fork: true,
    })
    await waitFor(() => expect(useStore.getState().panes).toContain("s2"))
  })

  it("waits while Claude is working", async () => {
    useStore.setState({ sessions: { s1: session({ state: "running" }) } })
    const item = within(await menu()).getByRole("menuitem", { name: "Fork" })
    expect(
      item.getAttribute("aria-disabled") === "true" || (item as HTMLButtonElement).disabled,
    ).toBe(true)
  })
})

describe("handing off a side task", () => {
  it("starts a new session in a new worktree, told what to do and where it came from", async () => {
    fireEvent.click(within(await menu()).getByRole("menuitem", { name: "Hand off a side task..." }))
    const dialog = screen.getByRole("dialog", { name: "Hand off a side task" })
    fireEvent.change(within(dialog).getByRole("textbox", { name: "What should it do?" }), {
      target: { value: "Write tests for the coupon code" },
    })
    fireEvent.click(within(dialog).getByRole("checkbox", { name: /In a new worktree/ }))
    fireEvent.click(within(dialog).getByRole("button", { name: "Start the side task" }))
    await waitFor(() => expect(sent.find((c) => c.type === "prompt")).toBeTruthy())
    expect(sent.find((c) => c.type === "create_session")).toEqual({
      type: "create_session",
      cwd: "C:\\dev\\shop",
      mode: "acceptEdits",
      extreme: true,
      model: "claude-opus-5-5",
      effort: "high",
      account: "work",
      worktree: {},
    })
    expect(String(sent.find((c) => c.type === "prompt")?.text)).toMatch(
      /^Write tests for the coupon code\n\n\(Handed off from the session "Checkout work", which works in C:\\dev\\shop\.\)$/,
    )
  })

  it("is not offered in a chat", async () => {
    useStore.setState({ route: "chat", sessions: { s1: session({ kind: "chat", mode: "plan" }) } })
    expect(within(await menu()).queryByRole("menuitem", { name: /Hand off/ })).toBeNull()
  })
})
