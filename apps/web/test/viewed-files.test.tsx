// @vitest-environment jsdom
// T-077 (t3code review): mark changed files as viewed, with a count, kept per session; a file that changes again comes
// back unmarked.
import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const rect = { x: 0, y: 0, top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0, toJSON() {} }
Range.prototype.getClientRects = () => [] as unknown as DOMRectList
Range.prototype.getBoundingClientRect = () => rect as DOMRect

let bDiff = "@@ -1 +1 @@\n-x\n+y"
const file = (path: string, diff: string) => ({ path, change: "modified", added: 1, removed: 1, binary: false, diff })
vi.mock("../src/store", async (orig) => {
  const actual = await orig<typeof import("../src/store")>()
  return {
    ...actual,
    send: vi.fn(async (cmd: Record<string, unknown>) =>
      cmd.type === "changes"
        ? {
            ok: true,
            data: {
              checkpoints: [{ ref: "refs/x", createdAt: "2026-11-03T01:00:00Z", label: "start" }],
              since: { ref: "refs/x", createdAt: "2026-11-03T01:00:00Z", label: "start" },
              files: [file("a.txt", "@@ -1 +1 @@\n-one\n+two"), file("b.txt", bDiff)],
            },
          }
        : { ok: true },
    ),
  }
})
const { ChangesPane } = await import("../src/components/ChangesPane")

beforeEach(() => {
  localStorage.clear()
  bDiff = "@@ -1 +1 @@\n-x\n+y"
})
afterEach(cleanup)

const pane = (id = "s1") => render(<ChangesPane sessionId={id} cwd="C:\\dev\\shop" />)
const box = (name: string) => screen.findByRole<HTMLInputElement>("checkbox", { name: `Viewed ${name}` })

describe("files marked as viewed (T-077)", () => {
  it("counts the marks, keeps them for the session, and unmarks a file that changed since", async () => {
    pane()
    expect(await screen.findByText("0 of 2 files viewed")).toBeTruthy()
    fireEvent.click(await box("a.txt"))
    fireEvent.click(await box("b.txt"))
    expect(screen.getByText("2 of 2 files viewed")).toBeTruthy()
    cleanup()

    bDiff = "@@ -1 +1 @@\n-x\n+z"
    pane()
    expect((await box("a.txt")).checked).toBe(true)
    expect((await box("b.txt")).checked).toBe(false)
    expect(screen.getByText("1 of 2 files viewed")).toBeTruthy()
    cleanup()

    pane("s2")
    expect((await box("a.txt")).checked).toBe(false)
  })
})
