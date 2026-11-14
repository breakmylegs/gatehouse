// @vitest-environment jsdom
// T-062 (t3code review): find across every file of a change, folded files included, with line numbers; a match opens
// its file.
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { findInDiffs } from "../src/lib/diffFind"

const rect = { x: 0, y: 0, top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0, toJSON() {} }
Range.prototype.getClientRects = () => [] as unknown as DOMRectList
Range.prototype.getBoundingClientRect = () => rect as DOMRect

const a = "--- a/a.ts\n+++ b/a.ts\n@@ -10,3 +10,3 @@\n keep()\n-const when = utc()\n+const when = localTime()\n"
const b = "@@ -1,2 +1,3 @@\n import x\n+// uses LocalTime too\n export {}\n"
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
              files: [file("a.ts", a), file("b.ts", b)],
            },
          }
        : cmd.type === "change_versions"
          ? { ok: false }
          : { ok: true },
    ),
  }
})
const { ChangesPane } = await import("../src/components/ChangesPane")

afterEach(cleanup)

describe("find across a change (T-062)", () => {
  it("finds in every file, ignoring case, with each line's number, and not in the headers", () => {
    const r = findInDiffs([file("a.ts", a), file("b.ts", b)], "localtime")
    expect(r).toMatchObject({ total: 2, files: 2 })
    expect(r.matches.map((m) => [m.path, m.line, m.sign])).toEqual([
      ["a.ts", 11, "+"],
      ["b.ts", 2, "+"],
    ])
    expect(findInDiffs([file("a.ts", a)], "utc").matches).toEqual([{ path: "a.ts", line: 11, sign: "-", text: "const when = utc()" }])
    expect(findInDiffs([file("a.ts", a)], "a.ts").total).toBe(0)
  })

  it("lists the matches in folded files, and opens a file from its match", async () => {
    render(<ChangesPane sessionId="s1" cwd="C:\\dev\\shop" />)
    fireEvent.change(await screen.findByRole("searchbox", { name: "Find in every file" }), {
      target: { value: "LocalTime" },
    })
    expect(screen.getByText("2 matches in 2 files")).toBeTruthy()
    const list = screen.getByRole("list", { name: "Matches" })
    const toB = within(list).getByRole("button", { name: /b\.ts:2/ })
    const changed = screen.getByRole("list", { name: "Changed files" })
    const fileB = () => within(changed).getByRole("button", { name: /^Changed\s*b\.ts/ })
    expect(fileB().getAttribute("aria-expanded")).toBe("false")
    fireEvent.click(toB)
    expect(fileB().getAttribute("aria-expanded")).toBe("true")
  })
})
