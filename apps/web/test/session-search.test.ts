// T-030: the palette finds a session by its title, project, folder, branch and the pull requests it opened, and finds
// what was said in the sessions open here, your words and Claude's, from three letters, newest first.
import type { SessionInfo } from "@gatehouse/shared/ws-protocol"
import { describe, expect, it } from "vitest"
import { searchSaid, sessionKeywords } from "../src/lib/sessionSearch"
import type { Item } from "../src/lib/transcript"

const s = { id: "s1", title: "CSV export", project: "shop", cwd: "C:/dev/shop", worktree: { branch: "feat/csv-export", repo: "C:/dev/shop" } } as unknown as SessionInfo
const items = [
  { id: "u1", kind: "user", text: "Add a CSV export to the invoices page" },
  { id: "t1", kind: "text", text: "Done. The export writes dates as 2026-11-13." },
  { id: "b1", kind: "tool", name: "Bash", input: { command: "gh pr create --fill" }, result: { text: "https://github.com/acme/shop/pull/42", isError: false } },
] as unknown as Item[]

describe("searching sessions from the palette (T-030)", () => {
  it("knows a session by its title, branch and pull requests as well as its project", () => {
    const k = sessionKeywords(s, items)
    for (const word of ["CSV export", "shop", "C:/dev/shop", "feat/csv-export", "#42", "acme/shop"]) expect(k).toContain(word)
  })

  it("finds your words and Claude's, newest first, with a snippet, and nothing for under three letters", () => {
    const hits = searchSaid({ s1: { items } }, "export")
    expect(hits.map((h) => [h.itemId, h.who])).toEqual([
      ["t1", "claude"],
      ["u1", "you"],
    ])
    expect(hits[0]!.snippet).toContain("The export writes dates")
    expect(searchSaid({ s1: { items } }, "ex")).toEqual([])
    expect(searchSaid({ s1: { items } }, "nowhere to be found")).toEqual([])
  })
})
