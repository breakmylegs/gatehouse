import fs from "node:fs"
import path from "node:path"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { listAuditFiles, verifyAudit, type AuditRecord } from "@gatehouse/shared/audit"
import { startApprover, type Running } from "./helpers.js"

let r: Running
beforeAll(async () => {
  r = await startApprover({ pwsh: undefined })
}, 60000)
afterAll(() => r.stop())

const ctx = () => ({ cwd: r.cwd, sessionId: "ks" })
const evaluate = (command: string) =>
  r.call("evaluate_permission", { toolName: "Bash", input: { command }, ctx: ctx() })
const records = (dir = r.auditDir): AuditRecord[] =>
  listAuditFiles(dir).flatMap((f) =>
    fs
      .readFileSync(path.join(dir, f), "utf8")
      .split("\n")
      .filter(Boolean)
      .map((l) => JSON.parse(l) as AuditRecord),
  )

describe("the kill switch (deny-all)", () => {
  it("starts re-armed and reports so in policy_status", async () => {
    expect((await r.call("policy_status", {})).structured.killSwitch).toEqual({ engaged: false })
    expect((await evaluate("git status")).structured.outcome).toBe("allow")
  })

  it("denies everything once engaged, including calls that are normally allowed, and audits it", async () => {
    const state = await r.call("kill_switch", { engaged: true, by: "desktop", reason: "test" })
    expect(state.structured).toMatchObject({ engaged: true, by: "desktop", reason: "test" })
    expect(state.structured.since).toMatch(/^\d{4}-/)

    for (const command of ["git status", "npm test", "git push", "cat .env"]) {
      const v = (await evaluate(command)).structured
      expect(v, command).toMatchObject({ outcome: "deny", ruleId: "kill-switch", risk: 100 })
      expect(v.reason).toContain("kill switch is engaged")
    }
    const read = await r.call("evaluate_permission", {
      toolName: "Read",
      input: { file_path: "src/a.ts" },
      ctx: ctx(),
    })
    expect(read.structured).toMatchObject({ outcome: "deny", ruleId: "kill-switch" })
    const prompt = await r.call("approval_prompt", {
      tool_name: "Bash",
      input: { command: "git status" },
    })
    expect(prompt.text.behavior).toBe("deny")
    expect(prompt.text.message).toContain("kill-switch")

    expect(
      records().filter((x) => x.verdict.ruleId === "kill-switch").length,
    ).toBeGreaterThanOrEqual(6)
    expect((await r.call("policy_status", {})).structured.killSwitch).toMatchObject({
      engaged: true,
    })
    expect(verifyAudit(r.auditDir).ok).toBe(true)
  })

  it("explains the kill switch rule id", async () => {
    const e = await r.call("explain_verdict", { ruleId: "kill-switch" })
    expect(e.structured).toMatchObject({ found: true, source: "built-in", risk: 100 })
  })

  it("allows again only after it is re-armed", async () => {
    const state = await r.call("kill_switch", { engaged: false, by: "desktop" })
    expect(state.structured.engaged).toBe(false)
    expect((await evaluate("git status")).structured).toMatchObject({
      outcome: "allow",
      ruleId: "safe-shell",
    })
  })

  it("stays engaged across a restart of the Approver", async () => {
    const state = path.join(r.dir, "restart-state.json")
    const first = await startApprover({ pwsh: undefined, statePath: state })
    await first.call("kill_switch", { engaged: true, by: "desktop" })
    await first.stop()
    const second = await startApprover({ pwsh: undefined, statePath: state })
    try {
      expect((await second.call("policy_status", {})).structured.killSwitch.engaged).toBe(true)
      const v = await second.call("evaluate_permission", {
        toolName: "Bash",
        input: { command: "git status" },
        ctx: { cwd: second.cwd, sessionId: "after-restart" },
      })
      expect(v.structured).toMatchObject({ outcome: "deny", ruleId: "kill-switch" })
      await second.call("kill_switch", { engaged: false })
    } finally {
      await second.stop()
    }
  })

  it("treats a damaged state file as engaged", async () => {
    const state = path.join(r.dir, "damaged-state.json")
    fs.writeFileSync(state, "{{{ not json")
    const s = await startApprover({ pwsh: undefined, statePath: state })
    try {
      const status = (await s.call("policy_status", {})).structured
      expect(status.killSwitch).toMatchObject({ engaged: true, damaged: true })
      const v = await s.call("evaluate_permission", {
        toolName: "Bash",
        input: { command: "git status" },
        ctx: { cwd: s.cwd, sessionId: "damaged" },
      })
      expect(v.structured.ruleId).toBe("kill-switch")
    } finally {
      await s.stop()
    }
  })

  it("notices a change made to the state file by another process at once", async () => {
    const state = path.join(r.dir, "shared-state.json")
    const s = await startApprover({ pwsh: undefined, statePath: state })
    try {
      const call = () =>
        s.call("evaluate_permission", {
          toolName: "Bash",
          input: { command: "git status" },
          ctx: { cwd: s.cwd, sessionId: "x" },
        })
      expect((await call()).structured.outcome).toBe("allow")
      fs.writeFileSync(
        state,
        JSON.stringify({ killSwitch: { engaged: true, by: "another process" } }),
      )
      expect((await call()).structured.ruleId).toBe("kill-switch")
      fs.writeFileSync(state, JSON.stringify({ killSwitch: { engaged: false } }))
      expect((await call()).structured.outcome).toBe("allow")
    } finally {
      await s.stop()
    }
  })

  it("still denies, and does not allow anything, when the audit log cannot be written", async () => {
    const blocker = path.join(r.dir, "blocker2")
    fs.writeFileSync(blocker, "x")
    const s = await startApprover({ pwsh: undefined, auditDir: path.join(blocker, "audit") })
    try {
      await s.call("kill_switch", { engaged: true })
      const v = await s.call("evaluate_permission", {
        toolName: "Bash",
        input: { command: "git status" },
        ctx: { cwd: s.cwd, sessionId: "x" },
      })
      expect(v.structured).toMatchObject({ outcome: "deny", ruleId: "kill-switch" })
    } finally {
      await s.stop()
    }
  })
})
