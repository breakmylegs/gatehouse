// @vitest-environment jsdom
// T-050 (t3code review): a CSV or TSV file opens in the viewer as a table, quoted fields kept whole, with its source a
// button away; the text is shown as text, never as markup.
import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { parseDelimited } from "../src/lib/delimited"

const rect = { x: 0, y: 0, top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0, toJSON() {} }
Range.prototype.getClientRects = () => [] as unknown as DOMRectList
Range.prototype.getBoundingClientRect = () => rect as DOMRect

let fileText = ""
vi.mock("sonner", () => ({ toast: Object.assign(vi.fn(), { error: vi.fn() }) }))
vi.mock("../src/lib/api", () => ({
  api: vi.fn(async (_method: string, url: string) =>
    url.startsWith("/api/files/read")
      ? { ok: true, status: 200, data: { kind: "text", text: fileText, size: fileText.length, truncated: false, hash: "h" } }
      : url.startsWith("/api/files/outline")
        ? { ok: true, status: 200, data: { symbols: [] } }
        : { ok: true, status: 200, data: { base: "/preview/t/" } },
  ),
}))
const { Viewer } = await import("../src/components/FilesPanel")

afterEach(cleanup)

const open = (rel: string) =>
  render(<Viewer sessionId="s1" opened={{ kind: "file", rel }} onClose={() => undefined} onNavigate={() => undefined} />)

describe("CSV and TSV as a table (T-050)", () => {
  it("reads quoted fields with commas, line breaks and doubled quotes, and counts what is left out", () => {
    expect(parseDelimited('name,note\r\n"Smith, J","said ""hi""\nthen left"\n', ",").rows).toEqual([
      ["name", "note"],
      ["Smith, J", 'said "hi"\nthen left'],
    ])
    expect(parseDelimited("a\tb\n1\t2", "\t").rows).toEqual([["a", "b"], ["1", "2"]])
    expect(parseDelimited("h\n1\n2\n3\n", ",", 2)).toEqual({ rows: [["h"], ["1"]], more: 2 })
  })

  it("opens a CSV as a table with its headings, as text, and shows the source on asking", async () => {
    fileText = 'item,price\n"<img src=x onerror=alert(1)>",3\n'
    const { container } = open("data/prices.csv")
    const table = await screen.findByRole("table", { name: "data/prices.csv, as a table" })
    expect(screen.getByRole("columnheader", { name: "price" })).toBeTruthy()
    expect(table.textContent).toContain("<img src=x onerror=alert(1)>")
    expect(container.querySelector("img")).toBeNull()
    fireEvent.click(screen.getByRole("button", { name: "Show the source" }))
    expect(screen.queryByRole("table")).toBeNull()
    expect(screen.getByRole("button", { name: "Show the table" })).toBeTruthy()
  })
})
