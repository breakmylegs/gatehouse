// @vitest-environment jsdom
// B16: a session in a window of its own, and back in the main window when that window closes.
import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { forwardRef } from "react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { startShell } from "../src/lib/quickKey"
import { useStore } from "../src/store"
import { PanePage } from "../src/surfaces/PanePage"
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

// The Codehouse window: what the page posts, and a way to send it a message.
const posted: string[] = []
let deliver: ((e: { data: unknown }) => void) | undefined
const session = (id: string, project: string) => ({
  id,
  cwd: `C:/dev/${project}`,
  project,
  mode: "default" as const,
  state: "idle" as const,
  pendingApprovals: 0,
  createdAt: "2026-11-03T09:00:00Z",
})
const A = "01a1a326-3ff8-7bab-a460-baad84d27803"
const B = "01a1a326-400c-7db7-906c-a314143344f5"

beforeEach(() => {
  posted.length = 0
  localStorage.clear()
  ;(globalThis as { chrome?: unknown }).chrome = {
    webview: {
      postMessage: (m: string) => posted.push(m),
      addEventListener: (_t: string, f: (e: { data: unknown }) => void) => (deliver = f),
      removeEventListener: () => (deliver = undefined),
    },
  }
  useStore.setState({
    sessions: { [A]: session(A, "shop"), [B]: session(B, "blog") },
    transcripts: {},
    pending: {},
    panes: [A, B],
    selectedSession: A,
    route: "workspace",
  })
})
afterEach(() => {
  cleanup()
  delete (globalThis as { chrome?: unknown }).chrome
})

describe("a session in a window of its own", () => {
  it("is asked for from the pane's menu, and leaves the main window's panes", async () => {
    render(<Workspace />)
    fireEvent.click(screen.getAllByRole("button", { name: /shop/ })[0]!)
    fireEvent.click(await screen.findByRole("menuitem", { name: "Pop out into its own window" }))
    expect(posted).toContain(`popout:${A}`)
    expect(useStore.getState().panes).toEqual([B])
  })

  it("comes back beside the others when its window closes", () => {
    useStore.setState({ panes: [B] })
    const stop = startShell()
    deliver?.({ data: `popin:${A}` })
    expect(useStore.getState().panes).toContain(A)
    // A session Codehouse does not know is not added.
    deliver?.({ data: "popin:not-a-session" })
    expect(useStore.getState().panes).not.toContain("not-a-session")
    stop()
  })

  it("shows only that session in its own window, with no Pop out of its own", async () => {
    render(<PanePage sessionId={B} />)
    expect(useStore.getState()).toMatchObject({ panes: [B], selectedSession: B })
    expect(screen.getByRole("main", { name: "Session window" })).toBeTruthy()
  })
})
