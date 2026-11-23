// E-085: a fixture's totals are formulas that evaluate to the expected values; a formula outside the checked subset is
// marked "not verified", and a total the table got wrong is a mismatch.
import { describe, expect, it } from "vitest"
import { evaluate, formulaFirst, formulaWorkbook } from "../src/formulas.js"
import { sheetsOf, xlsx } from "../src/office.js"
import { unzip } from "./ooxml.js"

const FIXTURE = [
  "| Item | Q1 | Q2 |",
  "|---|---|---|",
  "| Servers | 1,200 | 1,350.50 |",
  "| Licences | 300 | 320 |",
  "| Total | 1,500 | 1,670.50 |",
  "| Support | 80 | 95 |",
  "| Subtotal | 80 | 90 |",
  "| Average | 40 | 47.5 |",
].join("\n")

describe("formula-first spreadsheets", () => {
  it("writes the fixture's totals as formulas that evaluate to the expected values", () => {
    const [sheet] = sheetsOf(FIXTURE)
    const { sheet: out, checks } = formulaFirst(sheet!, 1)
    // Row 4 of the table (row 5 when written, after the AI mark line).
    expect(out.rows[3]).toEqual(["Total", { formula: "=SUM(B3:B4)", value: 1500 }, { formula: "=SUM(C3:C4)", value: 1670.5 }])
    // A subtotal covers only the rows since the last total.
    expect(out.rows[5]![1]).toEqual({ formula: "=SUM(B6:B6)", value: 80 })
    // An Average after a Subtotal covers the Subtotal's rows, not the Subtotal: the table's 40 is flagged.
    expect(out.rows[6]![1]).toEqual({ formula: "=AVERAGE(B6:B6)", value: 80 })
    expect(checks).toContainEqual(expect.objectContaining({ cell: "B8", state: "mismatch", stated: 40, value: 80 }))
    expect(checks.filter((c) => c.state === "verified").map((c) => c.cell)).toEqual(expect.arrayContaining(["B5", "C5", "B7"]))
    // The table said 90 where its rows add to 95: kept as a formula, and flagged.
    expect(checks).toContainEqual(expect.objectContaining({ cell: "C7", state: "mismatch", stated: 90, value: 95 }))
    // In the workbook they are formulas with their values, not pasted numbers.
    const xml = unzip(xlsx("Costs", [out])).get("xl/worksheets/sheet1.xml")!
    expect(xml).toContain('<c r="B5"><f>SUM(B3:B4)</f><v>1500</v></c>')
    expect(xml).not.toContain('<c r="B5"><v>1500</v></c>')
  })

  it("makes an export's workbook formula-first, with a sheet of the checks", () => {
    const { file, checks } = formulaWorkbook("Costs", `Intro text.\n\n${FIXTURE}`)
    const parts = unzip(file)
    expect(parts.get("xl/workbook.xml")).toContain('<sheet name="Formula checks"')
    const checksXml = parts.get("xl/worksheets/sheet2.xml")!
    expect(checksXml).toContain("=SUM(B3:B4)")
    expect(checksXml).toContain("mismatch")
    expect(checks.some((c) => c.state === "verified")).toBe(true)
    expect(formulaWorkbook("Plain", "No tables here.").checks).toEqual([])
    expect(unzip(formulaWorkbook("Plain", "No tables here.").file).get("xl/workbook.xml")).not.toContain("Formula checks")
  })

  it("evaluates the supported subset, and marks anything else not verified", () => {
    const cells: Record<string, number> = { "0,0": 2, "1,0": 3, "0,1": 4 }
    const at = (c: number, r: number) => cells[`${c},${r}`]
    expect(evaluate("=SUM(A1:B2)*2-(A2/2)", at)).toBe(16)
    expect(evaluate("=MAX(A1,B1,A2)+MIN(A1:A2)+COUNT(A1:B2)", at)).toBe(9)
    expect(evaluate("=AVERAGE(A1:A2)", at)).toBe(3)
    expect(() => evaluate("=VLOOKUP(A1,B1:B2,1)", at)).toThrow(/not in the subset/)
    expect(() => evaluate("=A1/0", at)).toThrow(/divides by zero/)
    const { checks } = formulaFirst({ name: "S", rows: [["Item", "Value"], ["A", { formula: "=VLOOKUP(1,A1:A2,1)" }]] })
    expect(checks).toEqual([expect.objectContaining({ cell: "B2", state: "not verified", detail: expect.stringMatching(/VLOOKUP/) })])
  })
})
