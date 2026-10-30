// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { ChangesPane } from "../src/components/ChangesPane"
import { TerminalPane } from "../src/components/TerminalPane"
import { useStore } from "../src/store"

const sent: Array<Record<string, unknown>> = []
let changes: unknown = undefined
vi.mock("../src/store", async (orig) => {
  const actual = await orig<typeof import("../src/store")>()
  return {
    ...actual,
    send: vi.fn(async (cmd: Record<string, unknown>) => {
      sent.push(cmd)
      if (cmd.type === "term_run") return { ok: true, data: { runId: "r1" } }
      if (cmd.type === "changes") return { ok: true, data: changes }
      return { ok: true, data: {} }
    }),
  }
})

beforeEach(() => {
  sent.length = 0
  useStore.setState({ term: {}, transcripts: {} })
})
afterEach(cleanup)

describe("the terminal pane", () => {
  it("runs a command, shows what it prints, and offers Stop while it runs", async () => {
    render(<TerminalPane sessionId="s1" cwd="C:\dev\shop" />)
    const box = screen.getByRole("textbox", { name: "Command" })
    fireEvent.change(box, { target: { value: "npm test" } })
    fireEvent.submit(box.closest("form")!)
    await waitFor(() =>
      expect(sent).toEqual([{ type: "term_run", sessionId: "s1", command: "npm test" }]),
    )
    expect(await screen.findByRole("button", { name: "Stop" })).toBeTruthy()
    const { handleEvent } = useStore.getState()
    act(() =>
      handleEvent({
        type: "term_output",
        sessionId: "s1",
        runId: "r1",
        stream: "out",
        text: "3 passed\n",
      }),
    )
    act(() => handleEvent({ type: "term_exit", sessionId: "s1", runId: "r1", code: 1 }))
    const out = screen.getByLabelText("Terminal output")
    expect(out.textContent).toContain("PS C:\\dev\\shop> npm test")
    expect(out.textContent).toContain("3 passed")
    expect(out.textContent).toContain("Exit code 1.")
    expect(screen.getByRole("button", { name: "Run" })).toBeTruthy()
  })

  it("brings back earlier commands with Up and Down", async () => {
    render(<TerminalPane sessionId="s1" cwd="C:\dev\shop" />)
    const box = screen.getByRole("textbox", { name: "Command" }) as HTMLInputElement
    for (const c of ["git status", "npm test"]) {
      fireEvent.change(box, { target: { value: c } })
      fireEvent.submit(box.closest("form")!)
      await waitFor(() => expect(screen.getByRole("button", { name: "Stop" })).toBeTruthy())
      act(() =>
        useStore
          .getState()
          .handleEvent({ type: "term_exit", sessionId: "s1", runId: "r1", code: 0 }),
      )
    }
    fireEvent.keyDown(box, { key: "ArrowUp" })
    expect(box.value).toBe("npm test")
    fireEvent.keyDown(box, { key: "ArrowUp" })
    expect(box.value).toBe("git status")
    fireEvent.keyDown(box, { key: "ArrowDown" })
    expect(box.value).toBe("npm test")
  })

  it("ignores the end of an older command", () => {
    useStore.setState({ term: { s1: { chunks: [], runId: "new" } } })
    act(() =>
      useStore
        .getState()
        .handleEvent({ type: "term_exit", sessionId: "s1", runId: "old", code: 0 }),
    )
    expect(useStore.getState().term.s1?.runId).toBe("new")
  })
})

const first = {
  ref: "refs/gatehouse/checkpoints/s1/a",
  createdAt: "2026-10-30T10:00:00Z",
  label: "before a burst of edits",
}

describe("the changes pane", () => {
  it("lists what changed since the session's first checkpoint, with each diff", async () => {
    changes = {
      checkpoints: [first],
      since: first,
      files: [
        {
          path: "src/app.ts",
          change: "modified",
          added: 2,
          removed: 1,
          binary: false,
          diff: "diff --git a/src/app.ts b/src/app.ts\n@@ -1 +1 @@\n-old\n+new\n",
        },
        { path: "notes.md", change: "added", added: 3, removed: 0, binary: false, diff: "" },
      ],
    }
    render(<ChangesPane sessionId="s1" cwd="C:\dev\shop" />)
    const list = await screen.findByRole("list", { name: "Changed files" })
    expect(within(list).getAllByRole("listitem")).toHaveLength(2)
    fireEvent.click(within(list).getByRole("button", { name: /src\/app\.ts/ }))
    expect(screen.getByText("+new")).toBeTruthy()
    expect(sent[0]).toEqual({ type: "changes", sessionId: "s1" })
  })

  it("asks before undoing a file, then undoes only that one", async () => {
    changes = {
      checkpoints: [first],
      since: first,
      files: [
        { path: "src/app.ts", change: "modified", added: 2, removed: 1, binary: false, diff: "" },
        { path: "notes.md", change: "added", added: 3, removed: 0, binary: false, diff: "" },
      ],
    }
    render(<ChangesPane sessionId="s1" cwd="C:\dev\shop" />)
    await screen.findByRole("list", { name: "Changed files" })
    fireEvent.click(screen.getAllByRole("button", { name: "Undo" })[1]!)
    expect(sent.some((c) => c.type === "undo_files")).toBe(false)
    fireEvent.click(screen.getByRole("button", { name: "Undo this file" }))
    await waitFor(() =>
      expect(sent.find((c) => c.type === "undo_files")).toEqual({
        type: "undo_files",
        sessionId: "s1",
        ref: first.ref,
        paths: ["notes.md"],
        confirm: true,
      }),
    )
  })

  it("says so when there is no checkpoint yet", async () => {
    changes = { checkpoints: [] }
    render(<ChangesPane sessionId="s1" cwd="C:\dev\shop" />)
    expect(await screen.findByText(/No checkpoint yet/)).toBeTruthy()
  })
})
