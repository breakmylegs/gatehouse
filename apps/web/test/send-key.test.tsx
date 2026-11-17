// @vitest-environment jsdom
// T-053: Enter sends a prompt as before (Shift+Enter adds a line), or, by your choice, Ctrl+Enter sends and Enter adds a
// line. Never while an input method is composing.
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react"
import { forwardRef } from "react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { getSendKey, sends, setSendKey } from "../src/lib/sendKey"
import { send, useStore } from "../src/store"
import { Workspace } from "../src/surfaces/Workspace"

vi.mock("sonner", () => ({ toast: Object.assign(() => undefined, { error: () => undefined }), Toaster: () => null }))
vi.mock("../src/store", async (orig) => {
  const actual = await orig<typeof import("../src/store")>()
  return { ...actual, send: vi.fn(async () => ({ ok: true })) }
})
vi.mock("../src/lib/api", () => ({ api: vi.fn(async () => ({ ok: false, status: 404, error: "no route" })) }))
vi.mock("react-virtuoso", () => ({ Virtuoso: forwardRef(function V() { return <div /> }) }))
globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
} as never

const key = (o: Partial<{ key: string; shiftKey: boolean; ctrlKey: boolean; metaKey: boolean; isComposing: boolean }>) => ({
  key: "Enter",
  shiftKey: false,
  ctrlKey: false,
  metaKey: false,
  ...o,
})

beforeEach(() => {
  localStorage.clear()
  vi.mocked(send).mockClear()
  useStore.setState({
    sessions: { s1: { id: "s1", cwd: "C:/dev/shop", project: "shop", mode: "default", state: "idle", pendingApprovals: 0, createdAt: "2026-11-03T09:00:00Z", resources: "medium" } },
    transcripts: {},
    suggestions: {},
    pending: {},
    panes: [],
    selectedSession: "s1",
    route: "workspace",
    barFolded: false,
  })
})
afterEach(cleanup)

const prompts = () => vi.mocked(send).mock.calls.filter(([c]) => (c as { type?: string }).type === "prompt")

describe("the send key (T-053)", () => {
  it("sends on Enter as before, Ctrl+Enter too, but not Shift+Enter or while composing", () => {
    expect(getSendKey()).toBe("enter")
    expect(sends(key({}), "enter")).toBe(true)
    expect(sends(key({ ctrlKey: true }), "enter")).toBe(true)
    expect(sends(key({ shiftKey: true }), "enter")).toBe(false)
    expect(sends(key({ isComposing: true }), "enter")).toBe(false)
    expect(sends(key({ key: "a" }), "enter")).toBe(false)
  })

  it("with Ctrl+Enter chosen, Enter makes a new line and Ctrl+Enter or Command+Enter sends", () => {
    expect(sends(key({}), "mod-enter")).toBe(false)
    expect(sends(key({ ctrlKey: true }), "mod-enter")).toBe(true)
    expect(sends(key({ metaKey: true }), "mod-enter")).toBe(true)
  })

  it("is the choice the prompt box follows, kept in the window", () => {
    render(<Workspace />)
    const box = screen.getByRole("textbox", { name: "Prompt" }) as HTMLTextAreaElement
    act(() => setSendKey("mod-enter"))
    expect(localStorage.getItem("gatehouse.sendKey")).toBe("mod-enter")
    fireEvent.change(box, { target: { value: "Line one" } })
    fireEvent.keyDown(box, { key: "Enter" })
    expect(prompts()).toEqual([])
    expect(box.title).toMatch(/^Ctrl\+Enter sends/)
    act(() => setSendKey("enter"))
    expect(localStorage.getItem("gatehouse.sendKey")).toBeNull()
  })
})
