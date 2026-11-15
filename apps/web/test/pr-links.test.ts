// T-078 (t3code review): the pull requests a session opened are found in its own transcript: the address a
// successful gh pr create printed, once each; nothing else counts.
import { describe, expect, it } from "vitest"
import { prLinks } from "../src/lib/prLinks"
import type { Item } from "../src/lib/transcript"

const tool = (command: string, text: string, isError = false, name = "Bash") =>
  ({ kind: "tool", id: command, toolUseId: command, name, input: { command }, result: { text, isError } }) as unknown as Item

describe("pull requests a session opened (T-078)", () => {
  it("links what gh pr create printed, once each", () => {
    const items = [
      tool('gh pr create --title "Fix" --body x', "https://github.com/acme/shop/pull/12\n"),
      tool("gh pr create --fill", "Warning\nhttps://github.com/acme/shop/pull/12"),
      tool("gh pr create --fill", "https://github.com/acme/api/pull/7", false, "PowerShell"),
    ]
    expect(prLinks(items)).toEqual([
      { url: "https://github.com/acme/shop/pull/12", repo: "acme/shop", number: 12 },
      { url: "https://github.com/acme/api/pull/7", repo: "acme/api", number: 7 },
    ])
  })

  it("ignores an address another command printed, a failed create, and other tools", () => {
    const items = [
      tool("gh pr view 3", "https://github.com/acme/shop/pull/3"),
      tool("gh pr create --fill", "https://github.com/acme/shop/pull/4", true),
      { kind: "tool", id: "w", toolUseId: "w", name: "WebFetch", input: { command: "gh pr create" }, result: { text: "https://github.com/a/b/pull/5", isError: false } } as unknown as Item,
      { kind: "text", id: "t", text: "https://github.com/acme/shop/pull/6" } as Item,
    ]
    expect(prLinks(items)).toEqual([])
  })
})
