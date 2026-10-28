// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { Workspace } from "../src/surfaces/Workspace"
import { useStore } from "../src/store"

vi.mock("../src/lib/api", () => ({
  api: vi.fn(async () => ({ ok: false, status: 404, error: "no route" })),
}))

globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
} as never

const session = (id: string, project: string) => ({
  id,
  cwd: `C:/dev/${project}`,
  project,
  mode: "default" as const,
  state: "idle" as const,
  pendingApprovals: 0,
  createdAt: `2026-10-28T10:0${id.slice(1)}:00Z`,
})

beforeEach(() => {
  useStore.setState({
    sessions: {
      s1: session("s1", "atlas"),
      s2: session("s2", "beacon"),
      s3: session("s3", "comet"),
    },
    transcripts: {},
    pending: {},
    panes: [],
    selectedSession: "s1",
  })
})
afterEach(cleanup)

const panes = () => screen.getAllByLabelText(/^Session (atlas|beacon|comet)$/)

describe("split view", () => {
  it("shows one session, then opens another beside it", () => {
    render(<Workspace />)
    expect(panes()).toHaveLength(1)
    fireEvent.change(screen.getByLabelText("Open another session beside this one"), {
      target: { value: "s2" },
    })
    expect(panes().map((p) => p.getAttribute("aria-label"))).toEqual([
      "Session atlas",
      "Session beacon",
    ])
    // Each pane has its own composer.
    expect(screen.getAllByRole("textbox", { name: /prompt/i }).length).toBeGreaterThanOrEqual(2)
  })

  it("allows at most three, and closes a pane", () => {
    useStore.setState({ panes: ["s1", "s2", "s3"] })
    render(<Workspace />)
    expect(panes()).toHaveLength(3)
    expect(screen.queryByLabelText("Open another session beside this one")).toBeNull()
    fireEvent.click(within(panes()[1]!).getByRole("button", { name: /close the pane/i }))
    expect(panes().map((p) => p.getAttribute("aria-label"))).toEqual([
      "Session atlas",
      "Session comet",
    ])
  })

  it("switching a pane to a session already on screen swaps the two", () => {
    useStore.setState({ panes: ["s1", "s2"] })
    render(<Workspace />)
    const first = panes()[0]!
    fireEvent.change(within(first).getAllByRole("combobox")[0]!, { target: { value: "s2" } })
    expect(useStore.getState().panes).toEqual(["s2", "s1"])
  })

  it("opening a session from elsewhere puts it in the first pane unless it is already shown", () => {
    useStore.setState({ panes: ["s1", "s2"] })
    useStore.getState().selectSession("s2")
    expect(useStore.getState().panes).toEqual(["s1", "s2"])
    useStore.getState().selectSession("s3")
    expect(useStore.getState().panes).toEqual(["s3", "s2"])
  })
})
