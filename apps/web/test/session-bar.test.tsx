// @vitest-environment jsdom
// The session bar and the activity detail fold away, every pane follows, and the choice is kept (owner, 31 Oct, O3).
import { cleanup, render, screen, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { useStore } from "../src/store"
import { Workspace } from "../src/surfaces/Workspace"

vi.mock("../src/store", async (orig) => {
  const actual = await orig<typeof import("../src/store")>()
  return { ...actual, send: vi.fn(async () => ({ ok: true })) }
})
vi.mock("sonner", () => ({
  toast: Object.assign(() => undefined, { error: () => undefined }),
  Toaster: () => null,
}))
vi.mock("../src/lib/api", () => ({
  api: vi.fn(async () => ({ ok: false, status: 404, error: "no route" })),
}))
vi.mock("react-virtuoso", () => ({
  Virtuoso: () => <div />,
}))
globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
} as never

const base = {
  mode: "default" as const,
  pendingApprovals: 0,
  createdAt: "2026-10-31T10:00:00Z",
  resources: "high" as const,
}
const open = (panes: string[]) =>
  useStore.setState({
    sessions: {
      s1: { id: "s1", cwd: "C:/dev/shop", project: "shop", state: "running", ...base },
      s2: { id: "s2", cwd: "C:/dev/blog", project: "blog", state: "idle", ...base },
    },
    transcripts: {},
    pending: {},
    panes,
    selectedSession: panes[0],
    activity: {},
    pulse: {},
  })

beforeEach(() => {
  localStorage.clear()
  useStore.setState({ barFolded: false })
  open(["s1", "s2"])
})
afterEach(cleanup)

const panes = () => [screen.getByLabelText(/^Session shop/), screen.getByLabelText(/^Session blog/)]

describe("folding the session bar", () => {
  it("hides the model and settings in every pane at once, keeps Stop, and brings them back", async () => {
    render(<Workspace />)
    for (const p of panes())
      expect(within(p).getByRole("group", { name: "Model, effort and mode" })).toBeTruthy()
    await userEvent.click(within(panes()[0]!).getByRole("button", { name: "Hide settings" }))
    for (const p of panes()) {
      expect(within(p).queryByRole("group", { name: "Model, effort and mode" })).toBeNull()
      expect(within(p).getByRole("button", { name: "Show model and settings" })).toBeTruthy()
    }
    expect(within(panes()[0]!).getByRole("button", { name: /Stop/ })).toBeTruthy()
    await userEvent.click(
      within(panes()[1]!).getByRole("button", { name: "Show model and settings" }),
    )
    for (const p of panes())
      expect(within(p).getByRole("group", { name: "Model, effort and mode" })).toBeTruthy()
  })

  it("is kept for next time", async () => {
    render(<Workspace />)
    await userEvent.click(within(panes()[0]!).getByRole("button", { name: "Hide settings" }))
    expect(localStorage.getItem("gatehouse.sessionbar.folded")).toBe("1")
  })

  it("shortens the activity line to its label while folded, and shows its detail again when unfolded", async () => {
    // Claude is running a tool, so the line has a label and a detail (the seconds so far).
    useStore.setState({
      activity: {
        s1: {
          phase: "running",
          since: Date.now() - 5000,
          tool: "Read",
          toolUseId: "t1",
          target: "src/app.ts",
        },
      },
    })
    render(<Workspace />)
    const line = () => within(panes()[0]!).getAllByRole("status")[0]!.parentElement!
    expect(line().textContent).toMatch(/\d+ s/)
    await userEvent.click(within(panes()[0]!).getByRole("button", { name: "Hide settings" }))
    expect(line().textContent).not.toMatch(/\d+ s/)
    await userEvent.click(
      within(panes()[0]!).getByRole("button", { name: "Show model and settings" }),
    )
    expect(line().textContent).toMatch(/\d+ s/)
  })
})
