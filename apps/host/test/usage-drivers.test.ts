// B15: what drove the usage, counted from the audit log: calls by tool, subagents and skills, overall and by session.
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { redact } from "@gatehouse/policy"
import { AuditWriter } from "@gatehouse/shared/audit"
import { usageDrivers } from "../src/usage-drivers.js"

let dir: string
const verdict = {
  outcome: "allow" as const,
  ruleId: "r",
  reason: "",
  risk: 0,
  decidedBy: "rules" as const,
  policyHash: "",
}

beforeAll(async () => {
  dir = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), "gh-drivers-")))
  // Every record on one day, at noon local time.
  const w = new AuditWriter({
    dir,
    redact: (v) => redact(v),
    now: () => new Date(2026, 10, 10, 12),
  })
  const call = (
    session: string,
    event: string,
    tool: string,
    toolUseId: string,
    input: Record<string, unknown> = {},
  ) =>
    w.append({
      session,
      event,
      channel: "host",
      tool,
      toolUseId,
      project: session === "s1" ? "shop" : "blog",
      input,
      verdict,
      latencyMs: 0,
    })
  await call("s1", "decision", "Bash", "t1", { command: "npm test" })
  // The floor's record and the decision's for one call: counted once.
  await call("s1", "floor_deny", "Bash", "t2", { command: "rm -rf /" })
  await call("s1", "decision", "Bash", "t2", { command: "rm -rf /" })
  await call("s1", "self_approved", "Edit", "t3", { file_path: "a.ts" })
  await call("s1", "decision", "Task", "t4", { subagent_type: "code-reviewer" })
  await call("s2", "decision", "Skill", "t5", { skill: "pdf" })
  await call("s2", "decision", "Agent", "t6", {})
  // Not a tool call.
  await call("s2", "update_installed", "update", "u1")
})
afterAll(() => fs.rmSync(dir, { recursive: true, force: true }))

const today = "2026-11-10"

describe("what drove the usage", () => {
  it("counts each tool call once, and names the subagents and skills it ran", () => {
    const r = usageDrivers(dir, today, today)
    expect(r.tools).toEqual({ Bash: 2, Edit: 1, Task: 1, Skill: 1, Agent: 1 })
    expect(r.subagents).toEqual({ "code-reviewer": 1, general: 1 })
    expect(r.skills).toEqual({ pdf: 1 })
    expect(r.bySession.s1).toMatchObject({ project: "shop", tools: { Bash: 2, Edit: 1, Task: 1 } })
    expect(r.bySession.s2?.skills).toEqual({ pdf: 1 })
  })

  it("keeps to the days and the session asked for", () => {
    expect(usageDrivers(dir, "2020-01-01", "2020-01-02").tools).toEqual({})
    // Another day in the same month: the same file is read, and the day is what leaves it out.
    expect(usageDrivers(dir, "2026-11-11", "2026-11-12").tools).toEqual({})
    expect(usageDrivers(dir, today, today, "s2").tools).toEqual({ Skill: 1, Agent: 1 })
  })
})
