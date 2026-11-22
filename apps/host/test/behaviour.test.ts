// D-074: a Claude Code version that behaves worse on the owner's tasks cannot be let into the range; a session can be
// given a spend cap.
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import type { Options } from "@anthropic-ai/claude-agent-sdk"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { compareBehaviour, rangeChangeBlocked, readReport, readTasks, type BehaviourReport, type TaskRecord } from "../src/behaviour.js"
import { buildStack, type Stack } from "./stack.js"

const rec = (o: Partial<TaskRecord> = {}): TaskRecord => ({
  tools: ["Read", "Edit", "Bash"],
  decisions: [
    { tool: "Read", outcome: "allow", ruleId: "read-in-project" },
    { tool: "Bash", outcome: "allow", ruleId: "safe-shell" },
  ],
  passed: true,
  costUsd: 0.2,
  ...o,
})
const report = (claudeCode: string, tasks: Record<string, TaskRecord>): BehaviourReport => ({ v: 1, claudeCode, at: "2026-11-22T00:00:00Z", capUsd: 5, tasks })
const baseline = report("2.1.329", { fix: rec(), rename: rec() })

describe("behaviour regression for Claude Code upgrades", () => {
  it("lets a version that behaves the same in, noting tools used differently", () => {
    const same = report("2.1.340", { fix: rec({ tools: ["Read", "Edit", "Grep", "Bash"] }), rename: rec() })
    expect(compareBehaviour(baseline, same)).toEqual({ blocking: [], notes: ["fix: now also uses Grep."] })
    expect(rangeChangeBlocked("2.1.340", baseline, () => same)).toBeUndefined()
  })

  it("blocks the range change on a seeded regression: a failing check, a new refusal, or a task not run", () => {
    const worse = report("2.1.340", {
      fix: rec({ passed: false }),
      rename: rec({ decisions: [...rec().decisions, { tool: "Bash", outcome: "deny", ruleId: "destructive-shell" }] }),
    })
    const c = compareBehaviour(baseline, worse)
    expect(c.blocking).toEqual([
      "fix: its check passed on 2.1.329 and fails on 2.1.340.",
      "rename: a call met Bash deny (destructive-shell), which it did not on 2.1.329.",
    ])
    expect(rangeChangeBlocked("2.1.340", baseline, () => worse)).toMatch(/behaves differently/)
    const capped = report("2.1.340", { fix: rec(), rename: rec({ notRun: "the spend cap was reached" }) })
    expect(compareBehaviour(baseline, capped).blocking).toEqual(["rename: not run on Claude Code 2.1.340 (the spend cap was reached)."])
  })

  it("blocks widening without a report, without a baseline with tasks, or with a report of another version", () => {
    expect(rangeChangeBlocked("2.1.329", baseline, () => undefined)).toBeUndefined()
    expect(rangeChangeBlocked("2.1.340", baseline, () => undefined)).toMatch(/needs a behaviour report/)
    expect(rangeChangeBlocked("2.1.340", report("2.1.329", {}), () => report("2.1.340", {}))).toMatch(/No behaviour baseline with tasks/)
    expect(rangeChangeBlocked("2.1.340", baseline, () => report("2.1.339", baseline.tasks))).toMatch(/recorded on Claude Code 2\.1\.339/)
  })

  it("reads reports and the owner's tasks tolerantly, leaving out a task that writes outside its folder", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "codeh-behaviour-"))
    try {
      fs.writeFileSync(path.join(dir, "r.json"), JSON.stringify({ ...baseline, extra: 1 }))
      fs.writeFileSync(path.join(dir, "bad.json"), "{")
      expect(readReport(path.join(dir, "r.json"))?.claudeCode).toBe("2.1.329")
      expect(readReport(path.join(dir, "bad.json"))).toBeUndefined()
      fs.writeFileSync(
        path.join(dir, "t.json"),
        JSON.stringify({ tasks: [{ id: "ok", prompt: "Fix it", files: { "src/a.js": "x" } }, { id: "out", prompt: "p", files: { "../evil": "x" } }, { id: "abs", prompt: "p", files: { "C:\\x": "" } }, { prompt: "no id" }] }),
      )
      expect(readTasks(path.join(dir, "t.json")).map((t) => t.id)).toEqual(["ok"])
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })
})

describe("a session's spend cap", () => {
  let s: Stack
  beforeAll(async () => {
    s = await buildStack({ hardTimeoutMs: 20_000, phoneExpiryMs: 10_000 })
  }, 90_000)
  afterAll(async () => {
    for (const x of s.manager.liveSessions()) await x.close()
    await s.stop()
  })

  it("is passed to the SDK as maxBudgetUsd, and absent unless given", async () => {
    s.sdk.turn = async () => undefined
    await s.manager.start({ cwd: s.repo, maxBudgetUsd: 2.5 })
    expect((s.sdk.queries.at(-1)?.options as Options).maxBudgetUsd).toBe(2.5)
    await s.manager.start({ cwd: s.repo })
    expect((s.sdk.queries.at(-1)?.options as Options).maxBudgetUsd).toBeUndefined()
  })
})
