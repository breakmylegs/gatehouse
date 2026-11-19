// D-068: dead code with evidence. In a fixture project, unreferenced code is listed with what names it and what the
// coverage report says, code only tests use is kept apart, entry points and live code are left alone, and removal is
// proposed a file or a few names at a time.
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { deadCode, readCoverage } from "../src/dead-code.js"

let root: string
const files: Record<string, string> = {
  "package.json": JSON.stringify({ name: "fixture", main: "./src/index.ts", scripts: { tool: "tsx src/tools/report.ts" } }),
  "src/index.ts": 'import { used } from "./used.js"\nimport "./many.js"\nexport const start = used()\n',
  "src/many.ts": [1, 2, 3, 4, 5, 6].map((n) => `export const spare${n} = ${n}`).join("\n"),
  "src/used.ts": [
    "export function used() { return 1 }",
    "export function unusedFn() { return 2 }",
    "export function onlyTested() { return 3 }",
    "export function localHelper() { return 4 }",
    "const x = localHelper()",
    "export { x as renamedButUnused }",
    "",
  ].join("\n"),
  "src/orphan.ts": "export const orphanThing = 5\n",
  "src/lazy.ts": "export const lazy = 6\n",
  "src/loader.ts": 'import { start } from "./index.js"\nexport const load = async () => (await import("./lazy.js")).lazy\nexport default start\n',
  "src/tools/report.ts": "export const reportTool = 7\n",
  "test/used.test.ts": 'import { onlyTested } from "../src/used.js"\nonlyTested()\n',
  "node_modules/dep/index.ts": "export const fromDependency = 8\n",
}

beforeAll(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "gh-dead-"))
  for (const [rel, text] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true })
    fs.writeFileSync(path.join(root, rel), text)
  }
  // Istanbul's report, as Vitest writes it: absolute paths, calls per function.
  const used = path.join(root, "src", "used.ts")
  const fn = (name: string, line: number) => ({ name, loc: { start: { line, column: 0 }, end: { line, column: 1 } } })
  fs.mkdirSync(path.join(root, "coverage"))
  fs.writeFileSync(
    path.join(root, "coverage", "coverage-final.json"),
    JSON.stringify({ [used]: { path: used, fnMap: { 0: fn("used", 1), 1: fn("unusedFn", 2), 2: fn("onlyTested", 3), 3: fn("localHelper", 4) }, f: { 0: 4, 1: 0, 2: 2, 3: 1 }, s: { 0: 1 } } }),
  )
})
afterAll(() => fs.rmSync(root, { recursive: true, force: true }))

describe("dead code with evidence (D-068)", () => {
  it("lists unreferenced code with its static and coverage evidence, and keeps tests-only code apart", () => {
    const r = deadCode(root, Object.keys(files))
    const by = Object.fromEntries(r.names.map((n) => [n.name, n]))
    expect(Object.keys(by).sort()).toEqual(["onlyTested", "renamedButUnused", "spare1", "spare2", "spare3", "spare4", "spare5", "spare6", "unusedFn"])
    expect(by.unusedFn).toMatchObject({ why: "unreferenced", file: "src/used.ts", line: 2, coverage: { state: "never run", calls: 0 } })
    expect(by.unusedFn!.evidence).toMatch(/No other file names it/)
    expect(r.files.find((f) => f.file === "src/orphan.ts")).toMatchObject({ coverage: { state: "not in the report" } })
    expect(by.onlyTested).toMatchObject({ why: "tests-only", coverage: { state: "run", calls: 2 } })
    expect(by.onlyTested!.evidence).toContain("test/used.test.ts")
    // The strongest case first: nothing names it and the tests never run it.
    expect(r.names[0]!.name).toBe("unusedFn")
    expect(r.coverage).toMatchObject({ report: "coverage/coverage-final.json", ageDays: 0 })
  })

  it("leaves entry points, dynamic imports, dependencies and live code alone", () => {
    const r = deadCode(root, Object.keys(files))
    expect(r.files.map((f) => f.file)).toEqual(["src/loader.ts", "src/orphan.ts"])
    const names = r.names.map((n) => n.name)
    for (const live of ["used", "localHelper", "start", "lazy", "reportTool", "fromDependency", "orphanThing", "load"]) expect(names).not.toContain(live)
  })

  it("proposes removal in small slices, each with its evidence and the tests to run", () => {
    const r = deadCode(root, Object.keys(files))
    expect(r.slices.map((s) => s.title)).toEqual([
      "Remove src/loader.ts",
      "Remove src/orphan.ts",
      "Remove unusedFn, renamedButUnused from src/used.ts",
      "Remove spare1, spare2, spare3, spare4, spare5 from src/many.ts",
      "Remove spare6 from src/many.ts",
    ])
    for (const s of r.slices) {
      expect(s.names.length).toBeLessThanOrEqual(5)
      expect(s.prompt).toMatch(/run the tests/)
    }
    expect(r.slices.find((s) => s.names.includes("onlyTested"))).toBeUndefined()
  })

  it("reads lcov.info as well, and says when there is no report", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "gh-dead-lcov-"))
    try {
      expect(readCoverage(dir)).toBeUndefined()
      fs.mkdirSync(path.join(dir, "coverage"))
      fs.writeFileSync(path.join(dir, "coverage", "lcov.info"), "SF:src/a.ts\nFN:3,never\nFN:7,often\nFNDA:0,never\nFNDA:9,often\nDA:7,9\nend_of_record\n")
      const c = readCoverage(dir)!
      expect(c.files.get("src/a.ts")).toMatchObject({ ran: true, fns: [{ name: "never", line: 3, calls: 0 }, { name: "often", line: 7, calls: 9 }] })
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })
})
