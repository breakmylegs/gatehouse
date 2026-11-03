// @vitest-environment jsdom
// Owner, 3 Nov: "I also want a notification sent when the QUEUE EMPTY is reached for a session."
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { useStore } from "../src/store"

const toasts: string[] = []
vi.mock("sonner", () => ({
  toast: Object.assign((t: string) => toasts.push(t), { error: (t: string) => toasts.push(t) }),
  Toaster: () => null,
}))

const shown: Array<{ title: string; body?: string; onclick?: () => void }> = []
class FakeNotification {
  static permission = "granted"
  onclick?: () => void
  constructor(
    readonly title: string,
    opts?: { body?: string },
  ) {
    shown.push(Object.assign(this, { body: opts?.body }))
  }
  close() {}
}

beforeEach(() => {
  toasts.length = 0
  shown.length = 0
  vi.stubGlobal("Notification", FakeNotification)
  useStore.setState({
    notify: true,
    notices: [],
    route: "approvals",
    sessions: {
      s1: {
        id: "s1",
        cwd: "C:/dev/shop",
        project: "shop",
        title: "Shop rebuild",
        mode: "default",
        state: "idle",
        pendingApprovals: 0,
        createdAt: "2026-11-03T09:00:00Z",
      },
    },
  })
})
afterEach(() => vi.unstubAllGlobals())

describe("when a session's build queue is empty", () => {
  it("says so in a toast, in Notices and from Windows, naming only the session, and opens it", () => {
    useStore.getState().handleEvent({
      type: "session_event",
      sessionId: "s1",
      event: "queue_empty",
      data: {},
    })
    expect(toasts).toEqual(["Shop rebuild: the build queue is empty"])
    expect(useStore.getState().notices[0]?.text).toBe("Shop rebuild: the build queue is empty.")
    expect(shown).toHaveLength(1)
    expect(shown[0]).toMatchObject({
      title: "Codehouse",
      body: "Shop rebuild: the build queue is empty",
    })
    shown[0]!.onclick?.()
    expect(useStore.getState()).toMatchObject({ route: "workspace", selectedSession: "s1" })
  })

  it("is said once in Extreme approval: the end of carrying on adds no second notice", () => {
    useStore.getState().handleEvent({
      type: "session_event",
      sessionId: "s1",
      event: "carry_on_end",
      data: { why: "done", turns: 3, spentUsd: 1 },
    })
    expect(useStore.getState().notices).toEqual([])
  })
})
