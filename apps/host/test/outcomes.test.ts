// D-076 and D-100: the cost of an accepted change includes its rework (spend on undone work, failed test runs and
// sessions that changed nothing), and an estimate gives a range with its sample size, or says there is too little.
import { describe, expect, it } from "vitest"
import { estimateFrom, measuredTime, MIN_SAMPLES, outcomes } from "../src/outcomes.js"
import type { UsageReport, UsageTotals } from "../src/usage.js"

const totals = (costUsd: number, durationMs = 0): UsageTotals => ({ costUsd, durationMs, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0, turns: 1, results: 1 })
const cell = (project: string, costUsd: number, durationMs = 0) => ({ project, total: totals(costUsd, durationMs), models: {} })
const rec = (session: string, event: string, input: unknown = {}, project?: string) => ({ session, event, inputJson: JSON.stringify(input), ...(project ? { project } : {}) })

describe("cost per outcome (D-076)", () => {
  it("counts everything spent in the project, rework and changeless sessions included, over the accepted changes", () => {
    const report: UsageReport = {
      from: "2026-11-01",
      to: "2026-11-02",
      days: {
        "2026-11-01": { s1: cell("shop", 2), s2: cell("shop", 1) },
        "2026-11-02": { s1: cell("shop", 1) },
      },
      daysWithoutCells: {},
    }
    const records = [
      rec("s1", "commit_lineage_noted"),
      rec("s1", "change_undone", { path: "src/a.ts" }),
      rec("s1", "files_undone", { paths: ["src/b.ts"] }),
      rec("s1", "tool_failed", { test: true }),
      rec("s1", "tool_failed", { test: false }),
      rec("s2", "tool_failed", { test: true }),
      // A commit from a session that spent nothing in these days still counts, under its own project.
      rec("s9", "commit_lineage_noted", {}, "shop"),
      rec("nobody", "commit_lineage_noted"),
    ]
    const o = outcomes(report, records)
    expect(o.projects).toEqual([
      expect.objectContaining({ project: "shop", costUsd: 4, changes: 2, costPerChange: 2, undos: 2, failedTestRuns: 2, sessions: 3, sessionsWithoutChange: 1, costWithoutChange: 1 }),
    ])
    expect(o.total).toEqual({ costUsd: 4, changes: 2, costPerChange: 2, undos: 2, failedTestRuns: 2, estimate: { samples: 2, enough: false } })
  })

  it("gives no cost per change when nothing was committed", () => {
    const o = outcomes({ from: "a", to: "b", days: { d: { s1: cell("x", 3) } }, daysWithoutCells: {} }, [])
    expect(o.projects[0]).not.toHaveProperty("costPerChange")
    expect(o.total).not.toHaveProperty("costPerChange")
  })
})

describe("estimates from history (D-100)", () => {
  it("shows the middle of the samples with the sample size, and says when there are fewer than five", () => {
    expect(MIN_SAMPLES).toBe(5)
    expect(estimateFrom([1, 2, 3, 4], [1, 2, 3, 4])).toEqual({ samples: 4, enough: false })
    expect(estimateFrom([6, 1, 5, 2, 4, 3], [12, 2, 10, 4, 8, 6])).toEqual({
      samples: 6,
      enough: true,
      costUsd: { low: 1, median: 3, high: 6 },
      minutes: { low: 2, median: 6, high: 12 },
    })
  })

  it("takes one sample per session that made a change, its spend and time per change", () => {
    const days = { d: Object.fromEntries([1, 2, 3, 4, 5].map((n) => [`s${n}`, cell("api", n * 2, n * 120_000)])) }
    const records = [1, 2, 3, 4, 5].flatMap((n) => [rec(`s${n}`, "commit_lineage_noted"), rec(`s${n}`, "commit_lineage_noted")])
    const e = outcomes({ from: "a", to: "b", days, daysWithoutCells: {} }, records).projects[0]!.estimate
    expect(e).toEqual({ samples: 5, enough: true, costUsd: { low: 1, median: 3, high: 5 }, minutes: { low: 1, median: 3, high: 5 } })
  })
})

describe("measured time against your baseline (D-090)", () => {
  const period = (minutes: number[], project = "api") => {
    const days = { d: Object.fromEntries(minutes.map((m, i) => [`${project}${m}-${i}`, cell(project, 1, m * 60_000)])) }
    const records = minutes.map((m, i) => rec(`${project}${m}-${i}`, "commit_lineage_noted"))
    return outcomes({ from: "a", to: "b", days, daysWithoutCells: {} }, records)
  }

  it("shows this period's interval against the period before, and says faster or slower only with enough of both", () => {
    const t = measuredTime(period([4, 5, 6, 7, 8]), period([10, 12, 14, 16, 18]), 30)
    expect(t.overall).toMatchObject({ now: { samples: 5, minutes: { low: 4, median: 6, high: 8 } }, baseline: { samples: 5, minutes: { median: 14 } }, trend: "faster" })
    expect(t.projects.map((p) => [p.project, p.trend])).toEqual([["api", "faster"]])
    expect(measuredTime(period([10, 12, 14, 16, 18]), period([4, 5, 6, 7, 8]), 30).overall.trend).toBe("slower")
    expect(measuredTime(period([10, 11, 12, 13, 14]), period([10, 11, 13, 13, 14]), 30).overall.trend).toBe("about the same")
    expect(measuredTime(period([4, 5, 6, 7, 8]), period([10, 12]), 30).overall).toMatchObject({ baseline: { samples: 2, enough: false }, trend: "not enough history" })
  })

  it("lists a project that worked only in one of the two periods", () => {
    const t = measuredTime(period([4, 5, 6, 7, 8], "api"), period([9, 9, 9, 9, 9], "site"), 30)
    expect(t.projects.map((p) => [p.project, p.now.samples, p.baseline.samples])).toEqual([
      ["api", 5, 0],
      ["site", 0, 5],
    ])
  })
})
