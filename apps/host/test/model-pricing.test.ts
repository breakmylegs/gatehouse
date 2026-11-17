// T-128: your own price for a model works its cost out from its tokens, one model can be counted as another, and only
// the report changes; with no prices the report is as recorded.
import { describe, expect, it } from "vitest"
import { applyPricing, priced } from "../src/model-pricing.js"
import type { UsageReport, UsageTotals } from "../src/usage.js"

const t = (o: Partial<UsageTotals>): UsageTotals => ({
  costUsd: 0,
  inputTokens: 0,
  outputTokens: 0,
  cacheReadTokens: 0,
  cacheCreationTokens: 0,
  turns: 1,
  durationMs: 0,
  results: 1,
  ...o,
})

const report = (): UsageReport => ({
  from: "2026-11-17",
  to: "2026-11-17",
  daysWithoutCells: {},
  days: {
    "2026-11-17": {
      s1: {
        project: "shop",
        total: t({ costUsd: 1.5, inputTokens: 3_000_000, outputTokens: 100_000 }),
        models: {
          "gateway/llama": t({ costUsd: 0, inputTokens: 2_000_000, outputTokens: 100_000 }),
          "claude-opus-5-5": t({ costUsd: 1.5, inputTokens: 1_000_000 }),
        },
      },
    },
  },
})

describe("prices of your own (T-128)", () => {
  it("works a model's cost out from its tokens, and the session's total with it", () => {
    const r = applyPricing(report(), [{ model: "gateway/llama", inputPerM: 0.5, outputPerM: 2 }])
    const cell = r.days["2026-11-17"]!.s1!
    expect(cell.models["gateway/llama"]!.costUsd).toBeCloseTo(1.2)
    expect(cell.models["claude-opus-5-5"]!.costUsd).toBe(1.5)
    expect(cell.total.costUsd).toBeCloseTo(2.7)
  })

  it("counts one model as another, adding its figures, and leaves the report alone without prices", () => {
    const r = applyPricing(report(), [{ model: "gateway/llama", countAs: "claude-opus-5-5" }])
    const models = r.days["2026-11-17"]!.s1!.models
    expect(Object.keys(models)).toEqual(["claude-opus-5-5"])
    expect(models["claude-opus-5-5"]!.inputTokens).toBe(3_000_000)
    expect(models["claude-opus-5-5"]!.turns).toBe(2)
    const before = report()
    expect(applyPricing(before, undefined)).toBe(before)
    expect(applyPricing(before, [])).toBe(before)
  })

  it("prices nothing when a price names no rate", () => {
    expect(priced(t({ inputTokens: 5 }), { model: "x" })).toBeUndefined()
    expect(priced(t({ cacheReadTokens: 1_000_000 }), { model: "x", cacheReadPerM: 0.3 })).toBeCloseTo(0.3)
  })
})
