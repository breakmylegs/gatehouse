// C-059: a workbook is read with its sheets, numbers, shared and inline strings and formulas with saved values; macros
// are never read; a hostile file is refused within limits; a chat project's workbook gets a Markdown copy.
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import zlib from "node:zlib"
import { afterEach, describe, expect, it } from "vitest"
import { zip } from "../src/office.js"
import { ProjectStore } from "../src/projects.js"
import { readXlsx, readXlsxHere, readXlsxIsolated, workbookMarkdown, XLSX_LIMITS } from "../src/xlsx-read.js"

const dirs: string[] = []
afterEach(() => {
  for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true })
})

const H = `<?xml version="1.0" encoding="UTF-8"?>`
function book(extra: Array<{ name: string; data: string | Buffer }> = []) {
  return zip([
    { name: "xl/workbook.xml", data: `${H}<workbook xmlns:r="r"><sheets><sheet name="Costs &amp; totals" sheetId="1" r:id="rId1"/><sheet name="Notes" sheetId="2" r:id="rId2"/></sheets></workbook>` },
    { name: "xl/_rels/workbook.xml.rels", data: `${H}<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Target="/xl/worksheets/sheet2.xml"/><Relationship Id="rId9" Target="http://evil.example/x" TargetMode="External"/></Relationships>` },
    { name: "xl/sharedStrings.xml", data: `${H}<sst><si><t>Item</t></si><si><t>Cost</t></si><si><r><t>Ser</t></r><r><t>vers</t></r></si></sst>` },
    { name: "xl/worksheets/sheet1.xml", data: `${H}<worksheet><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c></row><row r="2"><c r="A2" t="s"><v>2</v></c><c r="B2"><v>120.5</v></c></row><row r="3"><c r="A3" t="inlineStr"><is><t>Total &lt;all&gt;</t></is></c><c r="C3"><f>SUM(B2:B2)</f><v>120.5</v></c><c r="D3" t="b"><v>1</v></c></row></sheetData></worksheet>` },
    { name: "xl/worksheets/sheet2.xml", data: `${H}<worksheet><sheetData/></worksheet>` },
    ...extra,
  ])
}

describe("XLSX attachments", () => {
  it("reads sheets, shared and inline strings, numbers, booleans and formulas with their saved values", () => {
    const wb = readXlsxHere(book())
    expect(wb.sheets.map((s) => s.name)).toEqual(["Costs & totals", "Notes"])
    expect(wb.sheets[0]!.rows).toEqual([
      ["Item", "Cost"],
      ["Servers", 120.5],
      ["Total <all>", "", { formula: "=SUM(B2:B2)", value: 120.5 }, true],
    ])
    expect(wb.notes).toEqual([])
    const md = workbookMarkdown("costs.xlsx", wb)
    expect(md).toMatch(/## Costs & totals\n\n\| Item \| Cost \|  \|  \|/)
    expect(md).toContain("| Total <all> |  | 120.5 (=SUM(B2:B2)) | true |")
    expect(md).toMatch(/## Notes\n\n\(empty\)/)
  })

  it("never reads macros, and says the workbook has them", () => {
    const wb = readXlsxHere(book([{ name: "xl/vbaProject.bin", data: Buffer.from("Attribute VB_Name = \"Evil\"") }]))
    expect(wb.notes).toEqual(["The workbook has macros; they were not read or run."])
    expect(JSON.stringify(wb)).not.toContain("VB_Name")
  })

  it("refuses a hostile file within its limits", () => {
    expect(() => readXlsxHere(Buffer.from("not a zip"))).toThrow(/not a zip/)
    // A part that unpacks past the limit (a zip bomb) stops the reading.
    const bomb = zip([{ name: "xl/workbook.xml", data: Buffer.alloc(2 * 1024 * 1024, 0x20) }])
    expect(() => readXlsx(bomb, zlib.inflateRawSync, { ...XLSX_LIMITS, partBytes: 1024 * 1024 })).toThrow()
    expect(() => readXlsx(Buffer.alloc(11), zlib.inflateRawSync, { ...XLSX_LIMITS, fileBytes: 10 })).toThrow(/over/)
    const capped = readXlsx(book(), zlib.inflateRawSync, { ...XLSX_LIMITS, cells: 3 })
    expect(capped.notes).toEqual(["Only the first 3 cells were read."])
    // The cap stops within a row, not only at its end.
    expect(capped.sheets[0]!.rows).toEqual([["Item", "Cost"], ["Servers"]])
  })

  it("reads in a worker thread, and a chat project's workbook gets a Markdown copy that goes with it", async () => {
    expect((await readXlsxIsolated(book())).sheets[0]!.rows[1]).toEqual(["Servers", 120.5])
    await expect(readXlsxIsolated(Buffer.from("not a zip"))).rejects.toThrow(/not a zip/)
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "codeh-xlsx-"))
    dirs.push(dir)
    const store = new ProjectStore(dir)
    store.create("Budget")
    await store.addFile("Budget", "costs.xlsx", book())
    const files = store.get("Budget")!.files.map((f) => f.name)
    expect(files).toEqual(["costs.xlsx", "costs.xlsx.md"])
    expect(fs.readFileSync(path.join(store.knowledgeDir("Budget"), "costs.xlsx.md"), "utf8")).toContain("| Servers | 120.5 |")
    store.removeFile("Budget", "costs.xlsx")
    expect(store.get("Budget")!.files).toEqual([])
  })
})
