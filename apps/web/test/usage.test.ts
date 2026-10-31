import { describe, expect, it } from "vitest"
import {
  daysBetween,
  niceTicks,
  rangeFor,
  startedAt,
  summarise,
  type Report,
} from "../src/lib/usage"

const t = (costUsd: number, turns = 1, inputTokens = 10, outputTokens = 100) => ({
  costUsd,
  inputTokens,
  outputTokens,
  turns,
})
const report: Report = {
  from: "2026-10-28",
  to: "2026-10-30",
  splitSince: "2026-10-30",
  days: {
    "2026-10-30": {
      a: { project: "shop", total: t(3, 2), models: { opus: t(2.5, 0), haiku: t(0.5, 0) } },
      b: { project: "blog", total: t(1), models: { opus: t(1, 0) } },
    },
  },
  // Kept before 30 Oct as daily totals only.
  daysWithoutCells: { "2026-10-28": t(4, 3) },
}

describe("the Usage page's sums", () => {
  it("adds up everything in the range, by day, project, model and session", () => {
    const s = summarise(report)
    expect(s.total).toEqual({ costUsd: 8, inputTokens: 30, outputTokens: 300, turns: 6 })
    expect(s.byDay.map((d) => [d.key, d.costUsd])).toEqual([
      ["2026-10-28", 4],
      ["2026-10-29", 0],
      ["2026-10-30", 4],
    ])
    expect(s.byProject.map((p) => [p.key, p.costUsd])).toEqual([
      ["shop", 3],
      ["blog", 1],
    ])
    expect(s.byModel.map((m) => [m.key, m.costUsd])).toEqual([
      ["opus", 3.5],
      ["haiku", 0.5],
    ])
    expect(s.bySession[0]).toMatchObject({ key: "a", project: "shop", costUsd: 3 })
    expect(s.unsplitDays).toBe(1)
  })

  it("cuts by project, session or model, leaving out days it cannot split", () => {
    expect(summarise(report, { project: "blog" }).total.costUsd).toBe(1)
    expect(summarise(report, { session: "a" }).byModel.map((m) => m.key)).toEqual(["opus", "haiku"])
    const opus = summarise(report, { model: "opus" })
    expect(opus.total.costUsd).toBe(3.5)
    expect(opus.byModel.map((m) => m.key)).toEqual(["opus"])
    // Turns are not kept by model.
    expect(opus.turnsKnown).toBe(false)
    expect(opus.byDay[0]?.costUsd).toBe(0)
  })

  it("reads ranges, session start times and axis steps", () => {
    expect(daysBetween("2026-10-30", "2026-11-02")).toEqual([
      "2026-10-30",
      "2026-10-31",
      "2026-11-01",
      "2026-11-02",
    ])
    expect(rangeFor(7, new Date(2026, 9, 30, 15))).toEqual({ from: "2026-10-24", to: "2026-10-30" })
    expect(startedAt("019a3b2c-1d00-7abc-8000-000000000000")?.getTime()).toBe(0x019a3b2c1d00)
    expect(startedAt("not-a-uuid")).toBeUndefined()
    expect(niceTicks(45.48)).toEqual([0, 20, 40, 60])
    expect(niceTicks(0.6)).toEqual([0, 0.2, 0.4, 0.6])
    expect(niceTicks(0)).toEqual([0])
  })
})
