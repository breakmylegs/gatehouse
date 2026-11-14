// @vitest-environment jsdom
// T-025 (t3code review): a snoozed session stays out of the list until its time and wakes at once when it needs you.
// T-026: pin, archive, rename and move offer an Undo that puts the session back as it was.
import { beforeEach, describe, expect, it, vi } from "vitest"

const sent: Array<Record<string, unknown>> = []
const toasts: Array<{ text: string; action?: { label: string; onClick: () => void } }> = []
vi.mock("sonner", () => ({
  toast: Object.assign((text: string, o?: { action?: { label: string; onClick: () => void } }) => void toasts.push({ text, ...(o?.action ? { action: o.action } : {}) }), { error: () => undefined }),
}))
vi.mock("../src/store", () => ({
  send: vi.fn(async (cmd: Record<string, unknown>) => {
    sent.push(cmd)
    return { ok: true }
  }),
  useStore: { getState: () => ({}) },
}))

const { inAnHour, isSnoozed, snoozedUntil, snoozeSession, tomorrowMorning, wakeSession } = await import("../src/lib/snooze")
const { setSessionMeta, undoOf } = await import("../src/lib/sessionActions")

beforeEach(() => {
  localStorage.clear()
  sent.length = 0
  toasts.length = 0
})

describe("snoozing a session (T-025)", () => {
  it("keeps it out of the list until its time, and wakes it at once when it needs you", () => {
    const now = new Date("2026-11-14T15:00:00")
    snoozeSession("s1", inAnHour(now))
    expect(isSnoozed("s1", false, now)).toBe(true)
    // A request, a question or an error wakes it.
    expect(isSnoozed("s1", true, now)).toBe(false)
    // After its time it is back.
    expect(isSnoozed("s1", false, new Date("2026-11-14T16:01:00"))).toBe(false)
    wakeSession("s1")
    expect(snoozedUntil("s1")).toBeUndefined()
    expect(tomorrowMorning(now).toString()).toBe(new Date("2026-11-15T09:00:00").toString())
  })

  it("reads a damaged snooze list as nothing snoozed", () => {
    localStorage.setItem("gatehouse.snooze", "[1,2")
    expect(isSnoozed("s1", false)).toBe(false)
    localStorage.setItem("gatehouse.snooze", JSON.stringify({ s1: 5, s2: "not a date" }))
    expect(snoozedUntil("s1")).toBeUndefined()
    expect(snoozedUntil("s2")).toBeUndefined()
  })
})

describe("undo for sidebar actions (T-026)", () => {
  it("knows what puts each change back", () => {
    expect(undoOf({ pinned: false, project: "shop" }, { pinned: true })).toEqual({ pinned: false })
    expect(undoOf({ archived: false, project: "shop" }, { archived: true })).toEqual({ archived: false })
    expect(undoOf({ title: "Old", project: "shop" }, { title: "New" })).toEqual({ title: "Old" })
    expect(undoOf({ project: "shop" }, { title: "New", group: "Work" })).toEqual({ title: null, group: null })
    expect(undoOf({}, { title: "New" })).toBeUndefined()
  })

  it("offers an Undo that sends the session back as it was", async () => {
    const s = { sdkSessionId: "sdk1", cwd: "C:/dev/shop", project: "shop", pinned: false }
    expect(await setSessionMeta(s, { pinned: true }, "Pinned shop.")).toBe(true)
    expect(sent.at(-1)).toMatchObject({ type: "session_meta", sdkSessionId: "sdk1", pinned: true })
    const undo = toasts.at(-1)?.action
    expect(undo?.label).toBe("Undo")
    undo!.onClick()
    await vi.waitFor(() => expect(sent.at(-1)).toMatchObject({ type: "session_meta", sdkSessionId: "sdk1", pinned: false }))
  })
})
