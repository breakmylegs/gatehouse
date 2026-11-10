// Backlog G13: each change in the Changes pane is traced to the edit that made it, so its decision can be shown.
import { describe, expect, it } from "vitest"
import { editsOn, linesOf, originOf } from "../src/lib/hunkOrigin"
import { reviewMessage } from "../src/lib/reviewComments"

const tool = (toolUseId: string, name: string, input: Record<string, unknown>) => ({
  kind: "tool",
  toolUseId,
  name,
  input,
})

const items = [
  tool("w1", "Write", {
    file_path: "C:\\shop\\src\\basket.ts",
    content: "export const a = 1\nexport const b = 2\n",
  }),
  tool("r1", "Read", { file_path: "C:\\shop\\src\\basket.ts" }),
  tool("e1", "Edit", {
    file_path: "C:/shop/src/basket.ts",
    old_string: "const b = 2",
    new_string: "const b = 3",
  }),
  tool("m1", "MultiEdit", {
    file_path: "C:\\shop\\src\\basket.ts",
    edits: [{ old_string: "export const a = 1\n", new_string: "" }],
  }),
  tool("o1", "Edit", {
    file_path: "C:\\shop\\src\\other.ts",
    old_string: "x",
    new_string: "const b = 3",
  }),
]

describe("which edit made a change", () => {
  it("finds the edits on a file by its path relative to the session, whatever the slashes or case", () => {
    expect(editsOn(items, "src/basket.ts", "C:\\Shop").map((e) => e.toolUseId)).toEqual([
      "w1",
      "e1",
      "m1",
    ])
  })

  it("matches added lines to the latest edit that wrote them, and removals to the edit that took them out", () => {
    const edits = editsOn(items, "src/basket.ts", "C:\\shop")
    expect(originOf(edits, "  export const b = 3\r\n", "export const b = 2")?.toolUseId).toBe("e1")
    expect(originOf(edits, "", "export const a = 1")?.toolUseId).toBe("m1")
  })

  it("matches nothing for a change no edit made (a command, or you)", () => {
    const edits = editsOn(items, "src/basket.ts", "C:\\shop")
    expect(originOf(edits, "export const c = 9", "")).toBeUndefined()
    expect(originOf(edits, "\n  \n", "")).toBeUndefined()
    // A one-letter change is not matched by an edit that merely contains the letter.
    expect(originOf(edits, "b", "")).toBeUndefined()
  })

  it("gathers comments on several changes into one message, in file order, each with its lines", () => {
    const m = reviewMessage([
      { path: "src/z.ts", where: "line 3", quote: "const z = 1", text: "Name this better." },
      { path: "src/a.ts", where: "lines 1 to 2", quote: "a\nb", text: "  Why two lines?  " },
      { path: "src/b.ts", where: "line 9", quote: "c", text: "   " },
    ])
    expect(m.indexOf("src/a.ts")).toBeLessThan(m.indexOf("src/z.ts"))
    expect(m).toContain("src/a.ts, lines 1 to 2:\n```\na\nb\n```\nWhy two lines?")
    expect(m).not.toContain("src/b.ts")
    expect(reviewMessage([])).toBe("")
  })

  it("reads a change's lines out of a file", () => {
    expect(linesOf("one\ntwo\nthree\n", 2, 2)).toBe("two\nthree")
    expect(linesOf("one\n", 1, 0)).toBe("")
  })
})
