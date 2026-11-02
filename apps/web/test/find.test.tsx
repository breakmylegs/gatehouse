// @vitest-environment jsdom
// Find in this conversation (owner, 2 Nov: the everyday features of the Claude and ChatGPT apps): Ctrl+F in a pane
// opens a bar over the transcript that counts the lines holding the words, shows one at a time and outlines it, and
// Esc closes it and puts you back in the prompt box.
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react"
import { forwardRef, useImperativeHandle, type ReactNode } from "react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { findIn, itemText } from "../src/lib/find"
import { addUser, emptyTranscript, reduce } from "../src/lib/transcript"

const scrolled: unknown[] = []
vi.mock("react-virtuoso", () => ({
  Virtuoso: forwardRef(function List(
    p: { data?: unknown[]; itemContent: (i: number, it: never) => ReactNode },
    ref,
  ) {
    useImperativeHandle(ref, () => ({
      scrollToIndex: (a: { index: unknown }) => scrolled.push(a.index),
      scrollTo() {},
      scrollBy() {},
    }))
    return (
      <div>
        {(p.data ?? []).map((it, i) => (
          <div key={i}>{p.itemContent(i, it as never)}</div>
        ))}
      </div>
    )
  }),
}))
vi.mock("../src/lib/api", () => ({
  api: vi.fn(async () => ({ ok: false, status: 404, error: "no route" })),
}))
globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
} as never

const { useStore } = await import("../src/store")
const { Workspace } = await import("../src/surfaces/Workspace")

const say = (t: ReturnType<typeof emptyTranscript>, text: string) =>
  reduce(t, { type: "assistant", message: { content: [{ type: "text", text }] } } as never)

beforeEach(() => {
  scrolled.length = 0
  let t = addUser(emptyTranscript(), "Plan the launch in Prague")
  t = say(t, "Here is a plan for the launch.")
  t = addUser(t, "Make it shorter for Prague")
  t = say(t, "A shorter plan for Prague.")
  useStore.setState({
    route: "workspace",
    panes: ["s1"],
    selectedSession: "s1",
    pending: {},
    transcripts: { s1: t },
    sessions: {
      s1: {
        id: "s1",
        kind: "chat",
        cwd: "C:\\data\\chats\\launch",
        project: "launch",
        mode: "plan",
        state: "idle",
        pendingApprovals: 0,
        createdAt: "2026-11-02T09:00:00Z",
      },
    },
  })
})
afterEach(cleanup)

describe("what find in a chat reads", () => {
  it("is what was said and a tool's command, path and output, ignoring case", () => {
    const tool = {
      id: "t",
      kind: "tool" as const,
      toolUseId: "t",
      name: "Bash",
      input: { command: "npm test" },
      result: { text: "12 passed", isError: false },
    }
    expect(itemText(tool)).toContain("npm test")
    expect(findIn([{ id: "a", kind: "text", text: "Hello" }, tool], "PASSED")).toEqual([1])
    expect(findIn([{ id: "a", kind: "text", text: "Hello" }], "  ")).toEqual([])
  })
})

describe("find in this conversation", () => {
  it("opens with Ctrl+F, counts the matches, steps through them and outlines the one shown", () => {
    render(<Workspace />)
    fireEvent.keyDown(screen.getByRole("region", { name: "Transcript" }), {
      key: "f",
      ctrlKey: true,
    })
    const bar = screen.getByRole("search", { name: "Find in this conversation" })
    const box = screen.getByRole("textbox", { name: "Find in this conversation" })
    expect(document.activeElement).toBe(box)
    fireEvent.change(box, { target: { value: "prague" } })
    expect(bar.textContent).toContain("1 of 3")
    const current = () => document.querySelector(".find-current")?.textContent ?? ""
    expect(current()).toContain("Plan the launch in Prague")
    expect(document.querySelectorAll(".find-hit")).toHaveLength(3)
    fireEvent.keyDown(box, { key: "Enter" })
    fireEvent.keyDown(box, { key: "Enter" })
    expect(bar.textContent).toContain("3 of 3")
    expect(current()).toContain("A shorter plan for Prague.")
    expect(scrolled.at(-1)).toBe(3)
    fireEvent.keyDown(box, { key: "Enter", shiftKey: true })
    expect(bar.textContent).toContain("2 of 3")
    expect(current()).toContain("Make it shorter for Prague")
    fireEvent.change(box, { target: { value: "zebra" } })
    expect(bar.textContent).toContain("No matches")
    expect(document.querySelector(".find-hit")).toBeNull()
  })

  it("closes with Esc and puts you back in the prompt box", () => {
    render(<Workspace />)
    act(() => {
      fireEvent.keyDown(screen.getByRole("region", { name: "Transcript" }), {
        key: "F",
        ctrlKey: true,
      })
    })
    fireEvent.keyDown(screen.getByRole("textbox", { name: "Find in this conversation" }), {
      key: "Escape",
    })
    expect(screen.queryByRole("search", { name: "Find in this conversation" })).toBeNull()
    expect(document.activeElement?.tagName).toBe("TEXTAREA")
  })
})
