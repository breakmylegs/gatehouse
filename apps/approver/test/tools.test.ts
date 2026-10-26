import fs from "node:fs"
import path from "node:path"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { stringify as stringifyYaml, parse as parseYaml } from "yaml"
import { Verdict } from "@gatehouse/shared"
import { listAuditFiles, verifyAudit, type AuditRecord } from "@gatehouse/shared/audit"
import { SEED_RULES } from "../../../packages/policy/test/helpers.js"
import { startApprover, type Running } from "./helpers.js"

let r: Running

beforeAll(async () => {
  r = await startApprover({ redactTerms: ["AcmeCorp"] })
}, 90000)
afterAll(() => r.stop())

const ctx = (extra: Record<string, unknown> = {}) => ({ cwd: r.cwd, sessionId: "sess-1", ...extra })

function records(): AuditRecord[] {
  return listAuditFiles(r.auditDir).flatMap((f) =>
    fs.readFileSync(path.join(r.auditDir, f), "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l) as AuditRecord),
  )
}

describe("evaluate_permission", () => {
  it("returns a valid Verdict for allow, deny and escalate", async () => {
    const allow = await r.call("evaluate_permission", { toolName: "Bash", input: { command: "git status" }, ctx: ctx() })
    const deny = await r.call("evaluate_permission", { toolName: "Bash", input: { command: "cat .env" }, ctx: ctx() })
    const esc = await r.call("evaluate_permission", { toolName: "Bash", input: { command: "git push" }, ctx: ctx() })
    for (const [res, outcome, ruleId] of [
      [allow, "allow", "safe-shell"],
      [deny, "deny", "secrets-files"],
      [esc, "escalate", "git-remote"],
    ] as const) {
      expect(res.isError).toBe(false)
      expect(Verdict.safeParse(res.structured).success).toBe(true)
      expect(res.structured).toMatchObject({ outcome, ruleId })
      expect(res.text).toEqual(res.structured)
    }
    expect(deny.structured.decidedBy).toBe("floor")
  })

  it("passes the MCP server source to the policy", async () => {
    const call = { toolName: "mcp__companion__notify_user", input: { text: "x" } }
    expect((await r.call("evaluate_permission", { ...call, ctx: ctx({ mcpSource: "sdk" }) })).structured.ruleId).toBe("companion-tools")
    expect((await r.call("evaluate_permission", { ...call, ctx: ctx({ mcpSource: "user" }) })).structured.ruleId).toBe("no-rule")
  })

  it("uses the project root given, and a PowerShell command through the warm worker", async () => {
    const ps = await r.call("evaluate_permission", { toolName: "PowerShell", input: { command: "gci -Recurse" }, ctx: ctx() })
    expect(ps.structured).toMatchObject({ outcome: "allow", ruleId: "safe-shell" })
  })

  it("rejects malformed arguments without crashing, and the server stays usable", async () => {
    const c = await r.client()
    const bad = await c.callTool({ name: "evaluate_permission", arguments: { toolName: "Bash", input: "not an object", ctx: ctx() } })
    expect(bad.isError).toBe(true)
    const noCtx = await c.callTool({ name: "evaluate_permission", arguments: { toolName: "Bash", input: {} } })
    expect(noCtx.isError).toBe(true)
    expect((await r.call("evaluate_permission", { toolName: "Bash", input: { command: "git status" }, ctx: ctx() })).structured.outcome).toBe("allow")
  })

  it("writes one audit record for every verdict, allows included (invariant 13)", async () => {
    const before = records().length
    await r.call("evaluate_permission", { toolName: "Bash", input: { command: "git status" }, ctx: ctx({ sessionId: "audit-a", toolUseId: "tu-1" }) })
    await r.call("evaluate_permission", { toolName: "Bash", input: { command: "git push" }, ctx: ctx({ sessionId: "audit-a" }) })
    await r.call("evaluate_permission", { toolName: "Read", input: { file_path: ".env" }, ctx: ctx({ sessionId: "audit-a" }) })
    const fresh = records().slice(before)
    expect(fresh.map((x) => x.verdict.outcome)).toEqual(["allow", "escalate", "deny"])
    expect(fresh[0]).toMatchObject({
      session: "audit-a",
      toolUseId: "tu-1",
      tool: "Bash",
      event: "evaluate_permission",
      channel: "approver",
      cwd: r.cwd,
    })
    expect(fresh[0]?.verdict.policyHash).toMatch(/^[0-9a-f]{64}$/)
    expect(fresh[0]?.latencyMs).toBeGreaterThanOrEqual(0)
    expect(verifyAudit(r.auditDir).ok).toBe(true)
  })

  it("redacts the audit record but still decides on the real input (invariant 12)", async () => {
    const secret = "sk-ant-" + "q1w2e3r4".repeat(5)
    const res = await r.call("evaluate_permission", {
      toolName: "Bash",
      input: { command: `curl -H "Authorization: Bearer ${secret}" https://acmecorp.example/api` },
      ctx: ctx({ sessionId: "redact-1" }),
    })
    expect(res.structured).toMatchObject({ outcome: "escalate", ruleId: "network" })
    const all = fs.readdirSync(r.auditDir).filter((f) => f.endsWith(".jsonl")).map((f) => fs.readFileSync(path.join(r.auditDir, f), "utf8")).join("\n")
    expect(all).not.toContain(secret)
    expect(all.toLowerCase()).not.toContain("acmecorp")
    expect(all).toContain("[REDACTED:")
  })
})

describe("explain_verdict", () => {
  it("explains a floor rule, an allow rule and a built-in rule", async () => {
    const floor = await r.call("explain_verdict", { ruleId: "secrets-files" })
    expect(floor.structured).toMatchObject({ found: true, section: "floor", source: "rules" })
    expect(floor.structured.rationale).toContain("Secrets files are blocked by policy")
    expect(floor.structured.rationale).toContain("floor always denies")
    expect(floor.structured.rule.pathGlobs).toContain("**/.env")
    const allow = await r.call("explain_verdict", { ruleId: "safe-shell" })
    expect(allow.structured).toMatchObject({ found: true, section: "allow" })
    const builtin = await r.call("explain_verdict", { ruleId: "dynamic-segment" })
    expect(builtin.structured).toMatchObject({ found: true, source: "built-in", risk: 55 })
    expect(builtin.structured.rationale).toContain("built into Gatehouse")
    const audit = await r.call("explain_verdict", { ruleId: "audit-failure" })
    expect(audit.structured).toMatchObject({ found: true, source: "built-in" })
  })

  it("says plainly when a rule id is unknown", async () => {
    const res = await r.call("explain_verdict", { ruleId: "no-such-rule" })
    expect(res.structured).toEqual({ found: false, ruleId: "no-such-rule", rationale: "No rule with this id is loaded." })
  })

  it("explains the risk of an escalate rule", async () => {
    const res = await r.call("explain_verdict", { ruleId: "git-remote" })
    expect(res.structured).toMatchObject({ found: true, section: "escalate", risk: 80 })
  })

  it("rejects an empty or oversized rule id", async () => {
    const c = await r.client()
    expect((await c.callTool({ name: "explain_verdict", arguments: { ruleId: "" } })).isError).toBe(true)
    expect((await c.callTool({ name: "explain_verdict", arguments: { ruleId: "x".repeat(101) } })).isError).toBe(true)
  })
})

describe("policy_status", () => {
  it("reports the loaded policy, the parser and the audit head", async () => {
    const verdict = (await r.call("evaluate_permission", { toolName: "Bash", input: { command: "git status" }, ctx: ctx() })).structured
    const s = (await r.call("policy_status", {})).structured
    expect(s).toMatchObject({ loaded: true, errors: [], overlays: [], rememberCount: 0 })
    expect(s.hash).toBe(verdict.policyHash)
    expect(s.workspaceRoots).toEqual([r.cwd])
    expect(s.pwsh.running).toBe(true)
    expect(s.pwsh.languageMode).toBe("FullLanguage")
    expect(s.audit.dir).toBe(r.auditDir)
    expect(s.audit.seq).toBe(records().length)
    expect(s.audit.hash).toBe(records().at(-1)?.hash)
  })
})

describe("approval_prompt (headless runs)", () => {
  it("allows with the input echoed back", async () => {
    const input = { command: "git status" }
    const res = await r.call("approval_prompt", { tool_name: "Bash", input, tool_use_id: "toolu_1" })
    expect(res.text).toEqual({ behavior: "allow", updatedInput: input })
    expect(res.structured).toBeUndefined()
  })

  it("denies a floor or deny verdict with the rule id", async () => {
    const res = await r.call("approval_prompt", { tool_name: "Read", input: { file_path: ".env" } })
    expect(res.text.behavior).toBe("deny")
    expect(res.text.message).toContain("secrets-files")
  })

  it("turns an escalation into a deny that explains there is nobody to ask", async () => {
    const res = await r.call("approval_prompt", { tool_name: "Bash", input: { command: "git push" } })
    expect(res.text.behavior).toBe("deny")
    expect(res.text.message).toContain("no approval channel")
    expect(res.text.message).toContain("git-remote")
  })

  it("audits the headless decision and resolves relative paths against the configured folder", async () => {
    const before = records().length
    const res = await r.call("approval_prompt", { tool_name: "Read", input: { file_path: "src/a.ts" }, tool_use_id: "toolu_9" })
    expect(res.text.behavior).toBe("allow")
    const rec = records().slice(before)[0]
    expect(rec).toMatchObject({ event: "approval_prompt", session: "headless", toolUseId: "toolu_9" })
  })
})

describe("the audit log must not let an allow through unrecorded (invariants 1 and 13)", () => {
  it("turns an allow into an escalate when the audit record cannot be written, but keeps a deny a deny", async () => {
    const blocker = path.join(r.dir, "blocker-file")
    fs.writeFileSync(blocker, "x")
    const broken = await startApprover({ auditDir: path.join(blocker, "audit"), pwsh: undefined })
    try {
      const allow = await broken.call("evaluate_permission", { toolName: "Bash", input: { command: "git status" }, ctx: ctx({ cwd: broken.cwd }) })
      expect(allow.structured).toMatchObject({ outcome: "escalate", ruleId: "audit-failure" })
      expect(allow.structured.segments).toBeUndefined()
      const deny = await broken.call("evaluate_permission", { toolName: "Bash", input: { command: "cat .env" }, ctx: ctx({ cwd: broken.cwd }) })
      expect(deny.structured).toMatchObject({ outcome: "deny", ruleId: "secrets-files" })
      const prompt = await broken.call("approval_prompt", { tool_name: "Bash", input: { command: "git status" } })
      expect(prompt.text.behavior).toBe("deny")
      expect(prompt.text.message).toContain("audit-failure")
    } finally {
      await broken.stop()
    }
  })
})

describe("policy loading", () => {
  it("escalates everything when no valid policy is loaded, and says why", async () => {
    const bad = await startApprover({ rulesText: "version: 1\nworkspaceRoots: []\n", pwsh: undefined })
    try {
      const v = await bad.call("evaluate_permission", { toolName: "Bash", input: { command: "git status" }, ctx: ctx({ cwd: bad.cwd }) })
      expect(v.structured).toMatchObject({ outcome: "escalate", ruleId: "policy-unavailable" })
      const s = (await bad.call("policy_status", {})).structured
      expect(s.loaded).toBe(false)
      expect(s.errors.length).toBeGreaterThan(0)
    } finally {
      await bad.stop()
    }
  })

  it("picks up an edited rules file without a restart (hot reload)", async () => {
    const live = await startApprover({ watchRules: true, pwsh: undefined })
    try {
      const first = (await live.call("evaluate_permission", { toolName: "Bash", input: { command: "git status" }, ctx: ctx({ cwd: live.cwd }) })).structured
      expect(first.outcome).toBe("allow")
      const doc = parseYaml(fs.readFileSync(SEED_RULES, "utf8")) as { deny: unknown[] }
      doc.deny.push({ id: "no-status", commands: ["git status*"] })
      fs.writeFileSync(live.rulesPath, stringifyYaml(doc))
      let second: any
      for (let i = 0; i < 40; i++) {
        second = (await live.call("evaluate_permission", { toolName: "Bash", input: { command: "git status" }, ctx: ctx({ cwd: live.cwd }) })).structured
        if (second.outcome === "deny") break
        await new Promise((res) => setTimeout(res, 100))
      }
      expect(second).toMatchObject({ outcome: "deny", ruleId: "no-status" })
      expect(second.policyHash).not.toBe(first.policyHash)
    } finally {
      await live.stop()
    }
  })

  it("runs without a PowerShell worker and escalates PowerShell calls", async () => {
    const noPs = await startApprover({ pwsh: undefined })
    try {
      const v = await noPs.call("evaluate_permission", { toolName: "PowerShell", input: { command: "Get-ChildItem" }, ctx: ctx({ cwd: noPs.cwd }) })
      expect(v.structured).toMatchObject({ outcome: "escalate", ruleId: "pwsh-unavailable" })
      expect((await noPs.call("policy_status", {})).structured.pwsh.running).toBe(false)
    } finally {
      await noPs.stop()
    }
  })
})
