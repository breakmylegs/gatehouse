// E-099: the health score's seven factors each give their last 30 days by day and where to look; the overall status is
// the worst factor's, never a weighted sum; and a factor with nothing to go on does not count.
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import Fastify from "fastify"
import { AuditWriter } from "@gatehouse/shared/audit"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { byDay, DAYS, healthScore, overall, registerHealthScoreRoutes, type Factor } from "../src/health-score.js"

const NOW = Date.parse("2026-11-18T12:00:00Z")
const ago = (days: number) => NOW - days * 24 * 60 * 60_000
const run = (ts: number, failed: number) => ({ ts, event: "canary_run", input: { failed } })

let dir: string
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "gh-health-"))
})
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }))

describe("the health score (E-099)", () => {
  it("is the worst factor's state, never a sum; and none counts for nothing", () => {
    const f = (state: Factor["state"]) => ({ state }) as Factor
    expect(overall([f("ok"), f("ok"), f("ok"), f("ok"), f("ok"), f("ok"), f("fail")])).toBe("fail")
    expect(overall([f("ok"), f("warn"), f("none")])).toBe("warn")
    expect(overall([f("none"), f("none")])).toBe("ok")
  })

  it("gives each factor its state, its 30 days by day, and its source", () => {
    const score = healthScore({
      records: [run(ago(0.1), 1), run(ago(3), 0), { ts: ago(0.5), event: "host_crash_restart" }, { ts: ago(10), event: "memory_refused" }],
      dev: { flaky: [{ file: "apps/host/test/invariants.test.ts", at: new Date(ago(2)).toISOString() }], gates: [{ ok: true, at: new Date(ago(1)).toISOString() }] },
      updates: {},
      auditOk: true,
      now: NOW,
    })
    const by = Object.fromEntries(score.factors.map((f) => [f.id, f]))
    expect(Object.keys(by)).toEqual(["canaries", "crashes", "memory", "flaky", "gate", "updates", "audit"])
    expect(by.canaries).toMatchObject({ state: "fail", source: "doctor" })
    expect(by.crashes!.state).toBe("warn")
    expect(by.memory!.state).toBe("ok")
    expect(by.flaky!.state).toBe("warn")
    expect(by.gate!.state).toBe("ok")
    expect(by.audit).toMatchObject({ state: "ok", source: "audit" })
    expect(score.state).toBe("fail")
    for (const f of score.factors) expect(f.trend).toHaveLength(DAYS)
    expect(by.canaries!.trend.at(-1)).toBe(1)
    expect(by.memory!.trend[DAYS - 1 - 10]).toBe(1)
  })

  it("leaves out what a computer has no record of (no test runs, no gate), and a bad chain fails", () => {
    const score = healthScore({ records: [], auditOk: false, now: NOW })
    const by = Object.fromEntries(score.factors.map((f) => [f.id, f.state]))
    expect(by).toMatchObject({ canaries: "none", flaky: "none", gate: "none", updates: "none", audit: "fail" })
    expect(score.state).toBe("fail")
  })

  it("counts by day, oldest first, the last 30 days only", () => {
    expect(byDay([ago(0), ago(0.2), ago(29.5), ago(31)], NOW)).toEqual([1, ...new Array<number>(DAYS - 2).fill(0), 2])
  })

  it("is read from the audit log and dev-checks.json at /api/health-score", async () => {
    const auditDir = path.join(dir, "audit")
    const w = new AuditWriter({ dir: auditDir, redact: (x) => x })
    await w.append({ session: "host", event: "canary_run", channel: "host", tool: "canaries", input: { passed: 8, failed: 0 }, verdict: { outcome: "allow", ruleId: "invariant-canaries", reason: "", risk: 0, decidedBy: "rules", policyHash: "" }, latencyMs: 0 })
    fs.writeFileSync(path.join(dir, "dev-checks.json"), JSON.stringify({ gates: [{ ok: false, at: new Date().toISOString() }] }))
    const app = Fastify()
    registerHealthScoreRoutes(app, { auditDir, dataDir: dir, updates: () => ({}) })
    const s = (await app.inject({ method: "GET", url: "/api/health-score" })).json() as { state: string; factors: Factor[] }
    expect(s.factors.find((f) => f.id === "canaries")!.state).toBe("ok")
    expect(s.factors.find((f) => f.id === "gate")!.state).toBe("warn")
    expect(s.state).toBe("warn")
    await app.close()
  })
})
