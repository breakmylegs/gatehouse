// @vitest-environment jsdom
// Backlog G35: search the session's files, open a result, and replace only after seeing every line that would change.
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const calls: Array<{ method: string; url: string; body?: unknown }> = []
vi.mock("sonner", () => ({ toast: Object.assign(vi.fn(), { error: vi.fn() }) }))
vi.mock("../src/lib/api", () => ({
  api: vi.fn(async (method: string, url: string, body?: unknown) => {
    calls.push({ method, url, body })
    if (url.startsWith("/api/files/search"))
      return {
        ok: true,
        status: 200,
        data: {
          matches: [
            { path: "src/basket.ts", line: 1, text: "export const basket = []" },
            { path: "src/basket.ts", line: 4, text: "basket.push(x)" },
            { path: "src/pay.ts", line: 2, text: "pay(basket)" },
          ],
          truncated: false,
        },
      }
    if (url === "/api/files/replace/preview")
      return {
        ok: true,
        status: 200,
        data: {
          files: [
            {
              path: "src/basket.ts",
              hash: "h1",
              count: 2,
              lines: [
                { line: 1, before: "export const basket = []", after: "export const cart = []" },
              ],
            },
          ],
          skipped: [{ path: "src/pay.ts", why: "It changed since you looked." }],
        },
      }
    return { ok: true, status: 200, data: { changed: ["src/basket.ts"], skipped: [], count: 2 } }
  }),
}))
const { SearchPane, byFile } = await import("../src/components/SearchPane")

beforeEach(() => {
  calls.length = 0
})
afterEach(cleanup)

describe("searching and replacing across files", () => {
  it("shows matches by file, and a result opens its file", async () => {
    const onOpen = vi.fn()
    render(<SearchPane sessionId="s1" onOpen={onOpen} />)
    fireEvent.change(screen.getByRole("textbox", { name: "Search for" }), {
      target: { value: "basket" },
    })
    fireEvent.click(screen.getByRole("checkbox", { name: "Match case" }))
    fireEvent.click(screen.getByRole("button", { name: "Search" }))
    expect(await screen.findByText("3 matches in 2 files.")).toBeTruthy()
    expect(calls[0]!.url).toBe("/api/files/search?session=s1&q=basket&case=1")
    fireEvent.click(screen.getByRole("button", { name: "Open src/pay.ts at line 2" }))
    expect(onOpen).toHaveBeenCalledWith({ kind: "file", rel: "src/pay.ts" })
  })

  it("shows every line a replace would change first, and replaces only the files shown", async () => {
    render(<SearchPane sessionId="s1" onOpen={() => undefined} />)
    fireEvent.change(screen.getByRole("textbox", { name: "Search for" }), {
      target: { value: "basket" },
    })
    fireEvent.click(screen.getByRole("button", { name: "Search" }))
    await screen.findByText("3 matches in 2 files.")
    fireEvent.click(screen.getByRole("button", { name: "Replace…" }))
    fireEvent.change(screen.getByRole("textbox", { name: "Replace with" }), {
      target: { value: "cart" },
    })
    fireEvent.click(screen.getByRole("button", { name: "Show what would change" }))
    const shown = await screen.findByRole("region", { name: "What would change" })
    expect(shown.textContent).toContain("+1: export const cart = []")
    expect(shown.textContent).toContain("src/pay.ts is left alone")
    expect(calls.some((c) => c.url === "/api/files/replace")).toBe(false)
    fireEvent.click(within(shown).getByRole("button", { name: "Replace in this file" }))
    await waitFor(() =>
      expect(calls.find((c) => c.url === "/api/files/replace")?.body).toEqual({
        session: "s1",
        pattern: "basket",
        regex: false,
        caseSensitive: false,
        replacement: "cart",
        files: [{ path: "src/basket.ts", hash: "h1" }],
      }),
    )
  })

  it("groups matches by file in the order they came", () => {
    expect(
      byFile([
        { path: "a", line: 1, text: "" },
        { path: "a", line: 2, text: "" },
        { path: "b", line: 1, text: "" },
      ]).map((g) => [g.path, g.matches.length]),
    ).toEqual([
      ["a", 2],
      ["b", 1],
    ])
  })
})
