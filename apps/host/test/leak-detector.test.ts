// E-042: heap snapshots taken by a preload while a program works; a fixture that leaks on every request reports the
// constructor, and one that does not reports nothing.
import { execFile } from "node:child_process"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { afterAll, describe, expect, it } from "vitest"
import { findLeaks, growing, leakNodeOptions, leakSummary, type ConstructorSize, type LeakRun } from "../src/leak-detector.js"

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "codeh-leak-fixture-"))
afterAll(() => fs.rmSync(dir, { recursive: true, force: true }))

// A server-like program: each "request" keeps a LeakyRecord in a list held for the life of the process (as a cache
// that is never cleared would be), or (fine.js) lets it go.
const program = (keep: boolean) => `const kept = (globalThis.kept = [])
class LeakyRecord { constructor(i) { this.id = i; this.payload = new Array(200).fill(i) } }
let i = 0
function handle() { const r = new LeakyRecord(i++); ${keep ? "kept.push(r)" : "void r"} }
const t = setInterval(() => { for (let k = 0; k < 1500; k++) handle() }, 20)
setTimeout(() => { clearInterval(t) }, 2200)
`
fs.writeFileSync(path.join(dir, "leaky.js"), program(true))
fs.writeFileSync(path.join(dir, "fine.js"), program(false))

const run: LeakRun = (command, cwd, env) =>
  new Promise((resolve) => execFile(process.execPath, command.split(" ").slice(1), { cwd, env: { ...process.env, ...env } }, (e, out) => resolve({ ran: true, exitCode: e ? 1 : 0, output: String(out) })))

describe("the memory leak detector", () => {
  it("reports the constructor of what a fixture leaks on every request", { timeout: 120_000 }, async () => {
    const r = await findLeaks("node leaky.js", dir, run, { everyMs: 300, count: 5 })
    if ("notChecked" in r) throw new Error(r.notChecked)
    expect(r.snapshots).toBeGreaterThanOrEqual(3)
    expect(r.growth[0]?.name).toBe("LeakyRecord")
    expect(r.growth[0]!.counts.at(-1)!).toBeGreaterThan(r.growth[0]!.counts[0]!)
    expect(leakSummary("node leaky.js", r)).toMatch(/LeakyRecord: \d+ to \d+ objects/)
  })

  it("reports nothing for a fixture that lets go", { timeout: 120_000 }, async () => {
    const r = await findLeaks("node fine.js", dir, run, { everyMs: 300, count: 5 })
    if ("notChecked" in r) throw new Error(r.notChecked)
    expect(r.growth.map((g) => g.name)).not.toContain("LeakyRecord")
  })

  it("opens no inspector, and says why when there are too few snapshots", async () => {
    expect(leakNodeOptions("--inspect=9229 --max-old-space-size=256", "C:/t/p.cjs")).toBe('--max-old-space-size=256 --require "C:/t/p.cjs"')
    expect(await findLeaks("node x", dir, async () => ({ ran: true, exitCode: 0, output: "" }))).toMatchObject({ notChecked: expect.stringMatching(/only 0 snapshot/) })
  })

  it("counts growth only when it rises step by step and by enough", () => {
    const snap = (bytes: number) => new Map<string, ConstructorSize>([["A", { name: "A", count: bytes / 100, bytes }]])
    expect(growing([snap(1e6), snap(2e6), snap(3e6), snap(4e6)]).map((g) => g.name)).toEqual(["A"])
    expect(growing([snap(1e6), snap(5e6), snap(1e6), snap(5e6)])).toEqual([])
    expect(growing([snap(1000), snap(2000), snap(3000)])).toEqual([])
    expect(growing([snap(1e6), snap(2e6)])).toEqual([])
  })
})
