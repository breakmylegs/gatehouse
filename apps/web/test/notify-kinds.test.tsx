// @vitest-environment jsdom
// Which Windows notifications you get, each on its own (owner, 4 Nov, after Claude's desktop app).
import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { NotifyKindsSetting } from "../src/components/SettingsPanels"
import { LONG_TURN_MS, readKinds, saveKinds, worthTelling } from "../src/lib/notifyKinds"
import { useStore } from "../src/store"

vi.mock("sonner", () => ({
  toast: Object.assign(() => undefined, { error: () => undefined }),
  Toaster: () => null,
}))
vi.mock("../src/lib/api", () => ({ api: vi.fn(async () => ({ ok: false, status: 404 })) }))

const shown: Array<{ body?: string }> = []
class FakeNotification {
  static permission = "granted"
  onclick?: () => void
  constructor(_title: string, opts?: { body?: string }) {
    shown.push({ body: opts?.body })
  }
  close() {}
}

let focused = false
beforeEach(() => {
  shown.length = 0
  localStorage.clear()
  vi.stubGlobal("Notification", FakeNotification)
  focused = false
  vi.spyOn(document, "hasFocus").mockImplementation(() => focused)
  useStore.setState({
    notify: true,
    notices: [],
    pending: {},
    sessions: {
      s1: {
        id: "s1",
        cwd: "C:/dev/shop",
        project: "shop",
        title: "Shop rebuild",
        mode: "default",
        state: "running",
        pendingApprovals: 0,
        createdAt: "2026-11-04T09:00:00Z",
      },
    },
  })
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

const result = (duration_ms: number) =>
  useStore.getState().handleEvent({
    type: "sdk_message",
    sessionId: "s1",
    message: { type: "result", subtype: "success", duration_ms, result: "Done." },
  } as never)
const queueEmpty = () =>
  useStore
    .getState()
    .handleEvent({ type: "session_event", sessionId: "s1", event: "queue_empty", data: {} })

describe("notifications by kind", () => {
  it("reads tolerantly, everything on until you turn one off", () => {
    expect(readKinds()).toEqual({ requests: true, completions: true, queueEmpty: true })
    localStorage.setItem("gatehouse.notifyKinds", "{broken")
    expect(readKinds().completions).toBe(true)
    saveKinds({ requests: true, completions: false, queueEmpty: true })
    expect(readKinds().completions).toBe(false)
    expect(worthTelling(LONG_TURN_MS, false)).toBe(true)
    expect(worthTelling(LONG_TURN_MS - 1, false)).toBe(false)
    expect(worthTelling(LONG_TURN_MS, true)).toBe(false)
  })

  it("tells you a long reply finished while you were elsewhere, and not a quick one or one you watched", () => {
    result(45_000)
    expect(shown.map((n) => n.body)).toEqual(["Shop rebuild: Claude has finished"])
    result(3_000)
    focused = true
    result(45_000)
    expect(shown).toHaveLength(1)
  })

  it("keeps quiet about each kind you turned off, and about all of them with notifications off", () => {
    saveKinds({ requests: true, completions: false, queueEmpty: false })
    result(45_000)
    queueEmpty()
    expect(shown).toHaveLength(0)
    saveKinds({ requests: true, completions: true, queueEmpty: true })
    useStore.setState({ notify: false })
    result(45_000)
    queueEmpty()
    expect(shown).toHaveLength(0)
  })

  it("is chosen in Settings, and needs notifications on first", () => {
    const { rerender } = render(<NotifyKindsSetting on={false} />)
    const done = screen.getByRole("checkbox", { name: /Response completions/ }) as HTMLInputElement
    expect(done.disabled).toBe(true)
    rerender(<NotifyKindsSetting on />)
    fireEvent.click(screen.getByRole("checkbox", { name: /Response completions/ }))
    expect(readKinds().completions).toBe(false)
  })
})
