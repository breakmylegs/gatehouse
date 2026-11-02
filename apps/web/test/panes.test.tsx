// @vitest-environment jsdom
// Up to four sessions side by side, and the sidebar fills the pane that has focus (owner, 1 Nov).
import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { forwardRef } from "react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { MAX_PANES, useStore } from "../src/store"
import { Workspace } from "../src/surfaces/Workspace"

vi.mock("../src/store", async (orig) => {
  const actual = await orig<typeof import("../src/store")>()
  return { ...actual, send: vi.fn(async () => ({ ok: true })) }
})
vi.mock("../src/lib/api", () => ({
  api: vi.fn(async () => ({ ok: false, status: 404, error: "no route" })),
}))
vi.mock("react-virtuoso", () => ({
  Virtuoso: forwardRef(function V() {
    return <div />
  }),
}))
globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
} as never

const session = (id: string) => ({
  id,
  cwd: `C:/dev/${id}`,
  project: id,
  mode: "default" as const,
  state: "idle" as const,
  pendingApprovals: 0,
  createdAt: "2026-11-01T09:00:00Z",
})
const ids = ["a1", "b2", "c3", "d4", "e5"]

beforeEach(() => {
  useStore.setState({
    sessions: Object.fromEntries(ids.map((i) => [i, session(i)])),
    transcripts: {},
    pending: {},
    panes: [],
    focusPane: 0,
    selectedSession: "a1",
    route: "workspace",
  })
})
afterEach(cleanup)

describe("sessions side by side", () => {
  it("fits four, not five", () => {
    const s = useStore.getState()
    for (const id of ["b2", "c3", "d4", "e5"]) s.openBeside(id)
    expect(MAX_PANES).toBe(4)
    expect(useStore.getState().panes).toEqual(["a1", "b2", "c3", "d4"])
    // Opening beside focuses the new pane.
    expect(useStore.getState().focusPane).toBe(3)
  })

  it("shows a session chosen in the sidebar in the pane with focus, and focuses one already on screen", () => {
    const s = useStore.getState()
    s.openBeside("b2")
    s.openBeside("c3")
    s.setFocusPane(1)
    useStore.getState().selectSession("d4")
    expect(useStore.getState().panes).toEqual(["a1", "d4", "c3"])
    expect(useStore.getState().selectedSession).toBe("d4")
    useStore.getState().selectSession("c3")
    expect(useStore.getState().panes).toEqual(["a1", "d4", "c3"])
    expect(useStore.getState().focusPane).toBe(2)
  })

  it("keeps a sensible focus when a pane closes", () => {
    const s = useStore.getState()
    s.openBeside("b2")
    s.openBeside("c3")
    useStore.getState().setFocusPane(2)
    useStore.getState().closePane(0)
    expect(useStore.getState().panes).toEqual(["b2", "c3"])
    expect(useStore.getState().focusPane).toBe(1)
    expect(useStore.getState().selectedSession).toBe("c3")
  })

  it("keeps the focus with the panes for the next start", () => {
    const s = useStore.getState()
    s.openBeside("b2")
    useStore.getState().setFocusPane(1)
    const saved = JSON.parse(localStorage.getItem("gatehouse.view") ?? "{}") as Record<
      string,
      unknown
    >
    expect(saved).toMatchObject({ panes: ["a1", "b2"], focus: 1 })
  })

  it("lays four out two by two, and marks the pane you click", () => {
    useStore.setState({ panes: ["a1", "b2", "c3", "d4"], focusPane: 0 })
    const { container } = render(<Workspace />)
    const grid = container.querySelector(".panes") as HTMLElement
    expect(grid.style.gridTemplateColumns).toBe("repeat(2, minmax(0, 1fr))")
    expect(grid.style.gridTemplateRows).toBe("repeat(2, minmax(0, 1fr))")
    const slots = [...container.querySelectorAll(".pane-slot")]
    expect(slots).toHaveLength(4)
    expect(slots[0]?.hasAttribute("data-focus")).toBe(true)
    fireEvent.mouseDown(slots[3] as HTMLElement)
    expect(useStore.getState().focusPane).toBe(3)
    expect(container.querySelectorAll(".pane-slot")[3]?.hasAttribute("data-focus")).toBe(true)
    expect(screen.getAllByRole("group", { name: "Side panels" })).toHaveLength(4)
  })
})
