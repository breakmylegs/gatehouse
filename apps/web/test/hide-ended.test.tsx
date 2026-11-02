// @vitest-environment jsdom
// Owner, 31 Oct: ended sessions are hidden from the sidebar by default, a line shows them, and Archive all ended
// puts them all away at once.
import { cleanup, render, screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { App } from "../src/App"
import { groupByFolder } from "../src/lib/rail"
import { useStore } from "../src/store"

const sent: Array<Record<string, unknown>> = []
vi.mock("../src/store", async (orig) => {
  const actual = await orig<typeof import("../src/store")>()
  return {
    ...actual,
    send: vi.fn(async (c: Record<string, unknown>) => (sent.push(c), { ok: true })),
  }
})
vi.mock("sonner", () => ({
  toast: Object.assign(() => undefined, { error: () => undefined }),
  Toaster: () => null,
}))
vi.mock("../src/lib/api", () => ({
  api: vi.fn(async () => ({ ok: false, status: 404, error: "no route" })),
}))
globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
} as never

const health = {
  approver: { state: "up" as const, errors: [] },
  relay: { state: "not-configured" as const, devices: 0 },
  signin: {
    signedIn: true,
    email: "alex@example.com",
    organization: "Example Ltd",
    managedPolicy: "detected" as const,
    orgOk: true,
  },
  killSwitch: { engaged: false, approverConfirmed: true },
  pwsh: { running: true },
}
const session = (
  id: string,
  project: string,
  state: "idle" | "ended" | "error" | "running",
  more: Record<string, unknown> = {},
) => ({
  id,
  cwd: `C:\dev\${project}`,
  project,
  mode: "default" as const,
  state,
  pendingApprovals: 0,
  createdAt: `2026-10-30T10:0${id.slice(1)}:00Z`,
  sdkSessionId: `sdk-${id}`,
  ...more,
})

beforeEach(() => {
  sent.length = 0
  localStorage.clear()
  useStore.setState({ route: "approvals", setupDone: true, panes: [], selectedSession: undefined })
  useStore.getState().handleEvent({
    type: "hello",
    sessions: [
      session("s1", "shop", "running"),
      session("s2", "blog", "ended"),
      session("s3", "api", "ended"),
      session("s4", "docs", "error"),
    ],
    pending: [],
    health,
    usage: {},
  })
})
afterEach(cleanup)

const rail = () => screen.getByRole("navigation", { name: "Sidebar" })

describe("ended sessions in the sidebar", () => {
  it("are hidden by default, with a line that says how many and shows them", async () => {
    render(<App />)
    const list = within(rail()).getByLabelText("Sessions")
    expect(within(list).queryByText(/blog/)).toBeNull()
    expect(within(list).queryByText(/api/)).toBeNull()
    // Working and failed sessions stay.
    expect(within(list).getByText(/shop/)).toBeTruthy()
    expect(within(list).getByText(/docs/)).toBeTruthy()
    expect(within(list).getByText(/2 ended sessions are hidden/)).toBeTruthy()
    await userEvent.click(within(list).getByRole("button", { name: "Show" }))
    expect(within(list).getByText(/blog/)).toBeTruthy()
    expect(within(list).queryByText(/ended sessions are hidden/)).toBeNull()
    expect(localStorage.getItem("gatehouse.rail.hideEnded")).toBe("0")
  })

  it("stay shown once you chose to show them, and can be hidden again from the menu", async () => {
    localStorage.setItem("gatehouse.rail.hideEnded", "0")
    render(<App />)
    const list = within(rail()).getByLabelText("Sessions")
    expect(within(list).getByText(/blog/)).toBeTruthy()
    await userEvent.click(within(list).getByRole("button", { name: "Sessions list options" }))
    await userEvent.click(screen.getByRole("menuitem", { name: "Hide ended sessions" }))
    expect(within(list).queryByText(/blog/)).toBeNull()
    expect(localStorage.getItem("gatehouse.rail.hideEnded")).toBe("1")
  })

  it("keep an entry for one you have open", () => {
    const all = Object.values(useStore.getState().sessions)
    const keep = new Set<string | undefined>(["s2"])
    const shown = groupByFolder(all, { ended: true, keep }).flatMap((g) =>
      g.sessions.map((s) => s.id),
    )
    expect(shown.sort()).toEqual(["s1", "s2", "s4"])
    expect(groupByFolder(all).flatMap((g) => g.sessions)).toHaveLength(4)
  })

  it("are all archived at once from the menu, and nothing else is", async () => {
    render(<App />)
    const list = within(rail()).getByLabelText("Sessions")
    await userEvent.click(within(list).getByRole("button", { name: "Sessions list options" }))
    await userEvent.click(screen.getByRole("menuitem", { name: "Archive all ended (2)" }))
    await waitFor(() => expect(sent.filter((c) => c.type === "session_meta")).toHaveLength(2))
    expect(
      sent
        .filter((c) => c.type === "session_meta")
        .map((c) => c.sdkSessionId)
        .sort(),
    ).toEqual(["sdk-s2", "sdk-s3"])
    expect(sent.every((c) => c.archived === true || c.type !== "session_meta")).toBe(true)
    expect(sent.some((c) => c.type === "close_session")).toBe(false)
  })

  it("leave nothing to archive when none has ended", async () => {
    useStore.getState().handleEvent({
      type: "hello",
      sessions: [session("s1", "shop", "running")],
      pending: [],
      health,
      usage: {},
    })
    render(<App />)
    await userEvent.click(within(rail()).getByRole("button", { name: "Sessions list options" }))
    expect(screen.getByRole("menuitem", { name: "Archive all ended" })).toBeDisabled()
  })
})
