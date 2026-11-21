// D-067: a migration in waves from the files' own imports, leaves first; a wave is done only with its behaviour captured
// before and compared after.
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { importsWithin, MigrationStore, planMigration, sourcesIn, waveState, wavePrompt, wavesOf } from "../src/migration.js"

let root: string
let data: string
const write = (rel: string, text: string) => {
  fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true })
  fs.writeFileSync(path.join(root, rel), text)
}
beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "gh-migrate-"))
  data = fs.mkdtempSync(path.join(os.tmpdir(), "gh-migrate-data-"))
  write("src/util.js", "export function add(a, b) { return a + b }\n")
  write("src/price.js", 'import { add } from "./util.js"\nexport function price(n) { return add(n, 1) }\n')
  write("src/cart/index.ts", 'import { price } from "../price"\nexport const total = (xs: number[]) => xs.map(price)\n')
  write("src/a.js", 'const b = require("./b")\nmodule.exports = { a: 1 }\n')
  write("src/b.js", 'const a = require("./a")\nmodule.exports = { b: 2 }\n')
  write("src/app.js", 'import "./cart/index.ts"\nimport { a } from "./a.js"\nconsole.log(a)\n')
  write("src/price.test.js", 'import { price } from "./price.js"\n')
  write("node_modules/x/index.js", "export const x = 1\n")
})
afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true })
  fs.rmSync(data, { recursive: true, force: true })
})

describe("the migration planner", () => {
  it("reads relative imports, with or without extensions and index files", () => {
    const set = new Set(["src/util.js", "src/price.js", "src/cart/index.ts"])
    expect(importsWithin("src/cart/index.ts", 'import { price } from "../price"', set)).toEqual(["src/price.js"])
    expect(importsWithin("src/app.js", 'export * from "./cart"\nimport x from "left-pad"', set)).toEqual(["src/cart/index.ts"])
  })

  it("splits the source files into waves, leaves first, a cycle in one wave, tests and node_modules left out", () => {
    const files = sourcesIn(root, "src")
    expect(files).toEqual(["src/a.js", "src/app.js", "src/b.js", "src/cart/index.ts", "src/price.js", "src/util.js"])
    expect(wavesOf(files.map((file) => ({ file, text: fs.readFileSync(path.join(root, file), "utf8") })))).toEqual([
      ["src/util.js"],
      ["src/price.js"],
      ["src/cart/index.ts"],
      ["src/a.js", "src/b.js"],
      ["src/app.js"],
    ])
  })

  it("counts a wave done only when each callable file was captured before and compared after", async () => {
    const plan = await planMigration({ root, goal: "Move to ES modules", files: sourcesIn(root, "src"), callable: async (_f, t) => /export (function|const)/.test(t) })
    const store = new MigrationStore(data)
    await store.save(plan)
    const w1 = plan.waves[0]!
    expect(waveState(w1)).toEqual({ toCapture: ["src/util.js"], toCompare: [], done: false, changed: 0 })
    await expect(store.compared(plan, "src/util.js", [])).rejects.toThrow(/Capture src\/util\.js before its wave first/)
    await store.captured(plan, "src/util.js", { v: 1, file: "src/util.js", createdAt: "2026-11-21T10:00:00.000Z", from: "now", cases: [{ fn: "add", args: [1, 2], out: { value: 3 } }] })
    expect(waveState(w1)).toMatchObject({ toCapture: [], toCompare: ["src/util.js"], done: false })
    await store.compared(plan, "src/util.js", [{ fn: "add", args: [1, 2], before: { value: 3 }, now: { value: 4 }, words: 'add(1, 2) returned 3 before, and now returned 4.' }])
    expect(waveState(w1)).toEqual({ toCapture: [], toCompare: [], done: true, changed: 1 })
    expect(store.capture(plan, "src/util.js").cases).toHaveLength(1)
    // A wave whose files export nothing callable needs no capture; the project's tests cover it.
    expect(waveState(plan.waves.find((w) => w.files.some((f) => f.file === "src/app.js"))!).done).toBe(true)
    // Kept, and read back.
    expect(new MigrationStore(data).get(plan.id).waves[0]!.files[0]).toMatchObject({ file: "src/util.js", compared: expect.any(String) })
    // Capturing again starts the comparison over.
    await store.captured(plan, "src/util.js", store.capture(plan, "src/util.js"))
    expect(waveState(w1).done).toBe(false)
  })

  it("asks Claude for one wave and its files only", async () => {
    const plan = await planMigration({ root, goal: "Move to ES modules", files: sourcesIn(root, "src"), callable: async () => true })
    expect(wavePrompt(plan, 4)).toBe(
      "Migration: Move to ES modules\nDo wave 4 of 5 only. Change these files and no others:\n- src/a.js\n- src/b.js\nKeep what each exported function returns the same unless the migration needs it to change, and say so where it does. Their behaviour was captured before this wave and is compared after it.",
    )
    expect(() => wavePrompt(plan, 9)).toThrow(/no wave 9/)
    expect(() => new MigrationStore(data).get("../evil")).toThrow(/not a migration plan/)
  })
})
