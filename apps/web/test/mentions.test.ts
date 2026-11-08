// Backlog F15: @ mentions in the prompt box, and line ranges written out for Claude.
import { describe, expect, it } from "vitest"
import { chooseMention, mentionAt, writeRanges } from "../src/lib/mentions"

describe("@ mentions", () => {
  it("finds the @ word the cursor is in, and only one that starts a word", () => {
    expect(mentionAt("look at @src/a", 14)).toEqual({ start: 8, query: "src/a" })
    expect(mentionAt("@", 1)).toEqual({ start: 0, query: "" })
    expect(mentionAt("mail me at a@b.com", 18)).toBeUndefined()
    expect(mentionAt("look at @src/a then", 19)).toBeUndefined()
  })

  it("puts the chosen file in place of the word, with a space after it", () => {
    const text = "fix @par please"
    const at = mentionAt(text, 8)!
    expect(chooseMention(text, at, "src/parser.ts")).toEqual({
      text: "fix @src/parser.ts  please",
      caret: 19,
    })
  })

  it("writes ranges out, and leaves anything else alone", () => {
    expect(writeRanges("see @src/a.ts:10-20 and @b.ts:7.")).toBe(
      "see @src/a.ts (lines 10 to 20) and @b.ts (line 7).",
    )
    expect(writeRanges("@C:/x/a.ts:3")).toBe("@C:/x/a.ts (line 3)")
    expect(writeRanges("time 10:30 and a@b.ts:4")).toBe("time 10:30 and a@b.ts:4")
    expect(writeRanges("@src/a.ts")).toBe("@src/a.ts")
  })
})
