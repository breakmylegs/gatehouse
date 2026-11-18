// C-032: TypeScript's language service, in a worker with a memory cap. Diagnostics, what a name is, its definition and
// its references work on a real project; past the cap the worker ends, the question fails with a plain reason, and the
// next question starts a new worker.
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { TsService } from "../src/ts-service.js"

let dir: string
let svc: TsService
beforeAll(() => {
  dir = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), "gh-ts-")))
  fs.mkdirSync(path.join(dir, "src"))
  fs.writeFileSync(path.join(dir, "tsconfig.json"), JSON.stringify({ compilerOptions: { strict: true, target: "ES2022", module: "NodeNext", moduleResolution: "NodeNext", noEmit: true }, include: ["src"] }))
  fs.writeFileSync(path.join(dir, "src", "money.ts"), "/** Pence, as a whole number. */\nexport type Pence = number\nexport function total(items: Pence[]): Pence {\n  return items.reduce((a, b) => a + b, 0)\n}\n")
  fs.writeFileSync(path.join(dir, "src", "bill.ts"), 'import { total } from "./money.js"\nexport const sum = total([1, 2])\nexport const wrong: string = total([3])\n')
  svc = new TsService()
})
afterAll(async () => {
  await svc.close()
  fs.rmSync(dir, { recursive: true, force: true })
})

const bill = () => path.join(dir, "src", "bill.ts")
const at = (file: string, needle: string, nth = 0) => {
  const text = fs.readFileSync(file, "utf8")
  let i = -1
  for (let k = 0; k <= nth; k++) i = text.indexOf(needle, i + 1)
  return i
}

describe("the TypeScript language service (C-032)", () => {
  it("finds what is wrong in a file, says what a name is, and finds its definition and references", { timeout: 120_000 }, async () => {
    const diags = (await svc.ask("diagnostics", dir, bill())) as Array<{ line: number; message: string; severity: string }>
    expect(diags).toHaveLength(1)
    expect(diags[0]).toMatchObject({ line: 3, severity: "error" })
    expect(diags[0]!.message).toMatch(/not assignable to type 'string'/)
    const info = (await svc.ask("info", dir, bill(), at(bill(), "total", 1))) as { text: string }
    // An imported name reads "(alias) total(items: Pence[]): Pence".
    expect(info.text).toMatch(/total\(items: Pence\[\]\): Pence/)
    const def = (await svc.ask("definition", dir, bill(), at(bill(), "total", 1))) as Array<{ file: string; line: number }>
    expect(def.map((d) => [path.basename(d.file), d.line])).toEqual([["money.ts", 3]])
    const refs = (await svc.ask("references", dir, bill(), at(bill(), "total", 1))) as Array<{ file: string }>
    expect(refs.map((r) => path.basename(r.file)).sort()).toEqual(["bill.ts", "bill.ts", "bill.ts", "money.ts"])
  })

  it("ends a worker past its memory cap with a plain reason, and starts a new one at the next question", { timeout: 120_000 }, async () => {
    const tiny = new TsService({ memoryMb: 4 })
    try {
      await expect(tiny.ask("diagnostics", dir, bill())).rejects.toThrow(/language service stopped/)
      expect(tiny.restarts).toBe(1)
      await expect(tiny.ask("diagnostics", dir, bill())).rejects.toThrow(/language service stopped/)
      expect(tiny.restarts).toBe(2)
    } finally {
      await tiny.close()
    }
  })
})
