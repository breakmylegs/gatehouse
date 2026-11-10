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

describe("@ for files in the prompt box (backlog F15)", () => {
  it("lists the session's files that match, puts the chosen one in, and writes a range out when sent", async () => {
    const { api } = await import("../src/lib/api")
    vi.mocked(api).mockImplementation((async (_m: string, url: string) =>
      url.startsWith("/api/files/find")
        ? { ok: true, status: 200, data: { files: ["src/parser.ts", "test/parser.test.ts"] } }
        : { ok: false, status: 404, error: "no route" }) as never)
    render(<Workspace />)
    const box = screen.getByRole("textbox", { name: "Prompt" }) as HTMLTextAreaElement
    fireEvent.change(box, { target: { value: "Fix @pars", selectionStart: 9 } })
    const list = await screen.findByRole("listbox", { name: "Files" })
    expect(list.textContent).toContain("src/parser.ts")
    expect(vi.mocked(api).mock.calls.at(-1)?.[1]).toContain("q=pars")
    fireEvent.keyDown(box, { key: "ArrowDown" })
    fireEvent.keyDown(box, { key: "Enter" })
    expect(box.value).toBe("Fix @test/parser.test.ts ")
    // Enter chose the file; it sent nothing.
    expect(
      vi.mocked(send).mock.calls.some(([c]) => (c as { type?: string }).type === "prompt"),
    ).toBe(false)
    fireEvent.change(box, {
      target: { value: "Fix @src/parser.ts:10-20 please", selectionStart: 31 },
    })
    fireEvent.keyDown(box, { key: "Enter" })
    await waitFor(() =>
      expect(send).toHaveBeenCalledWith({
        type: "prompt",
        sessionId: "s1",
        text: "Fix @src/parser.ts (lines 10 to 20) please",
      }),
    )
    vi.mocked(api).mockReset()
    vi.mocked(api).mockImplementation((async () => ({
      ok: false,
      status: 404,
      error: "no route",
    })) as never)
  })
})

describe("/tell another session (backlog G18)", () => {
  it("sends your message to the open session with that code, and refuses one that is not open", async () => {
    const { sessionCode } = await import("../src/lib/codes")
    const other = {
      id: "s2",
      cwd: "C:/dev/api",
      project: "api",
      mode: "default" as const,
      state: "idle" as const,
      pendingApprovals: 0,
      createdAt: "2026-11-03T09:00:00Z",
    }
    useStore.setState({ sessions: { ...useStore.getState().sessions, s2: other as never } })
    const code = sessionCode(other)
    render(<Workspace />)
    const box = screen.getByRole("textbox", { name: "Prompt" }) as HTMLTextAreaElement
    fireEvent.change(box, {
      target: { value: `/tell ${code.toLowerCase()} run the tests\nand report` },
    })
    fireEvent.keyDown(box, { key: "Enter" })
    await waitFor(() =>
      expect(send).toHaveBeenCalledWith({
        type: "tell",
        from: "s1",
        to: "s2",
        text: "run the tests\nand report",
      }),
    )
    vi.mocked(send).mockClear()
    fireEvent.change(box, { target: { value: "/tell ZZ 999 hello" } })
    fireEvent.keyDown(box, { key: "Enter" })
    await new Promise((r) => setTimeout(r, 50))
    expect(vi.mocked(send).mock.calls.some(([c]) => (c as { type?: string }).type === "tell")).toBe(
      false,
    )
  })
})

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

  it("greys out efforts above the limit in Settings, and offers no effort for a model on this computer", () => {
    useStore.setState({
      sessions: { s1: { ...useStore.getState().sessions.s1!, effort: "high", effortCap: "high" } },
    })
    const { unmount } = render(<Workspace />)
    const options = [
      ...(screen.getByRole("combobox", { name: "Effort" }) as HTMLSelectElement).options,
    ]
    const off = options.filter((o) => o.disabled && o.value).map((o) => o.value)
    expect(off).toEqual(["xhigh", "max"])
    unmount()
    useStore.setState({
      sessions: { s1: { ...useStore.getState().sessions.s1!, local: true, model: "tiny" } },
    })
    render(<Workspace />)
    expect(screen.queryByRole("combobox", { name: "Effort" })).toBeNull()
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
