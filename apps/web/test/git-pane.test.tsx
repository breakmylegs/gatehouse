// @vitest-environment jsdom
// Backlog G36: the git panel: history, staging one shown change, conflicts opened and marked resolved, blame.
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const calls: Array<{ method: string; url: string; body?: unknown }> = []
vi.mock("sonner", () => ({ toast: Object.assign(vi.fn(), { error: vi.fn() }) }))
vi.mock("react-virtuoso", () => ({
  Virtuoso: (p: { data: unknown[]; itemContent: (i: number, d: unknown) => unknown }) => (
    <div>
      {p.data.map((d, i) => (
        <div key={i}>{p.itemContent(i, d) as never}</div>
      ))}
    </div>
  ),
}))
vi.mock("../src/lib/api", () => ({
  api: vi.fn(async (method: string, url: string, body?: unknown) => {
    calls.push({ method, url, body })
    if (url.startsWith("/api/git/history"))
      return {
        ok: true,
        status: 200,
        data: {
          lines: [
            {
              graph: "* ",
              hash: "1a2b3c4",
              subject: "Add the basket",
              author: "Ada",
              date: "2026-11-09",
            },
          ],
        },
      }
    if (url.startsWith("/api/git/changes"))
      return {
        ok: true,
        status: 200,
        data: {
          files: [
            {
              path: "src/a.ts",
              staged: false,
              hunks: [{ index: 0, header: "@@ -1 +1 @@", lines: ["-a", "+b"] }],
            },
          ],
        },
      }
    if (url.startsWith("/api/git/conflicts"))
      return { ok: true, status: 200, data: { files: ["b.txt"] } }
    if (url.startsWith("/api/git/blame"))
      return {
        ok: true,
        status: 200,
        data: {
          lines: [
            {
              line: 1,
              hash: "1a2b3c4d",
              author: "Ada",
              date: "2026-11-09",
              summary: "first",
              text: "line 1",
            },
          ],
        },
      }
    return { ok: true, status: 200, data: { ok: true } }
  }),
}))
const { GitPane } = await import("../src/components/GitPane")

beforeEach(() => {
  calls.length = 0
})
afterEach(cleanup)

describe("the git panel", () => {
  it("shows the history, and stages one shown change", async () => {
    render(<GitPane sessionId="s1" onOpen={() => undefined} />)
    expect(await screen.findByText("Add the basket")).toBeTruthy()
    fireEvent.click(screen.getByRole("tab", { name: "Stage" }))
    const list = await screen.findByRole("list", { name: "Changes to stage" })
    expect(list.textContent).toContain("+b")
    fireEvent.click(within(list).getByRole("button", { name: "Stage @@ -1 +1 @@ in src/a.ts" }))
    await waitFor(() =>
      expect(calls.find((c) => c.url === "/api/git/stage")?.body).toEqual({
        session: "s1",
        path: "src/a.ts",
        index: 0,
      }),
    )
  })

  it("opens a file in conflict, and marks it resolved", async () => {
    const onOpen = vi.fn()
    render(<GitPane sessionId="s1" onOpen={onOpen} />)
    fireEvent.click(screen.getByRole("tab", { name: "Conflicts" }))
    fireEvent.click(await screen.findByRole("button", { name: "Open b.txt to resolve it" }))
    expect(onOpen).toHaveBeenCalledWith({ kind: "file", rel: "b.txt" })
    fireEvent.click(screen.getByRole("button", { name: "Mark b.txt resolved" }))
    await waitFor(() =>
      expect(calls.find((c) => c.url === "/api/git/resolve")?.body).toEqual({
        session: "s1",
        path: "b.txt",
      }),
    )
  })

  it("shows who last changed each line of a file", async () => {
    render(<GitPane sessionId="s1" onOpen={() => undefined} />)
    fireEvent.click(screen.getByRole("tab", { name: "Blame" }))
    fireEvent.change(screen.getByRole("textbox", { name: "File to blame" }), {
      target: { value: "a.txt" },
    })
    fireEvent.click(screen.getByRole("button", { name: "Show" }))
    const shown = await screen.findByRole("list", { name: "Blame of a.txt" })
    expect(shown.textContent).toMatch(/1a2b3c4d Ada.*1.*line 1/)
  })
})
