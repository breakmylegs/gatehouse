// E-081: a fixture report makes a .docx (and .pptx and .xlsx) that opens: a valid zip whose parts are all present and
// well-formed XML; a redaction term is masked in it; and the AI-generated mark is in it, visibly and in its properties.
import Fastify from "fastify"
import { describe, expect, it } from "vitest"
import { registerExportRoutes } from "../src/export-api.js"
import { AI_MARK, docx, pptx, sheetsOf, xlsx, xml } from "../src/office.js"
import { unzip, wellFormed } from "./ooxml.js"

const REPORT = [
  "# Release report",
  "",
  "The change ships the **new checkout** for ACME-CORP, with `retry` on payments.",
  "",
  "## Checks",
  "",
  "- Tests pass",
  "- Sealed checks pass",
  "",
  "| Area | Count | Cost |",
  "|---|---|---|",
  "| Tests | 1,204 | £12.50 |",
  "| Checks | 33 | 3.5 |",
  "",
  "```",
  "npm test <all> & more",
  "```",
].join("\n")

describe("Office files", () => {
  it("makes a .docx that opens, with the AI-generated mark", () => {
    const parts = unzip(docx("Release report", REPORT))
    for (const p of ["[Content_Types].xml", "_rels/.rels", "word/document.xml", "word/_rels/document.xml.rels", "word/styles.xml", "docProps/core.xml", "docProps/app.xml"]) {
      expect(parts.has(p), p).toBe(true)
      expect(wellFormed(parts.get(p)!), p).toBe(true)
    }
    const doc = parts.get("word/document.xml")!
    expect(doc).toContain(xml(AI_MARK))
    expect(doc.indexOf(xml(AI_MARK))).toBeLessThan(doc.indexOf("Release report"))
    expect(doc).toContain('<w:pStyle w:val="Heading2"/>')
    expect(doc).toContain("<w:tbl>")
    expect(doc).toContain("npm test &lt;all&gt; &amp; more")
    expect(doc).toMatch(/<w:b\/><\/w:rPr><w:t xml:space="preserve">new checkout<\/w:t>/)
    expect(parts.get("docProps/core.xml")).toContain("<cp:keywords>AI-generated</cp:keywords>")
    expect(parts.get("docProps/core.xml")).toContain(xml(AI_MARK))
  })

  it("makes a .pptx and an .xlsx that open, each with the mark", () => {
    const p = unzip(pptx("Release report", REPORT))
    for (const [name, text] of p) expect(wellFormed(text), name).toBe(true)
    expect([...p.keys()].filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n))).toHaveLength(3)
    expect(p.get("ppt/slides/slide1.xml")).toContain(xml(AI_MARK))
    const x = unzip(xlsx("Release report", sheetsOf(REPORT)))
    for (const [name, text] of x) expect(wellFormed(text), name).toBe(true)
    const sheet = x.get("xl/worksheets/sheet1.xml")!
    expect(sheet).toContain(xml(AI_MARK))
    // Numbers in the table are numbers in the sheet.
    expect(sheet).toContain('<c r="B3"><v>1204</v></c>')
    expect(sheet).toContain('<c r="C3"><v>12.5</v></c>')
    expect(x.get("docProps/core.xml")).toContain("AI-generated")
  })

  it("leaves out characters XML does not allow", () => {
    const doc = unzip(docx("x", "bad \u0001 char \uD800 here")).get("word/document.xml")!
    expect(wellFormed(doc)).toBe(true)
    expect(doc).toContain("bad  char  here")
  })

  it("masks a redaction term in the Office file, which is the previewed text", async () => {
    const app = Fastify()
    const records: unknown[] = []
    registerExportRoutes(app, { audit: { record: async (r: unknown) => (records.push(r), true) } as never, config: () => ({ redactTerms: ["ACME-CORP"] }) as never })
    const preview = (await app.inject({ method: "POST", url: "/api/export/redact", payload: { text: REPORT, format: "md", title: "Release report", preview: true } })).json() as { text: string }
    const r = (await app.inject({ method: "POST", url: "/api/export/redact", payload: { text: REPORT, format: "docx", title: "Release report" } })).json() as { text: string; file: string; mime: string }
    expect(r.text).toBe(preview.text)
    expect(r.mime).toMatch(/wordprocessingml/)
    const doc = unzip(Buffer.from(r.file, "base64")).get("word/document.xml")!
    expect(doc).not.toContain("ACME-CORP")
    expect(doc).toContain("[REDACTED")
    expect(records).toEqual([expect.objectContaining({ event: "conversation_exported", input: expect.objectContaining({ format: "docx" }) })])
    await app.close()
  })
})
