// @vitest-environment jsdom
// T-072 (t3code review): the Changes pane looks at one commit: chosen from the latest, with what it says and each
// file's diff.
import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

const rect = { x: 0, y: 0, top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0, toJSON() {} }
Range.prototype.getClientRects = () => [] as unknown as DOMRectList
Range.prototype.getBoundingClientRect = () => rect as DOMRect

const urls: string[] = []
vi.mock("../src/lib/api", () => ({
  api: vi.fn(async (_m: string, url: string) => {
    urls.push(url)
    if (url.startsWith("/api/git/history"))
      return { ok: true, status: 200, data: { lines: [{ graph: "* ", hash: "abc1234", subject: "Fix the cache", date: "2026-11-15" }, { graph: "|" }] } }
    return {
      ok: true,
      status: 200,
      data: { hash: "abc1234", subject: "Fix the cache", author: "Ada", date: "2026-11-15", truncated: false, files: [{ path: "src/cache.ts", diff: "@@ -1 +1 @@\n-old\n+new" }] },
    }
  }),
}))
vi.mock("../src/store", async (orig) => {
  const actual = await orig<typeof import("../src/store")>()
  return {
    ...actual,
    send: vi.fn(async (cmd: Record<string, unknown>) =>
      cmd.type === "changes"
        ? { ok: true, data: { checkpoints: [{ ref: "r", createdAt: "2026-11-15T01:00:00Z", label: "start" }], since: { ref: "r", createdAt: "2026-11-15T01:00:00Z", label: "start" }, files: [{ path: "a.ts", change: "modified", added: 1, removed: 0, binary: false, diff: "@@ -1 +1 @@\n+x" }] } }
        : { ok: true },
    ),
  }
})
const { ChangesPane } = await import("../src/components/ChangesPane")

afterEach(cleanup)

describe("a commit in the Changes pane (T-072)", () => {
  it("lists the latest commits and shows the one chosen, file by file", async () => {
    render(<ChangesPane sessionId="s1" cwd="C:\\dev\\shop" />)
    fireEvent.click(await screen.findByRole("button", { name: "Look at a commit..." }))
    const pick = (await screen.findByRole("combobox", { name: "Commit" })) as HTMLSelectElement
    expect([...pick.options].map((o) => o.value)).toEqual(["", "abc1234"])
    fireEvent.change(pick, { target: { value: "abc1234" } })
    expect(await screen.findByText("Fix the cache", { selector: "strong" })).toBeTruthy()
    expect(screen.getByText("src/cache.ts")).toBeTruthy()
    expect(urls.at(-1)).toBe("/api/git/commit?session=s1&hash=abc1234")
  })
})
