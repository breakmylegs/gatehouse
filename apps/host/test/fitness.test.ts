// D-045, fitness functions: each owner-set check fails when its threshold is breached (file length, coupling,
// dependency count, a forbidden API) and passes otherwise; a breach fails the gate, and a goal run that says it is done
// is told as not done.
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { afterAll, describe, expect, it } from "vitest"
import { noteFor } from "../src/carry-on.js"
import { fitnessCheck } from "../src/fitness.js"

const root = fs.mkdtempSync(path.join(os.tmpdir(), "gh-fit-"))
afterAll(() => fs.rmSync(root, { recursive: true, force: true }))
const put = (rel: string, text: string) => {
  fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true })
  fs.writeFileSync(path.join(root, rel), text)
}
const FILES = ["src/a/big.ts", "src/a/x.ts", "src/b/y.ts", "src/c/z.ts", "src/a/e.ts"]

describe("fitness functions (D-045)", () => {
  it("fails each breached threshold, and passes when they are met", async () => {
    put("package.json", JSON.stringify({ dependencies: { a: "1", b: "1" }, devDependencies: { c: "1" } }))
    put("src/a/big.ts", Array.from({ length: 12 }, (_, i) => `export const v${i} = ${i}`).join("\n"))
    put("src/a/x.ts", "import { y } from '../b/y'\nimport { z } from '../c/z'\nexport const x = y + z\n")
    put("src/b/y.ts", "export const y = 1\n")
    put("src/c/z.ts", "export const z = 2\n")
    put("src/a/e.ts", "export const run = (s) => eval(s)\n")
    put(".codehouse/fitness.yml", 'maxFileLines: 10\nmaxFanOut: 1\nmaxDependencies: 2\nforbiddenApis:\n  - { pattern: "\\\\beval\\\\(", files: "src/**", reason: "no eval" }\n')
    const r = (await fitnessCheck(root, FILES))!
    expect(r.checks.map((c) => [c.id, c.ok])).toEqual([
      ["maxFileLines", false],
      ["maxFanOut", false],
      ["maxDependencies", false],
      ["forbiddenApis.0", false],
    ])
    expect(r.failed).toBe(4)
    expect(r.checks[0]!.detail).toContain("src/a/big.ts (12)")
    expect(r.checks[3]!.detail).toContain("src/a/e.ts:1")
    put(".codehouse/fitness.yml", "maxFileLines: 50\nmaxFanOut: 2\nmaxDependencies: 3\n")
    expect((await fitnessCheck(root, FILES))!.failed).toBe(0)
  })

  it("checks nothing without settings, says why when they do not parse, and tells a goal run it is not done", async () => {
    const bare = fs.mkdtempSync(path.join(os.tmpdir(), "gh-fit2-"))
    try {
      expect(await fitnessCheck(bare, [])).toBeUndefined()
      fs.mkdirSync(path.join(bare, ".codehouse"))
      fs.writeFileSync(path.join(bare, ".codehouse", "fitness.yml"), "maxFileLines: [")
      expect((await fitnessCheck(bare, []))!.problem).toMatch(/not valid YAML/)
    } finally {
      fs.rmSync(bare, { recursive: true, force: true })
    }
    expect(noteFor("carry_on_end", { why: "fitness", turns: 3, fitness: "Longest source file: limit 10" })).toEqual({
      title: "Not done: a fitness check fails",
      body: "Claude said it was done after 3 automatic turns, but Longest source file: limit 10. Look in Codehouse.",
    })
  })
})
