import fs from "node:fs"
import path from "node:path"
import { describe, expect, it } from "vitest"

const ROOT = path.resolve(import.meta.dirname, "../../..")
const doc = fs.readFileSync(path.join(ROOT, "docs", "threat-model.md"), "utf8")

/** Rows of the threats table: | T1 | threat | what stops it | tests | */
const rows = doc
  .split("\n")
  .filter((l) => /^\| T\d+ \|/.test(l))
  .map((l) => {
    const cells = l.split(/(?<!\\)\|/).map((c) => c.trim())
    return { id: cells[1]!, threat: cells[2]!, tests: cells[4]! }
  })

const REF = /`([^`]+\.test\.tsx?)`\s*::\s*"([^"]+)"/g
const refs = (cell: string) => [...cell.matchAll(REF)].map((m) => ({ file: m[1]!, title: m[2]! }))

describe("docs/threat-model.md has a real test behind every threat", () => {
  it("lists the threats the spec names, with consecutive ids (so a deleted row is noticed)", () => {
    expect(rows.length).toBeGreaterThanOrEqual(24)
    expect(rows.map((r) => r.id)).toEqual(rows.map((_, i) => `T${i + 1}`))
    const text = rows.map((r) => r.threat.toLowerCase()).join("\n")
    for (const needle of [
      "another web page probes",
      "dns rebinding",
      "evaluator is killed",
      "relay returns modified data",
      "chained commands",
      "secrets reached through any tool",
      "edits before allowing",
    ])
      expect(text, needle).toContain(needle)
  })

  it("gives every threat at least one test reference", () => {
    for (const r of rows) expect(refs(r.tests).length, `${r.id} ${r.threat}`).toBeGreaterThan(0)
  })

  it("points only at test files that exist and tests that are really in them", () => {
    let checked = 0
    for (const r of rows)
      for (const { file, title } of refs(r.tests)) {
        const p = path.join(ROOT, file)
        expect(fs.existsSync(p), `${r.id}: ${file} does not exist`).toBe(true)
        const text = fs.readFileSync(p, "utf8")
        const inCall = new RegExp(
          `(it|test|describe)(\\.each\\([^)]*\\))?\\(\\s*["\`']${title.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}["\`']`,
        )
        expect(inCall.test(text), `${r.id}: no test titled "${title}" in ${file}`).toBe(true)
        checked++
      }
    // Floor the corpus: a parser that finds nothing must not pass.
    expect(checked).toBeGreaterThanOrEqual(60)
  })

  it("does not use an em dash or an en dash", () => {
    expect(doc).not.toMatch(new RegExp(`[${String.fromCharCode(0x2013, 0x2014)}]`))
  })
})
