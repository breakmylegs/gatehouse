// Codehouse's temporary leftovers (owner, 1 Nov: the disk filled with them): only Codehouse's own, only when old enough to be
// out of use, and Settings can see and clear them.
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import Fastify from "fastify"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import {
  clearTemp,
  IN_USE_MS,
  registerHousekeepingRoutes,
  tempLeftovers,
} from "../src/housekeeping.js"
import { composeInstructions } from "../src/projects.js"

let tmp: string
const make = (name: string, ageMs: number, bytes = 1000) => {
  const dir = path.join(tmp, name)
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(path.join(dir, "f.bin"), Buffer.alloc(bytes))
  const t = (Date.now() - ageMs) / 1000
  fs.utimesSync(dir, t, t)
  return dir
}

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "hk-test-"))
})
afterEach(() => fs.rmSync(tmp, { recursive: true, force: true }))

describe("temporary leftovers", () => {
  it("finds only Codehouse's own, with their sizes", () => {
    make("codeh-shots-aaa", 0, 2048)
    make("gh-policy-bbb", 0, 10)
    make("someone-elses", 0, 5000)
    const found = tempLeftovers(tmp)
    expect(found.map((l) => path.basename(l.path)).sort()).toEqual([
      "codeh-shots-aaa",
      "gh-policy-bbb",
    ])
    expect(found.find((l) => l.path.endsWith("codeh-shots-aaa"))?.bytes).toBe(2048)
  })

  it("clears the old ones and never one that may still be in use or another program's", () => {
    make("codeh-shots-old", 2 * 60 * 60_000)
    make("gh-index-old", 2 * 60 * 60_000)
    make("codeh-perf-new", 60_000)
    make("someone-elses", 5 * 60 * 60_000)
    const r = clearTemp(60 * 60_000, tmp)
    expect(r).toMatchObject({ removed: 2, left: 1 })
    expect(fs.readdirSync(tmp).sort()).toEqual(["codeh-perf-new", "someone-elses"])
    // Even asked to clear everything, one younger than the in-use time stays.
    expect(clearTemp(0, tmp).removed).toBe(0)
    expect(IN_USE_MS).toBeGreaterThanOrEqual(10 * 60_000)
  })

  it("lets Settings see them and clear them, and records the clearing", async () => {
    make("codeh-sandbox-old", 2 * 60 * 60_000, 4096)
    const records: Array<Record<string, unknown>> = []
    const app = Fastify()
    registerHousekeepingRoutes(app, {
      tempDir: tmp,
      audit: { record: async (e: Record<string, unknown>) => (records.push(e), true) } as never,
    })
    expect((await app.inject({ method: "GET", url: "/api/housekeeping/temp" })).json()).toEqual({
      items: 1,
      bytes: 4096,
    })
    const cleared = (
      await app.inject({ method: "POST", url: "/api/housekeeping/temp/clear" })
    ).json()
    expect(cleared).toMatchObject({ removed: 1, bytes: 4096, left: 0 })
    expect(records[0]).toMatchObject({ event: "temp_cleared" })
    await app.close()
  })

  it("asks every coding session to tidy up after itself, and not a chat", () => {
    expect(composeInstructions({ tidy: true })).toContain(
      "delete temporary files and folders you create",
    )
    expect(composeInstructions({ tidy: false })).toBe("")
  })
})
