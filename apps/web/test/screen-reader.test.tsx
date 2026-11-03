// @vitest-environment jsdom
// B40: screen reader mode shows the whole conversation as one plain list, every message in order.
import { cleanup, render, screen, within } from "@testing-library/react"
import { forwardRef } from "react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { setScreenReaderMode } from "../src/lib/screenReader"
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
// The windowed list draws nothing here, as it draws only what is on screen.
vi.mock("react-virtuoso", () => ({
  Virtuoso: forwardRef(function V() {
    return <div data-testid="windowed" />
  }),
}))
globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
} as never

const items = Array.from({ length: 60 }, (_, i) =>
  i % 2 === 0
    ? { id: `u${i}`, kind: "user" as const, text: `Question ${i}` }
    : { id: `t${i}`, kind: "text" as const, text: `Answer ${i}` },
)

beforeEach(() => {
  localStorage.clear()
  useStore.setState({
    sessions: {
      s1: {
        id: "s1",
        cwd: "C:/dev/shop",
        project: "shop",
        mode: "default",
        state: "idle",
        pendingApprovals: 0,
        createdAt: "2026-11-03T09:00:00Z",
      },
    },
    transcripts: { s1: { items, todos: [], seq: items.length } } as never,
    pending: {},
    panes: [],
    selectedSession: "s1",
    route: "workspace",
  })
})
afterEach(() => {
  cleanup()
  setScreenReaderMode(false)
})

describe("screen reader mode", () => {
  it("draws every message, in order, in one list a screen reader can move through", () => {
    setScreenReaderMode(true)
    render(<Workspace />)
    const list = screen.getByRole("list", { name: "Conversation" })
    expect(within(list).getAllByRole("listitem").length).toBeGreaterThanOrEqual(60)
    expect(within(list).getByText("Question 0")).toBeTruthy()
    expect(within(list).getByText("Answer 59")).toBeTruthy()
    expect(screen.queryByTestId("windowed")).toBeNull()
  })

  it("is off until you switch it on, and then the quicker windowed list is used", () => {
    render(<Workspace />)
    expect(screen.queryByRole("list", { name: "Conversation" })).toBeNull()
    expect(screen.getByTestId("windowed")).toBeTruthy()
  })
})
