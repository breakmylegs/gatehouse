// T-037: Markdown in the message box: lists continue and end, items indent, a code block closes itself with the
// caret inside and keeps indentation, and the backdrop's pieces are the text exactly, marked by what they are.
import { describe, expect, it } from "vitest"
import { indent, inFence, marks, newLine } from "../src/lib/markdown-edit"

const at = (text: string) => ({ text: text.replace("|", ""), pos: text.indexOf("|") })
const nl = (s: string) => {
  const { text, pos } = at(s)
  const e = newLine(text, pos, pos)
  return e && `${e.text.slice(0, e.caret)}|${e.text.slice(e.caret)}`
}

describe("Markdown as you type (T-037)", () => {
  it("continues a list, counts numbers up, starts a task empty, and ends on an empty item", () => {
    expect(nl("- apples|")).toBe("- apples\n- |")
    expect(nl("  * nested|\nafter")).toBe("  * nested\n  * |\nafter")
    expect(nl("9. ninth|")).toBe("9. ninth\n10. |")
    expect(nl("- [x] done|")).toBe("- [x] done\n- [ ] |")
    expect(nl("- one\n- |")).toBe("- one\n|")
    // Not at the end of the item, or not a list: the box makes a plain line.
    expect(nl("- app|les")).toBeUndefined()
    expect(nl("plain words|")).toBeUndefined()
    expect(newLine("- a", 0, 3)).toBeUndefined()
  })

  it("closes a code block it opens, with the caret inside, and keeps indentation within it", () => {
    expect(nl("```ts|")).toBe("```ts\n|\n```")
    expect(nl("```ts|\nlet a = 1\n```")).toBeUndefined()
    expect(nl("```\n    indented|\n```")).toBe("```\n    indented\n    |\n```")
    expect(nl("```\nflush|\n```")).toBeUndefined()
    // A list marker inside a block is code, not a list.
    expect(nl("```\n- not a list|\n```")).toBeUndefined()
    expect(inFence("```\nx\n```\ny", 11)).toBe(false)
  })

  it("indents and outdents a list item with Tab and Shift+Tab, and leaves other lines to the box", () => {
    expect(indent("- a", 3, 3, false)).toEqual({ text: "  - a", caret: 5 })
    expect(indent("  - a", 5, 5, true)).toEqual({ text: "- a", caret: 3 })
    expect(indent("- a", 3, 3, true)).toBeUndefined()
    expect(indent("words", 5, 5, false)).toBeUndefined()
  })

  it("marks the text by what it is, and the pieces joined are the text exactly", () => {
    const text = "# Plan\n- **ship** it with `npm run release`\n> quoted\n```sh\nnpm test\n```\nplain `open"
    const m = marks(text)
    expect(m.map((x) => x.text).join("")).toBe(text)
    expect(m.find((x) => x.kind === "heading")?.text).toBe("# Plan\n")
    expect(m.find((x) => x.kind === "marker")?.text).toBe("- ")
    expect(m.find((x) => x.kind === "strong")?.text).toBe("**ship**")
    expect(m.find((x) => x.kind === "code")?.text).toBe("`npm run release`")
    expect(m.find((x) => x.kind === "quote")?.text).toBe("> quoted\n")
    expect(m.find((x) => x.kind === "fence")?.text).toBe("```sh\nnpm test\n```\n")
    expect(m.at(-1)).toEqual({ text: "plain `open", kind: "plain" })
  })
})
