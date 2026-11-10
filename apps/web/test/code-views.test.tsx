// @vitest-environment jsdom
// B11: files and changed files are shown in read-only code views (CodeMirror 6): line numbers, search, labelled for a
// screen reader; a changed file side by side or inline, the choice kept; nothing typed changes anything.
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

// The layout calls CodeMirror makes, which jsdom does not have.
const rect = { x: 0, y: 0, top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0, toJSON() {} }
Range.prototype.getClientRects = () => [] as unknown as DOMRectList
Range.prototype.getBoundingClientRect = () => rect as DOMRect

const sent: Array<Record<string, unknown>> = []
let versions: { ok: boolean; data?: unknown } = {
  ok: true,
  data: { before: "one\ntwo\n", after: "one\nTWO\n" },
}
vi.mock("../src/store", async (orig) => {
  const actual = await orig<typeof import("../src/store")>()
  return {
    ...actual,
    send: vi.fn(async (cmd: Record<string, unknown>) => {
      sent.push(cmd)
      if (cmd.type === "change_versions") return versions
      if (cmd.type === "changes")
        return {
          ok: true,
          data: {
            checkpoints: [{ ref: "refs/x", createdAt: "2026-11-03T01:00:00Z", label: "start" }],
            since: { ref: "refs/x", createdAt: "2026-11-03T01:00:00Z", label: "start" },
            files: [
              {
                path: "a.txt",
                change: "modified",
                added: 1,
                removed: 1,
                binary: false,
                diff: "@@ -1,2 +1,2 @@\n one\n-two\n+TWO",
              },
            ],
          },
        }
      return { ok: true }
    }),
  }
})

const { CodeView, DiffView } = await import("../src/components/CodeViews")
const { EditorView } = await import("@codemirror/view")
const { ChangesPane } = await import("../src/components/ChangesPane")

beforeEach(() => {
  sent.length = 0
  localStorage.clear()
  versions = { ok: true, data: { before: "one\ntwo\n", after: "one\nTWO\n" } }
})
afterEach(cleanup)

describe("the code view", () => {
  it("shows the file's text with line numbers, labelled and read only", () => {
    render(<CodeView text={"first line\nsecond line"} label="notes.txt, read only" />)
    const content = document.querySelector(".cm-content") as HTMLElement
    expect(content.getAttribute("aria-label")).toBe("notes.txt, read only")
    expect(content.getAttribute("aria-readonly")).toBe("true")
    expect(content.textContent).toContain("second line")
    expect(document.querySelector(".cm-lineNumbers")).toBeTruthy()
    // Read only in fact, not only in name: the editor refuses changes from typing.
    expect(EditorView.findFromDOM(content)?.state.readOnly).toBe(true)
  })
})

describe("the diff view", () => {
  it("shows a changed file side by side, then inline when chosen, and keeps the choice", () => {
    const { unmount } = render(<DiffView path="a.txt" before={"one\ntwo\n"} after={"one\nTWO\n"} />)
    const view = screen.getByTestId("diff-view")
    expect(view.dataset.layout).toBe("side")
    const sides = view.querySelectorAll(".cm-content")
    expect(sides).toHaveLength(2)
    expect(sides[0]!.getAttribute("aria-label")).toBe("a.txt, as it was")
    expect(sides[0]!.textContent).toContain("two")
    expect(sides[1]!.textContent).toContain("TWO")
    fireEvent.click(screen.getByRole("radio", { name: "Inline" }))
    expect(screen.getByTestId("diff-view").querySelectorAll(".cm-content")).toHaveLength(1)
    unmount()
    render(<DiffView path="a.txt" before="a" after="b" />)
    expect(screen.getByTestId("diff-view").dataset.layout).toBe("inline")
    expect(screen.getByRole("radio", { name: "Inline" }).getAttribute("aria-checked")).toBe("true")
  })
})

describe("the changes pane", () => {
  it("opens a changed file in the diff view, read from the checkpoint and from disk", async () => {
    render(<ChangesPane sessionId="s1" cwd="C:\\dev\\shop" />)
    fireEvent.click(await screen.findByRole("button", { name: /a\.txt/ }))
    await waitFor(() => expect(screen.getByTestId("diff-view")).toBeTruthy())
    expect(sent.find((c) => c.type === "change_versions")).toEqual({
      type: "change_versions",
      sessionId: "s1",
      ref: "refs/x",
      path: "a.txt",
    })
  })

  it("keeps the plain diff when the two sides cannot be read", async () => {
    versions = { ok: false }
    render(<ChangesPane sessionId="s1" cwd="C:\\dev\\shop" />)
    fireEvent.click(await screen.findByRole("button", { name: /a\.txt/ }))
    await waitFor(() => expect(screen.getByText("+TWO")).toBeTruthy())
    expect(screen.queryByTestId("diff-view")).toBeNull()
  })
})

describe("undoing one change in a file (B12)", () => {
  it("lists each change in words and sends the one chosen, against the version shown, after you confirm", async () => {
    versions = { ok: true, data: { before: "a\nb\nc\nd\n", after: "a\nB\nc\nd\ne\n" } }
    render(<ChangesPane sessionId="s1" cwd="C:\dev\shop" />)
    fireEvent.click(await screen.findByRole("button", { name: /a\.txt/ }))
    const list = await screen.findByRole("region", { name: "Changes in a.txt" })
    expect(list.textContent).toContain("Changed line 2 (was 1 line)")
    expect(list.textContent).toContain("Added 1 line at line 5")
    fireEvent.click(screen.getByRole("button", { name: "Undo: Added 1 line at line 5" }))
    expect(sent.some((c) => c.type === "undo_change")).toBe(false)
    fireEvent.click(screen.getByRole("button", { name: "Undo this change" }))
    await waitFor(() => expect(sent.find((c) => c.type === "undo_change")).toBeTruthy())
    const hash = [
      ...new Uint8Array(
        await crypto.subtle.digest("SHA-256", new TextEncoder().encode("a\nB\nc\nd\ne\n")),
      ),
    ]
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("")
    expect(sent.find((c) => c.type === "undo_change")).toEqual({
      type: "undo_change",
      sessionId: "s1",
      ref: "refs/x",
      path: "a.txt",
      hunk: 1,
      afterHash: hash,
      confirm: true,
    })
  })

  it("says which decision allowed each change, and sends comments on several together to the prompt box (G13)", async () => {
    versions = { ok: true, data: { before: "a\nb\nc\nd\n", after: "a\nBeta\nc\nd\ne\n" } }
    const { useStore } = await import("../src/store")
    useStore.setState({
      transcripts: {
        s1: {
          items: [
            {
              kind: "tool",
              toolUseId: "e1",
              name: "Edit",
              input: { file_path: "C:\\dev\\shop\\a.txt", old_string: "b", new_string: "Beta" },
            },
          ],
          todos: [],
          seq: 0,
        },
      },
      decisions: {
        e1: {
          outcome: "allow",
          decidedBy: "rules",
          ruleId: "edit-in-project",
          reason: "An edit inside the project.",
          risk: 10,
          at: 1,
        },
      },
    } as never)
    const composed: string[] = []
    const listen = (e: Event) => composed.push((e as CustomEvent<{ text: string }>).detail.text)
    window.addEventListener("codeh:compose", listen)
    render(<ChangesPane sessionId="s1" cwd="C:\dev\shop" />)
    fireEvent.click(await screen.findByRole("button", { name: /a\.txt/ }))
    const list = await screen.findByRole("region", { name: "Changes in a.txt" })
    expect(list.textContent).toContain("Edit: Allowed by your rules: An edit inside the project.")
    expect(list.textContent).toContain("Not from an edit Claude made in this session")
    fireEvent.click(screen.getByRole("button", { name: "Comment on: Changed line 2 (was 1 line)" }))
    fireEvent.change(screen.getByRole("textbox", { name: /Your comment on: Changed line 2/ }), {
      target: { value: "Spell it out." },
    })
    fireEvent.click(screen.getByRole("button", { name: "Done" }))
    fireEvent.click(screen.getByRole("button", { name: "Comment on: Added 1 line at line 5" }))
    fireEvent.change(screen.getByRole("textbox", { name: /Your comment on: Added 1 line/ }), {
      target: { value: "Why this line?" },
    })
    expect(composed).toEqual([])
    fireEvent.click(screen.getByRole("button", { name: "Put 2 comments in the prompt box" }))
    window.removeEventListener("codeh:compose", listen)
    expect(composed).toHaveLength(1)
    expect(composed[0]).toContain(
      "a.txt, Changed line 2 (was 1 line):\n```\nBeta\n```\nSpell it out.",
    )
    expect(composed[0]).toContain("a.txt, Added 1 line at line 5:\n```\ne\n```\nWhy this line?")
    expect(screen.queryByRole("button", { name: /comments? in the prompt box/ })).toBeNull()
    useStore.setState({ transcripts: {}, decisions: {} } as never)
  })

  it("counts changes the way the Host does, and says what each is", async () => {
    const { changesIn, changeWords } = await import("../src/components/ChangesPane")
    const hunks = changesIn("one\ntwo\nthree\n", "one\nthree\nfour\n")
    expect(hunks.map(changeWords)).toEqual([
      "Removed 1 line before line 2",
      "Added 1 line at line 3",
    ])
  })
})
