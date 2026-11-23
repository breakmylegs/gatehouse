/**
 * E-085, formula-first spreadsheets (Expansion E5). A spreadsheet Codehouse makes from a table uses formulas, not
 * pasted values, where a row is a total: a row whose first cell says Total, Subtotal, Sum, Average, Mean, Min, Max or
 * Count gets SUM, AVERAGE, MIN, MAX or COUNT over the numbers above it, column by column. Each formula is checked by a
 * small evaluator built in here (no formula engine is added, GPL or commercial): it supports cell references, ranges,
 * numbers, + - * / and brackets, and SUM, AVERAGE, MIN, MAX and COUNT. A formula it cannot evaluate is marked "not
 * verified"; one whose value differs from what the table said is marked as a mismatch, with both values.
 */
import { colName, sheetsOf, xlsx, type Cell, type Sheet } from "./office.js"

export interface FormulaCheck {
  sheet: string
  cell: string
  formula: string
  state: "verified" | "mismatch" | "not verified"
  value?: number
  /** What the table said, when it said a number. */
  stated?: number
  detail?: string
}

const AGG: Array<[RegExp, string]> = [
  [/^(sub)?total\b|^sum\b/i, "SUM"],
  [/^(average|mean)\b/i, "AVERAGE"],
  [/^min(imum)?\b/i, "MIN"],
  [/^max(imum)?\b/i, "MAX"],
  [/^count\b/i, "COUNT"],
]

const ref = (s: string) => {
  const m = /^([A-Z]{1,3})(\d{1,7})$/.exec(s)
  if (!m) return undefined
  let c = 0
  for (const ch of m[1]!) c = c * 26 + (ch.charCodeAt(0) - 64)
  return { col: c - 1, row: Number(m[2]) - 1 }
}

/**
 * Evaluates the supported subset. `at(col, row)` gives a cell's number (a formula cell's value), or undefined for
 * one that is empty or text; throws for anything outside the subset.
 */
export function evaluate(formula: string, at: (col: number, row: number) => number | undefined): number {
  const src = formula.replace(/^=/, "").replace(/\s+/g, "")
  let i = 0
  const fail = (why: string): never => {
    throw new Error(why)
  }
  const range = (a: string, b: string): Array<number | undefined> => {
    const x = ref(a)
    const y = ref(b)
    if (!x || !y) fail(`${a}:${b} is not a range`)
    const out: Array<number | undefined> = []
    for (let r = Math.min(x!.row, y!.row); r <= Math.max(x!.row, y!.row); r++) for (let c = Math.min(x!.col, y!.col); c <= Math.max(x!.col, y!.col); c++) out.push(at(c, r))
    return out
  }
  const args = (): Array<number | undefined> => {
    const out: Array<number | undefined> = []
    if (src[i] === ")") return out
    for (;;) {
      const m = /^([A-Z]{1,3}\d{1,7}):([A-Z]{1,3}\d{1,7})/.exec(src.slice(i))
      if (m) {
        out.push(...range(m[1]!, m[2]!))
        i += m[0].length
      } else out.push(expr())
      if (src[i] === ",") i++
      else return out
    }
  }
  const primary = (): number => {
    if (src[i] === "(") {
      i++
      const v = expr()
      if (src[i++] !== ")") fail("a bracket is not closed")
      return v
    }
    if (src[i] === "-") {
      i++
      return -primary()
    }
    const num = /^\d+(\.\d+)?/.exec(src.slice(i))
    if (num) {
      i += num[0].length
      return Number(num[0])
    }
    const fn = /^([A-Z]+)\(/.exec(src.slice(i))
    if (fn) {
      i += fn[0].length
      const xs = args()
      if (src[i++] !== ")") fail("a bracket is not closed")
      const ns = xs.filter((x): x is number => typeof x === "number")
      switch (fn[1]) {
        case "SUM":
          return ns.reduce((a, b) => a + b, 0)
        case "AVERAGE":
          return ns.length ? ns.reduce((a, b) => a + b, 0) / ns.length : fail("AVERAGE of nothing")
        case "MIN":
          return ns.length ? Math.min(...ns) : 0
        case "MAX":
          return ns.length ? Math.max(...ns) : 0
        case "COUNT":
          return ns.length
        default:
          return fail(`${fn[1]} is not in the subset this check supports`)
      }
    }
    const r = /^[A-Z]{1,3}\d{1,7}/.exec(src.slice(i))
    if (r) {
      i += r[0].length
      const p = ref(r[0])!
      return at(p.col, p.row) ?? 0
    }
    return fail(`it cannot read "${src.slice(i, i + 12)}"`)
  }
  const term = (): number => {
    let v = primary()
    while (src[i] === "*" || src[i] === "/") {
      const op = src[i++]
      const w = primary()
      v = op === "*" ? v * w : w === 0 ? fail("it divides by zero") : v / w
    }
    return v
  }
  const expr = (): number => {
    let v = term()
    while (src[i] === "+" || src[i] === "-") {
      const op = src[i++]
      const w = term()
      v = op === "+" ? v + w : v - w
    }
    return v
  }
  const v = expr()
  if (i !== src.length) fail(`it cannot read "${src.slice(i, i + 12)}"`)
  return v
}

/** The number a cell holds, a formula's value included. */
const numberIn = (c: Cell | undefined): number | undefined => (typeof c === "number" ? c : c && typeof c === "object" ? c.value : undefined)

/**
 * Turns each total row's numbers into formulas over the numbers above it, checks every formula, and returns the sheet
 * and the checks. `offset` is how many rows come before the sheet's rows when written (the AI mark).
 */
export function formulaFirst(sheet: Sheet, offset = 0): { sheet: Sheet; checks: FormulaCheck[] } {
  const rows = sheet.rows.map((r) => [...r])
  const checks: FormulaCheck[] = []
  for (let r = 1; r < rows.length; r++) {
    const label = typeof rows[r]![0] === "string" ? (rows[r]![0] as string).trim() : ""
    const fn = AGG.find(([re]) => re.test(label))?.[1]
    if (!fn) continue
    // The block it covers: past the total rows just above it (a Total then an Average cover the same rows), the data
    // rows since the header or the last total before them.
    const isTotal = (x: Cell[] | undefined) => typeof x?.[0] === "string" && AGG.some(([re]) => re.test((x[0] as string).trim()))
    let bottom = r
    while (bottom > 1 && isTotal(rows[bottom - 1])) bottom--
    let top = bottom
    while (top > 1 && !isTotal(rows[top - 1])) top--
    if (top >= bottom) continue
    for (let c = 1; c < rows[r]!.length; c++) {
      const stated = rows[r]![c]
      if (typeof stated !== "number") continue
      const above = rows.slice(top, bottom).map((x) => x[c])
      if (!above.some((x) => numberIn(x) !== undefined)) continue
      const formula = `=${fn}(${colName(c)}${top + 1 + offset}:${colName(c)}${bottom + offset})`
      rows[r]![c] = { formula }
    }
  }
  // Every formula, those it made and any the table had, checked by the evaluator.
  for (let r = 0; r < rows.length; r++)
    for (let c = 0; c < rows[r]!.length; c++) {
      const cell = rows[r]![c]
      if (!cell || typeof cell !== "object") continue
      const name = `${colName(c)}${r + 1 + offset}`
      const stated = sheet.rows[r]?.[c]
      try {
        const value = evaluate(cell.formula, (cc, rr) => numberIn(rows[rr - offset]?.[cc]))
        const round = Math.round(value * 1e9) / 1e9
        rows[r]![c] = { formula: cell.formula, value: round }
        if (typeof stated === "number" && Math.abs(stated - round) > 1e-9 * Math.max(1, Math.abs(stated)))
          checks.push({ sheet: sheet.name, cell: name, formula: cell.formula, state: "mismatch", value: round, stated, detail: `the table said ${stated}; the formula gives ${round}` })
        else checks.push({ sheet: sheet.name, cell: name, formula: cell.formula, state: "verified", value: round })
      } catch (e) {
        checks.push({ sheet: sheet.name, cell: name, formula: cell.formula, state: "not verified", detail: (e as Error).message })
      }
    }
  return { sheet: { name: sheet.name, rows }, checks }
}

/** A sheet listing each formula and whether it was verified, for the workbook. */
export function checksSheet(checks: FormulaCheck[]): Sheet {
  return {
    name: "Formula checks",
    rows: [["Sheet", "Cell", "Formula", "Check", "Value", "Detail"], ...checks.map((k) => [k.sheet, k.cell, k.formula, k.state, k.value ?? "", k.detail ?? ""] as Cell[])],
  }
}

/** An export's workbook, formula-first: each table's totals as formulas, and a sheet of the checks when there are any. */
export function formulaWorkbook(title: string, markdown: string): { file: Buffer; checks: FormulaCheck[] } {
  const done = sheetsOf(markdown).map((s, i) => formulaFirst(s, i === 0 ? 1 : 0))
  const checks = done.flatMap((d) => d.checks)
  return { file: xlsx(title, [...done.map((d) => d.sheet), ...(checks.length ? [checksSheet(checks)] : [])]), checks }
}
