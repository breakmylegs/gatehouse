// E-063: the exported totals for a fixture day are right, the log can be deleted, and nothing in it leaves the machine.
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import { EffortLog } from "../src/effort-log.js"

const dirs: string[] = []
afterEach(() => {
  for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true })
})
const tmpFile = () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "codeh-effort-"))
  dirs.push(d)
  return path.join(d, "effort.json")
}

/** A fixture day: 10:00 to 10:03 active in shop, two turns in shop (one session), one in blog. */
function fixture(file?: string) {
  let t = new Date(2026, 10, 20, 10, 0, 5).getTime()
  const log = new EffortLog(file, () => new Date(t))
  log.active("shop")
  t += 20_000
  log.active("shop") // the same minute: not counted again
  t += 40_000
  log.active("shop")
  t += 60_000
  log.active("shop")
  log.turn("s1", "shop", { duration_ms: 90_000, total_cost_usd: 0.5 })
  log.turn("s1", "shop", { duration_ms: 30_000, total_cost_usd: 1.25 }) // cumulative: adds 0.75
  log.turn("s2", "=blog", { duration_ms: 60_000, total_cost_usd: 2 })
  return { log }
}

describe("effort and billing log", () => {
  it("exports the right totals for a fixture day", () => {
    const { log } = fixture()
    const rows = log.csv().trim().split("\r\n")
    expect(rows[0]).toBe("date,project,human_minutes,agent_minutes,cost_usd")
    // A project name that would start a formula in a spreadsheet is made plain text.
    expect(rows).toContain("2026-11-20,'=blog,0.0,1.0,2.00")
    expect(rows).toContain("2026-11-20,shop,3.0,2.0,1.25")
    expect(rows.at(-1)).toBe("total,,3.0,3.0,3.25")
    expect(log.csv({ project: "shop" }).trim().split("\r\n").at(-1)).toBe("total,shop,3.0,2.0,1.25")
    expect(log.csv({ from: "2026-11-21" }).trim().split("\r\n")).toEqual(["date,project,human_minutes,agent_minutes,cost_usd", "total,,0.0,0.0,0.00"])
  })

  it("keeps the log in its own file, reads it back, and deletes a project's records or all of them", async () => {
    const file = tmpFile()
    const { log } = fixture(file)
    await log.flush()
    const again = new EffortLog(file)
    expect(again.csv()).toBe(log.csv())
    expect(await again.delete("shop")).toBe(1)
    expect(new EffortLog(file).csv()).not.toMatch(/shop/)
    expect(await again.delete()).toBe(1)
    expect(new EffortLog(file).csv().trim().split("\r\n")).toHaveLength(2)
  })

  it("sends nothing anywhere: the log reaches no network and writes only its own file", () => {
    const src = fs.readFileSync(path.resolve(import.meta.dirname, "../src/effort-log.ts"), "utf8")
    const imports = [...src.matchAll(/from "([^"]+)"/g)].map((m) => m[1])
    expect(imports.sort()).toEqual(["./usage.js", "@gatehouse/shared/node", "node:fs", "node:path"])
    expect(src).not.toMatch(/\bfetch\(|XMLHttpRequest|WebSocket|require\(/)
    // usage.js, which it borrows the day from, reaches no network either.
    const usage = fs.readFileSync(path.resolve(import.meta.dirname, "../src/usage.ts"), "utf8")
    expect([...usage.matchAll(/from "([^"]+)"/g)].map((m) => m[1]).filter((m) => /http|net|undici|ws|dgram|tls/.test(m!))).toEqual([])
  })
})
