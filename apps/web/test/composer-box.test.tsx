// @vitest-environment jsdom
// The prompt box as one box, after Claude Code's (owner, 3 Nov): + at the left, Send at the right, one line high.
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { forwardRef } from "react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { send, useStore } from "../src/store"
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
  vi.mocked(send).mockClear()
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
        resources: "medium",
      },
    },
    transcripts: {},
    pending: {},
    panes: [],
    selectedSession: "s1",
    route: "workspace",
    barFolded: false,
  })
})
afterEach(cleanup)

describe("the prompt box", () => {
  it("starts one line high, with the add and send buttons inside the same box", () => {
    render(<Workspace />)
    const box = screen.getByRole("textbox", { name: "Prompt" }) as HTMLTextAreaElement
    expect(box.rows).toBe(1)
    const frame = box.closest(".composer-box")!
    expect(frame.contains(screen.getByRole("button", { name: /^Add files/ }))).toBe(true)
    expect(frame.contains(screen.getByRole("button", { name: "Send" }))).toBe(true)
  })

  it("sends what you wrote with Send, which is off while there is nothing to send", async () => {
    render(<Workspace />)
    const sendButton = screen.getByRole("button", { name: "Send" })
    expect(sendButton).toBeDisabled()
    const box = screen.getByRole("textbox", { name: "Prompt" }) as HTMLTextAreaElement
    fireEvent.change(box, { target: { value: "Fix the login bug" } })
    expect(sendButton).toBeEnabled()
    fireEvent.click(sendButton)
    await waitFor(() =>
      expect(send).toHaveBeenCalledWith({
        type: "prompt",
        sessionId: "s1",
        text: "Fix the login bug",
      }),
    )
    expect(box.value).toBe("")
  })

  it("keeps the settings under it short: each picker named for a screen reader, not in words on the line", () => {
    render(<Workspace />)
    const bar = screen.getByRole("group", { name: "Model, effort and mode" })
    for (const name of ["Model", "Effort", "Mode"])
      expect(screen.getByRole("combobox", { name })).toBeTruthy()
    // What is on the line: the bar without what only a screen reader hears and the closed lists' other choices.
    const seen = bar.cloneNode(true) as HTMLElement
    seen.querySelectorAll(".sr-only, option:not(:checked)").forEach((e) => e.remove())
    expect(seen.textContent).not.toMatch(/Model|Effort|Mode|This PC|shared by everything/)
    expect(bar.querySelector("#lvl-s1")?.textContent).toMatch(/Half the processor/)
  })
})
