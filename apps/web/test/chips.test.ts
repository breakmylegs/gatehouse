// T-048: context as chips. A chip's token is short and plain; sending puts what it stands for in its place; a deleted
// token sends nothing of it; a token with no chip, or the wrong kind, is left as typed; the backdrop draws chips.
import { describe, expect, it } from "vitest"
import { chipLabel, chipToken, expandChips, type Chip } from "../src/lib/chips"
import { marks } from "../src/lib/markdown-edit"

const chips: Record<number, Chip> = {
  1: { kind: "terminal", label: "npm test", text: "About this from my terminal:\n\n```text\nnpm test\n1 failed\n```" },
  2: { kind: "diff", label: "2 notes", text: "My notes on your changes:\n- src/a.ts: rename this" },
}

describe("context chips in the message box (T-048)", () => {
  it("makes a short, plain token from the first line", () => {
    expect(chipLabel("\n  npm   test -- --run\nmore")).toBe("npm test -- --run")
    expect(chipLabel("x".repeat(60))).toHaveLength(40)
    expect(chipLabel("a ⟦sly⟧ label")).toBe("a sly label")
    expect(chipLabel("   ")).toBe("context")
    expect(chipToken("terminal", 1, "npm test")).toBe("⟦terminal 1: npm test⟧")
  })

  it("sends what each kept chip stands for in its place, and nothing of one whose token was deleted", () => {
    const typed = `Why does this fail? ${chipToken("terminal", 1, "npm test")} and see ${chipToken("diff", 2, "2 notes")}`
    expect(expandChips(typed, chips)).toBe(`Why does this fail?\n\n${chips[1]!.text}\n\nand see\n\n${chips[2]!.text}`)
    // Deleted from the box: its context goes nowhere, even though it is still kept.
    expect(expandChips("Why does this fail?", chips)).toBe("Why does this fail?")
  })

  it("leaves a token with no chip, or of another kind, as typed", () => {
    expect(expandChips("see ⟦terminal 9: gone⟧", chips)).toBe("see ⟦terminal 9: gone⟧")
    expect(expandChips("see ⟦review 1: npm test⟧", chips)).toBe("see ⟦review 1: npm test⟧")
  })

  it("draws chips and @files as chips in the backdrop, and the pieces are still the text exactly", () => {
    const text = "Look at @src/a.ts and ⟦terminal 1: npm test⟧ please, me@example.com"
    const m = marks(text)
    expect(m.map((x) => x.text).join("")).toBe(text)
    expect(m.filter((x) => x.kind === "chip").map((x) => x.text)).toEqual(["@src/a.ts", "⟦terminal 1: npm test⟧"])
  })
})
