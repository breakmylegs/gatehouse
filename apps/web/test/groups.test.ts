import { describe, expect, it } from "vitest"
import { groupItems, summarise } from "../src/lib/groups"
import type { Item } from "../src/lib/transcript"

let n = 0
const tool = (
  name: string,
  input: Record<string, unknown> = {},
  extra: Partial<Extract<Item, { kind: "tool" }>> = {},
): Extract<Item, { kind: "tool" }> => ({
  id: `t${n++}`,
  kind: "tool",
  toolUseId: `u${n}`,
  name,
  input,
  ...extra,
})
const text = (t: string): Item => ({ id: `x${n++}`, kind: "text", text: t })

describe("runs of tool calls in the transcript", () => {
  it("fold into one line each, split by what Claude says between them", () => {
    const items: Item[] = [
      text("Looking"),
      tool("Bash", { command: "git log" }),
      tool("Read", { file_path: "C:\\dev\\x\\schema.ts" }),
      text("Found it"),
      tool("Write", { file_path: "C:/dev/x/claude-suggest.ts" }),
    ]
    const shown = groupItems(items)
    expect(shown.map((s) => s.kind)).toEqual(["text", "group", "text", "group"])
    const [, first, , second] = shown
    expect(first?.kind === "group" && summarise(first.tools)).toBe("Ran a command, read schema.ts")
    expect(second?.kind === "group" && summarise(second.tools)).toBe("Created claude-suggest.ts")
  })

  it("keeps a subagent's calls apart from the main conversation's", () => {
    const shown = groupItems([tool("Read"), tool("Read", {}, { subagent: "task-1" }), tool("Read")])
    expect(shown).toHaveLength(3)
  })

  it("counts kinds of work, in the order they happened, and says how many failed", () => {
    const tools = [
      tool("PowerShell", { command: "npm test" }, { result: { text: "x", isError: true } }),
      tool("Edit", { file_path: "a.ts" }),
      tool("PowerShell", { command: "npm run lint" }),
      tool("Edit", { file_path: "b.ts" }),
      tool("WebFetch", { url: "https://react.dev/learn" }),
    ]
    expect(summarise(tools)).toBe("Ran 2 commands, edited 2 files, read react.dev (1 failed)")
  })

  it("names a command by its description when Claude gave one", () => {
    expect(summarise([tool("Bash", { command: "x", description: "Run the tests" })])).toBe(
      'Ran "Run the tests"',
    )
  })
})
