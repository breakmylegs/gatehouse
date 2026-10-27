import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { describe, expect, it } from "vitest"
import { localDay, UsageStore } from "../src/usage.js"

const result = (cost: number, tokens = 10) => ({
  total_cost_usd: cost,
  num_turns: 1,
  usage: { input_tokens: tokens, output_tokens: tokens },
})

describe("usage by day", () => {
  it("adds each result to the local day it arrived on, as a change from the session's cumulative cost", () => {
    let now = new Date(2026, 9, 26, 23, 59)
    const u = new UsageStore(undefined, () => now)
    u.record("s1", "p", result(0.1))
    u.record("s1", "p", result(0.25))
    now = new Date(2026, 9, 27, 0, 1)
    u.record("s1", "p", result(0.3))
    const snap = u.snapshot()
    expect(Object.keys(snap.byDay).sort()).toEqual(["2026-10-26", "2026-10-27"])
    expect(snap.byDay["2026-10-26"]!.costUsd).toBeCloseTo(0.25)
    expect(snap.byDay["2026-10-27"]!.costUsd).toBeCloseTo(0.05)
    expect(snap.byDay["2026-10-26"]!.inputTokens).toBe(20)
    expect(snap.total.costUsd).toBeCloseTo(0.3)
  })

  it("formats the local day with zero padding", () => {
    expect(localDay(new Date(2026, 0, 5, 3))).toBe("2026-01-05")
  })

  it("loads a usage file written before days were kept", async () => {
    const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "gh-usage-")), "usage.json")
    const old = {
      total: {
        costUsd: 1,
        inputTokens: 1,
        outputTokens: 1,
        cacheReadTokens: 0,
        cacheCreationTokens: 0,
        turns: 1,
        durationMs: 0,
        results: 1,
      },
      bySession: {},
      byProject: {},
      byModel: {},
    }
    fs.writeFileSync(file, JSON.stringify(old))
    const u = new UsageStore(file, () => new Date(2026, 9, 27, 12))
    expect(u.snapshot().byDay).toEqual({})
    u.record("s", "p", result(0.5))
    await u.flush()
    expect(Object.keys(JSON.parse(fs.readFileSync(file, "utf8")).byDay)).toEqual(["2026-10-27"])
  })
})
