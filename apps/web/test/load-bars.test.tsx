// @vitest-environment jsdom
// A processor and memory bar for each session (owner, 1 Nov), from what its limits helper reports.
import { cleanup, render, screen } from "@testing-library/react"
import { forwardRef } from "react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { loadBars, loadOf } from "../src/lib/load"
import { useStore } from "../src/store"
import { Workspace } from "../src/surfaces/Workspace"

vi.mock("sonner", () => ({
  toast: Object.assign(() => undefined, { error: () => undefined }),
  Toaster: () => null,
}))
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

beforeEach(() => {
  localStorage.clear()
  useStore.setState({
    sessions: {
      s1: {
        id: "s1",
        cwd: "C:/dev/shop",
        project: "shop",
        mode: "default",
        state: "running",
        pendingApprovals: 0,
        createdAt: "2026-11-03T09:00:00Z",
        resources: "medium",
      },
    },
    transcripts: {},
    pending: {},
    panes: [],
    selectedSession: "s1",
    route: "workspace",
    barFolded: false,
    load: {},
    activity: {},
    pulse: {},
  })
})
afterEach(cleanup)

describe("a session's processor and memory bars", () => {
  it("show nothing until the first reading, then what the Host said, in words too", () => {
    const { rerender } = render(<Workspace />)
    expect(screen.queryByRole("img", { name: /^Processor/ })).toBeNull()
    useStore.getState().handleEvent({
      type: "session_event",
      sessionId: "s1",
      event: "load",
      data: { cpu: 12.4, memoryMb: 3600, processes: 7, capMb: 4096, totalMb: 32768 },
    })
    rerender(<Workspace />)
    const bars = screen.getByRole("img", {
      name: "Processor 12% of this computer. Memory 3.5 GB of its 4.0 GB limit, in 7 processes.",
    })
    const [cpu, mem] = [...bars.querySelectorAll<HTMLElement>(".load-bar")]
    expect(cpu!.firstElementChild).toHaveStyle({ width: "12%" })
    // Near its cap the memory bar is marked.
    expect(mem!.hasAttribute("data-high")).toBe(true)
  })

  it("measure memory against this computer's when the level has no cap, and refuse a reading they cannot use", () => {
    const l = loadOf({ cpu: 50, memoryMb: 8192, processes: 1, capMb: 0, totalMb: 32768 })!
    expect(loadBars(l)).toMatchObject({ cpu: 50, memory: 25 })
    expect(loadBars(l).words).toContain("of this computer's 32 GB, in 1 process.")
    expect(loadOf({ cpu: "a lot", memoryMb: 1 })).toBeUndefined()
    expect(loadOf({ cpu: 1 })).toBeUndefined()
  })
})
