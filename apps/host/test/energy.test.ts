// E-090: a fixture CPU time gives the expected estimate; the models' energy is "not known" by default; all of it is
// labelled as an estimate.
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import { GatehouseConfig } from "@gatehouse/shared/node"
import { cpuSecondsOf, DEFAULT_DEVICE_WATTS, EnergyLog, estimate, NOT_KNOWN } from "../src/energy.js"

const dirs: string[] = []
afterEach(() => {
  for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true })
})

describe("energy and carbon estimate", () => {
  it("turns a fixture CPU time into the expected estimate", () => {
    // Two hours of one core on an 8-core machine drawing 40 W at full load: 7200 / 8 * 40 / 3600 = 10 Wh.
    const e = estimate({ cpuSeconds: 7200, cores: 8, config: { deviceWatts: 40 } })
    expect(e).toMatchObject({ label: "estimate", cpuSeconds: 7200, localWh: 10 })
    expect(e.basis).toMatch(/7200 CPU seconds over 8 core\(s\), at 40 W .*\(your figure\)/)
    // With no figure set, a typical laptop's.
    expect(estimate({ cpuSeconds: 3600, cores: 1 }).localWh).toBe(DEFAULT_DEVICE_WATTS)
    // A usage sample: 25% of an 8-core machine for 5 seconds is 10 CPU seconds.
    expect(cpuSecondsOf(25, 5, 8)).toBe(10)
  })

  it("says the models' energy and the carbon are not known until you give figures", () => {
    const e = estimate({ cpuSeconds: 7200, cores: 8, tokens: 500_000 })
    expect(e.modelWh).toBe(NOT_KNOWN)
    expect(e.carbonGrams).toBe(NOT_KNOWN)
    expect(e.basis).toMatch(/models' energy is not known/)
    const known = estimate({ cpuSeconds: 7200, cores: 8, tokens: 500_000, config: { deviceWatts: 40, modelWhPer1kTokens: 0.2, gridGramsPerKwh: 200 } })
    expect(known).toMatchObject({ localWh: 10, modelWh: 100, carbonGrams: 22 })
  })

  it("takes its figures, and E-066's retention days, as settings", () => {
    expect(GatehouseConfig.safeParse({ energy: { deviceWatts: 40, gridGramsPerKwh: 180 }, retention: { restricted: { evidence: 30 } } }).success).toBe(true)
    expect(GatehouseConfig.safeParse({ energy: { deviceWatts: -1 } }).success).toBe(false)
    expect(GatehouseConfig.safeParse({ retention: { secret: { logs: 1 } } }).success).toBe(false)
  })

  it("keeps CPU time per project and day", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "codeh-energy-"))
    dirs.push(dir)
    const file = path.join(dir, "energy.json")
    let t = new Date(2026, 10, 20, 10)
    const log = new EnergyLog(file, () => t)
    log.add("shop", 10)
    log.add("shop", 5)
    log.add("blog", 2)
    t = new Date(2026, 10, 21, 10)
    log.add("shop", 100)
    log.add("shop", -4)
    await log.flush()
    const again = new EnergyLog(file)
    expect(again.cpuSeconds("shop")).toBe(115)
    expect(again.cpuSeconds("shop", "2026-11-21")).toBe(100)
    expect(again.cpuSeconds()).toBe(117)
  })
})
