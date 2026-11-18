// @vitest-environment jsdom
// Owner, 18 Nov: clicking a link in a chat opened it in the browser but left the Codehouse window on "could not load
// the Codehouse interface (OperationCanceled)". A link that leaves Codehouse, in a chat, an artifact or any Markdown,
// opens in a new window (target="_blank", rel="noopener noreferrer"), so it never navigates Codehouse's own page; in
// CNW's /app it opens a new tab. A link inside the interface is left alone.
import fs from "node:fs"
import path from "node:path"
import { cleanup, render, screen } from "@testing-library/react"
import Markdown from "react-markdown"
import remarkGfm from "remark-gfm"
import { afterEach, describe, expect, it } from "vitest"
import { LINK_PARTS, outward } from "../src/lib/links"
import { MARKDOWN_PARTS } from "../src/surfaces/Workspace"

afterEach(cleanup)

const TEXT = "See [the docs](https://example.com/docs?q=1), [mail](mailto:a@example.com), [a dev page](http://localhost:5173/) and [the top](#main). Bare: https://example.org/x"

describe("links that leave Codehouse", () => {
  for (const [name, parts] of [
    ["a chat", MARKDOWN_PARTS],
    ["an artifact or other Markdown", LINK_PARTS],
  ] as const)
    it(`open in a new window from ${name}, never in Codehouse's own page`, () => {
      render(
        <Markdown remarkPlugins={[remarkGfm]} components={parts}>
          {TEXT}
        </Markdown>,
      )
      for (const label of ["the docs", "mail", "a dev page", "https://example.org/x"]) {
        const a = screen.getByRole("link", { name: label })
        expect(a.getAttribute("target"), label).toBe("_blank")
        expect(a.getAttribute("rel"), label).toBe("noopener noreferrer")
      }
      const inside = screen.getByRole("link", { name: "the top" })
      expect(inside.getAttribute("target")).toBeNull()
    })

  it("gives nothing to an address that is not a web page or an email", () => {
    expect(outward("javascript:alert(1)")).toEqual({})
    expect(outward("/api/artifacts/a1")).toEqual({})
    expect(outward(undefined)).toEqual({})
    expect(outward(" HTTPS://example.com")).toEqual({ target: "_blank", rel: "noopener noreferrer" })
  })

  it("is used by every Markdown shown in the interface", () => {
    const src = path.resolve(import.meta.dirname, "../src")
    const files = fs.readdirSync(src, { recursive: true, encoding: "utf8" }).filter((f) => f.endsWith(".tsx"))
    let shown = 0
    for (const f of files) {
      const text = fs.readFileSync(path.join(src, f), "utf8")
      // The export dialog writes a file; it is not shown in the window.
      if (f.endsWith("ExportDialog.tsx")) continue
      for (const m of text.matchAll(/<Markdown\b[^>]*>/g)) {
        shown++
        expect(m[0], f).toMatch(/components=\{(LINK_PARTS|MARKDOWN_PARTS)\}/)
      }
    }
    expect(shown).toBeGreaterThanOrEqual(6)
  })
})
