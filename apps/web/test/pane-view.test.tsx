// @vitest-environment jsdom
// Text size and spacing are kept per session, and come back after a restart (owner, 31 Oct, O5).
import { cleanup, render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { DEFAULT_VIEW, readPaneView, savePaneView, stepSize } from "../src/lib/paneView"
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

const base = {
  cwd: "C:/dev/shop",
  project: "shop",
  mode: "default" as const,
  state: "idle" as const,
  pendingApprovals: 0,
  createdAt: "2026-10-31T10:00:00Z",
}

beforeEach(() => {
  localStorage.clear()
  useStore.setState({
    sessions: { s1: { id: "s1", ...base }, s2: { id: "s2", ...base, project: "blog" } },
    transcripts: {},
    pending: {},
    panes: [],
    selectedSession: "s1",
  })
})
afterEach(cleanup)

const pane = () => screen.getByLabelText(/^Session shop/)
const menu = async () =>
  userEvent.click(screen.getByRole("button", { name: /shop: switch, open beside/ }))

describe("the saved view of a session", () => {
  it("steps through the sizes and stops at the ends", () => {
    expect(stepSize(100, 1)).toBe(115)
    expect(stepSize(130, 1)).toBe(130)
    expect(stepSize(90, -1)).toBe(90)
    expect(stepSize(77, 1)).toBe(115)
  })

  it("keeps a view per session, drops what it cannot read, and stores nothing for the usual look", () => {
    savePaneView("a", { size: 130, density: "compact", detail: "normal" })
    expect(readPaneView("a")).toEqual({ size: 130, density: "compact", detail: "normal" })
    expect(readPaneView("b")).toEqual(DEFAULT_VIEW)
    localStorage.setItem("gatehouse.pane.c", '{"size":9999,"density":"loose"}')
    expect(readPaneView("c")).toEqual(DEFAULT_VIEW)
    localStorage.setItem("gatehouse.pane.d", "{ not json")
    expect(readPaneView("d")).toEqual(DEFAULT_VIEW)
    savePaneView("a", DEFAULT_VIEW)
    expect(localStorage.getItem("gatehouse.pane.a")).toBeNull()
  })
})

describe("a session's view in its pane", () => {
  it("changes its text size and spacing from the pane menu, and keeps them for that session only", async () => {
    const { unmount } = render(<Workspace />)
    expect(pane().getAttribute("data-density")).toBe("comfortable")
    await menu()
    await userEvent.click(screen.getByRole("menuitem", { name: "Larger text" }))
    expect(pane().style.getPropertyValue("--pane-scale")).toBe("1.15")
    await menu()
    await userEvent.click(screen.getByRole("menuitem", { name: "Compact spacing" }))
    expect(pane().getAttribute("data-density")).toBe("compact")
    // After a restart the window opens again: the same session has the same view.
    unmount()
    render(<Workspace />)
    expect(pane().style.getPropertyValue("--pane-scale")).toBe("1.15")
    expect(pane().getAttribute("data-density")).toBe("compact")
    // The other session is as it was.
    expect(readPaneView("s2")).toEqual(DEFAULT_VIEW)
  })

  it("offers Comfortable spacing once compact, and Smaller text until the smallest", async () => {
    savePaneView("s1", { size: 90, density: "compact", detail: "normal" })
    render(<Workspace />)
    await menu()
    expect(screen.getByRole("menuitem", { name: "Comfortable spacing" })).toBeTruthy()
    expect(screen.getByRole("menuitem", { name: "Smaller text" })).toBeDisabled()
  })
})
