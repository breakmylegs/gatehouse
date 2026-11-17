// @vitest-environment jsdom
// T-020: after a turn the session suggests a next prompt. It shows in the empty prompt box, Tab fills it in, and it is
// never sent by itself; it goes once the session works again.
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react"
import { forwardRef } from "react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
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

const suggest = (text: string) =>
  useStore.getState().handleEvent({ type: "sdk_message", sessionId: "s1", message: { type: "prompt_suggestion", suggestion: text } } as never)

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

describe("a suggested next prompt (T-020)", () => {
  it("shows in the empty box, Tab fills it in, and nothing is sent until you send it", () => {
    render(<Workspace />)
    act(() => suggest("Now write the tests for the export"))
    const box = screen.getByRole("textbox", { name: "Prompt" }) as HTMLTextAreaElement
    expect(box.placeholder).toBe("Now write the tests for the export   (Tab to use it)")
    fireEvent.keyDown(box, { key: "Tab" })
    expect(box.value).toBe("Now write the tests for the export")
    expect(vi.mocked(send).mock.calls.filter(([c]) => (c as { type?: string }).type === "prompt")).toEqual([])
  })

  it("leaves Tab alone when you have written something, and goes once the session works again", () => {
    render(<Workspace />)
    act(() => suggest("Run the tests"))
    const box = screen.getByRole("textbox", { name: "Prompt" }) as HTMLTextAreaElement
    fireEvent.change(box, { target: { value: "My own words" } })
    fireEvent.keyDown(box, { key: "Tab" })
    expect(box.value).toBe("My own words")
    useStore.getState().handleEvent({ type: "sdk_message", sessionId: "s1", message: { type: "assistant", message: { content: [] } } } as never)
    expect(useStore.getState().suggestions.s1).toBeUndefined()
  })
})
