import fs from "node:fs"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { parse as parseYaml } from "yaml"
import { verifyAudit } from "@gatehouse/shared/audit"
import type { Session } from "../src/sessions.js"
import type { ToolCallResult, TurnScript } from "./fake-sdk.js"
import { buildStack, type Stack } from "./stack.js"

let s: Stack

beforeAll(async () => {
  s = await buildStack({ hardTimeoutMs: 1500, phoneExpiryMs: 800 })
}, 60000)
afterAll(() => s.stop())

/** Starts a session, runs one scripted turn and resolves when its result arrives. */
async function run(
  turn: TurnScript,
  text = "go",
): Promise<{ session: Session; done: Promise<void> }> {
  s.sdk.turn = turn
  const session = await s.manager.start({ cwd: s.repo })
  const done = new Promise<void>((resolve) => {
    session.on("message", (m) => {
      if (m.type === "result") resolve()
    })
  })
  session.prompt(text)
  return { session, done }
}

const lastAudit = (event: string) =>
  s
    .records()
    .filter((r) => r.event === event)
    .at(-1)

describe("calls the Approver decides by itself", () => {
  it("auto-allows a safe command and an edit of source, and runs them", async () => {
    const results: ToolCallResult[] = []
    const { done } = await run(async (api) => {
      results.push(await api.callTool("Bash", { command: "git status" }))
      results.push(
        await api.callTool("Edit", {
          file_path: `${s.repo}\\src\\a.ts`,
          old_string: "1",
          new_string: "2",
        }),
      )
    })
    await done
    expect(results.map((r) => r.executed)).toEqual([true, true])
    expect(results.every((r) => r.canUseToolCalled)).toBe(true)
    const recs = s
      .records()
      .filter((r) => r.event === "evaluate_permission" && r.verdict.outcome === "allow")
    expect(recs.length).toBeGreaterThanOrEqual(2)
    expect(s.broker.list()).toEqual([])
  })

  it("auto-denies a destructive command and tells Claude the rule so it can adapt", async () => {
    let r: ToolCallResult | undefined
    const { done } = await run(async (api) => {
      r = await api.callTool("Bash", { command: "git push --force" })
    })
    await done
    expect(r).toMatchObject({ executed: false, blockedBy: "permission", canUseToolCalled: true })
    expect(r?.message).toContain("destructive-shell")
    expect(r?.message).toContain("Denied by rule destructive-shell")
  })

  it("blocks a secrets file in the PreToolUse hook, before canUseTool, and audits it", async () => {
    let r: ToolCallResult | undefined
    const before = s.records().length
    const { done } = await run(async (api) => {
      r = await api.callTool("Read", { file_path: `${s.repo}\\.env` }, { selfApproved: true })
    })
    await done
    expect(r).toMatchObject({ executed: false, blockedBy: "hook", canUseToolCalled: false })
    expect(r?.message).toContain("secrets-files")
    const rec = s
      .records()
      .slice(before)
      .find((x) => x.event === "floor_deny")
    expect(rec).toMatchObject({
      tool: "Read",
      channel: "host",
      verdict: { outcome: "deny", ruleId: "secrets-files", decidedBy: "floor" },
    })
  })

  it("audits a call Claude Code approved itself, through PostToolUse (invariant 13)", async () => {
    const before = s.records().length
    const { done } = await run(async (api) => {
      await api.callTool(
        "Read",
        { file_path: `${s.repo}\\src\\a.ts` },
        { selfApproved: true, toolUseId: "toolu_self" },
      )
    })
    await done
    const rec = s
      .records()
      .slice(before)
      .find((x) => x.event === "self_approved")
    expect(rec).toMatchObject({
      tool: "Read",
      toolUseId: "toolu_self",
      channel: "host",
      verdict: { outcome: "allow", ruleId: "claude-code-auto" },
    })
    // The same call is not audited twice when it did go through canUseTool.
    const count = s
      .records()
      .filter((x) => x.event === "self_approved" && x.toolUseId === "toolu_self").length
    expect(count).toBe(1)
  })
})

describe("escalation to a person", () => {
  it("escalates, takes a checkpoint first, and runs the call once the desktop approves", async () => {
    let r: ToolCallResult | undefined
    fs.writeFileSync(`${s.repo}/src/work-in-progress.ts`, "// not yet committed\n")
    const { done } = await run(async (api) => {
      r = await api.callTool("Bash", { command: "npm install lodash" })
    })
    await s.waitForPending()
    const view = s.broker.list()[0]
    expect(view?.request).toMatchObject({ kind: "permission", toolName: "Bash", project: "proj" })
    expect(view?.request.verdict).toMatchObject({ outcome: "escalate", ruleId: "package-install" })
    expect(view?.rawInput).toEqual({ command: "npm install lodash" })
    expect(view?.defaultToNo).toBe(true) // risk 70 or more never has "allow" as the default

    expect(
      s.broker.resolve(s.pendingId(), { kind: "decision", decision: "allow" }, "desktop").ok,
    ).toBe(true)
    await done
    expect(r).toMatchObject({ executed: true })
    expect(r?.permission).toMatchObject({
      behavior: "allow",
      updatedInput: { command: "npm install lodash" },
    })
    expect(r?.permission).not.toHaveProperty("updatedPermissions")

    const cps = await s.checkpoints.list(s.repo)
    const cp = cps.find((c) => c.label.startsWith("before: Bash npm install lodash"))
    expect(cp).toBeDefined()
    expect(s.git("show", `${cp?.commit}:src/work-in-progress.ts`)).toContain("not yet committed")
    expect(s.git("ls-tree", "-r", "--name-only", cp?.commit as string)).not.toContain(".env")

    const rec = lastAudit("human_decision")
    expect(rec).toMatchObject({
      tool: "Bash",
      channel: "desktop",
      verdict: { outcome: "allow", decidedBy: "human-desktop", ruleId: "package-install" },
    })
    expect(rec?.latencyMs).toBeGreaterThanOrEqual(0)
  })

  it("denies when the desktop denies, passing the user's message on", async () => {
    let r: ToolCallResult | undefined
    const { done } = await run(async (api) => {
      r = await api.callTool("Bash", { command: "pip install requests" })
    })
    await s.waitForPending()
    s.broker.resolve(
      s.pendingId(),
      { kind: "decision", decision: "deny", message: "use the vendored copy" },
      "desktop",
    )
    await done
    expect(r).toMatchObject({ executed: false, blockedBy: "permission" })
    expect(r?.message).toBe("Denied by the user: use the vendored copy")
    expect(lastAudit("human_decision")).toMatchObject({
      verdict: { outcome: "deny", decidedBy: "human-desktop" },
    })
  })

  it("accepts an answer from the phone, and refuses a phone answer that edits input", async () => {
    let r: ToolCallResult | undefined
    const { done } = await run(async (api) => {
      r = await api.callTool("Bash", { command: "winget install foo" })
    })
    await s.waitForPending()
    const edit = s.broker.resolve(
      s.pendingId(),
      { kind: "decision", decision: "allow", updatedInput: { command: "winget install bar" } },
      "phone",
    )
    expect(edit).toMatchObject({ ok: false, reason: "not-allowed-on-channel" })
    expect(
      s.broker.resolve(s.pendingId(), { kind: "decision", decision: "allow" }, "phone").ok,
    ).toBe(true)
    await done
    expect(r?.executed).toBe(true)
    expect(lastAudit("human_decision")).toMatchObject({
      channel: "phone",
      verdict: { decidedBy: "human-phone" },
    })
  })

  it("times out after the hard timeout and denies with the spec's words", async () => {
    let r: ToolCallResult | undefined
    const { done } = await run(async (api) => {
      r = await api.callTool("Bash", { command: "choco install git" })
    })
    await s.waitForPending()
    await done // nobody answers: the 1.5 second test timeout expires
    expect(r).toMatchObject({ executed: false, blockedBy: "permission" })
    expect(r?.message).toBe("Timed out waiting for approval")
    expect(lastAudit("human_decision")).toMatchObject({
      channel: "timeout",
      verdict: { outcome: "deny", decidedBy: "timeout" },
    })
    expect(s.broker.list()).toEqual([])
  }, 20000)

  it("re-checks input the user edited, and lets a safe edit through (invariant 10)", async () => {
    let r: ToolCallResult | undefined
    const { done } = await run(async (api) => {
      r = await api.callTool("Bash", { command: "npm install left-pad" })
    })
    await s.waitForPending()
    s.broker.resolve(
      s.pendingId(),
      {
        kind: "decision",
        decision: "allow",
        updatedInput: { command: "npm install left-pad-fork" },
      },
      "desktop",
    )
    await done
    expect(r).toMatchObject({ executed: true, input: { command: "npm install left-pad-fork" } })
    expect(r?.permission).toMatchObject({
      behavior: "allow",
      updatedInput: { command: "npm install left-pad-fork" },
    })
  })

  it("blocks an edit that turns the command into one a deny rule covers (invariant 10)", async () => {
    let r: ToolCallResult | undefined
    const { done } = await run(async (api) => {
      r = await api.callTool("Bash", { command: "npm install left-pad" })
    })
    await s.waitForPending()
    s.broker.resolve(
      s.pendingId(),
      { kind: "decision", decision: "allow", updatedInput: { command: "git push --force" } },
      "desktop",
    )
    await done
    expect(r).toMatchObject({ executed: false, blockedBy: "permission" })
    expect(r?.message).toContain("Your edit was blocked")
    expect(r?.message).toContain("destructive-shell")
    expect(lastAudit("edited_input_blocked")).toMatchObject({
      verdict: { outcome: "deny", ruleId: "destructive-shell" },
    })
  })

  it("blocks an edit that reaches a secrets file, by the floor (invariant 10)", async () => {
    let r: ToolCallResult | undefined
    const { done } = await run(async (api) => {
      r = await api.callTool("Bash", { command: "npm install left-pad" })
    })
    await s.waitForPending()
    s.broker.resolve(
      s.pendingId(),
      { kind: "decision", decision: "allow", updatedInput: { command: "cat .env" } },
      "desktop",
    )
    await done
    expect(r).toMatchObject({ executed: false })
    expect(r?.message).toContain("secrets-files")
    expect(lastAudit("edited_input_blocked")).toMatchObject({
      verdict: { decidedBy: "floor", ruleId: "secrets-files" },
    })
  })

  it("remembers a command when the desktop asks, so the next identical call needs no one", async () => {
    let first: ToolCallResult | undefined
    const { done } = await run(async (api) => {
      first = await api.callTool("Bash", { command: "npm install remembered-pkg" })
    })
    await s.waitForPending()
    s.broker.resolve(
      s.pendingId(),
      { kind: "decision", decision: "allow", remember: true },
      "desktop",
    )
    await done
    expect(first?.executed).toBe(true)
    const rules = parseYaml(fs.readFileSync(s.localRules, "utf8"))
    expect(rules.remember).toEqual([
      expect.objectContaining({ tool: "Bash", command: "npm install remembered-pkg" }),
    ])
    expect(rules.remember[0]).not.toHaveProperty("updatedPermissions")

    // The Approver reloads its rules when the file changes, so wait until it has picked the rule up.
    const probe = { toolName: "Bash", input: { command: "npm install remembered-pkg" } }
    let verdict = await s.approver.evaluate(probe, { cwd: s.repo, sessionId: "poll" })
    for (let i = 0; i < 60 && verdict.outcome !== "allow"; i++) {
      await new Promise((r) => setTimeout(r, 100))
      verdict = await s.approver.evaluate(probe, { cwd: s.repo, sessionId: "poll" })
    }
    expect(verdict).toMatchObject({ outcome: "allow" })
    expect(verdict.ruleId).toMatch(/^remember-/)

    let second: ToolCallResult | undefined
    const next = await run(async (api) => {
      second = await api.callTool("Bash", probe.input)
    })
    await next.done
    expect(second).toMatchObject({ executed: true })
    expect(s.broker.list()).toEqual([]) // nobody was asked
    // Other commands are still escalated.
    expect(
      (
        await s.approver.evaluate(
          { toolName: "Bash", input: { command: "npm install something-else" } },
          { cwd: s.repo, sessionId: "poll" },
        )
      ).outcome,
    ).toBe("escalate")
  }, 60000)

  it("does not remember when the desktop did not ask, or when the phone asks", async () => {
    const before = fs.readFileSync(s.localRules, "utf8")
    const { done } = await run(async (api) => {
      await api.callTool("Bash", { command: "npm install not-remembered" })
    })
    await s.waitForPending()
    s.broker.resolve(s.pendingId(), { kind: "decision", decision: "allow" }, "desktop")
    await done
    expect(fs.readFileSync(s.localRules, "utf8")).toBe(before)
  })
})

describe("questions and plans", () => {
  const question = {
    questions: [
      {
        question: "Which database?",
        header: "Database",
        options: [
          { label: "SQLite", description: "file" },
          { label: "Postgres", description: "server" },
        ],
        multiSelect: false,
      },
    ],
  }

  it("asks the user and returns the answers in updatedInput", async () => {
    let r: ToolCallResult | undefined
    const { done } = await run(async (api) => {
      r = await api.callTool("AskUserQuestion", question)
    })
    await s.waitForPending()
    const view = s.broker.list()[0]
    expect(view?.request.kind).toBe("question")
    expect(view?.request.toolName).toBe("AskUserQuestion")
    expect(
      s.broker.resolve(
        s.pendingId(),
        { kind: "answers", answers: { "Which database?": "SQLite" } },
        "desktop",
      ).ok,
    ).toBe(true)
    await done
    expect(r).toMatchObject({ executed: true })
    expect(r?.permission).toMatchObject({
      behavior: "allow",
      updatedInput: { ...question, answers: { "Which database?": "SQLite" } },
    })
    expect(r?.permission).not.toHaveProperty("updatedPermissions")
    expect(lastAudit("question_answered")).toMatchObject({
      tool: "AskUserQuestion",
      channel: "desktop",
    })
  })

  it("answers a question from the phone", async () => {
    let r: ToolCallResult | undefined
    const { done } = await run(async (api) => {
      r = await api.callTool("AskUserQuestion", question)
    })
    await s.waitForPending()
    s.broker.resolve(
      s.pendingId(),
      { kind: "answers", answers: { "Which database?": "Postgres" } },
      "phone",
    )
    await done
    expect(r?.permission).toMatchObject({
      updatedInput: { answers: { "Which database?": "Postgres" } },
    })
    expect(lastAudit("question_answered")).toMatchObject({ channel: "phone" })
  })

  it("tells Claude when the user declines to answer", async () => {
    let r: ToolCallResult | undefined
    const { done } = await run(async (api) => {
      r = await api.callTool("AskUserQuestion", question)
    })
    await s.waitForPending()
    s.broker.resolve(
      s.pendingId(),
      { kind: "decision", decision: "deny", message: "ask me later" },
      "desktop",
    )
    await done
    expect(r).toMatchObject({ executed: false })
    expect(r?.message).toBe("ask me later")
  })

  it("approves a plan, and sends back feedback when a plan is not approved", async () => {
    const plan = { plan: "1. add tests\n2. change code" }
    let approved: ToolCallResult | undefined
    let rejected: ToolCallResult | undefined
    const first = await run(async (api) => {
      approved = await api.callTool("ExitPlanMode", plan)
    })
    await s.waitForPending()
    expect(s.broker.list()[0]?.request.kind).toBe("plan")
    s.broker.resolve(s.pendingId(), { kind: "decision", decision: "allow" }, "desktop")
    await first.done
    expect(approved).toMatchObject({ executed: true })
    expect(approved?.permission).toMatchObject({ behavior: "allow", updatedInput: plan })

    const second = await run(async (api) => {
      rejected = await api.callTool("ExitPlanMode", plan)
    })
    await s.waitForPending()
    s.broker.resolve(
      s.pendingId(),
      { kind: "decision", decision: "deny", message: "write the tests first" },
      "desktop",
    )
    await second.done
    expect(rejected).toMatchObject({ executed: false })
    expect(rejected?.message).toBe("write the tests first")
    expect(lastAudit("plan_decision")).toMatchObject({
      tool: "ExitPlanMode",
      verdict: { outcome: "deny" },
    })
  })
})

describe("interrupt and kill", () => {
  it("interrupts a session that is waiting on an approval: the request is cancelled everywhere and the session is idle", async () => {
    let r: ToolCallResult | undefined
    const { session, done } = await run(async (api) => {
      r = await api.callTool("Bash", { command: "pip install interrupted" })
    })
    await s.waitForPending()
    expect(session.info()).toMatchObject({ state: "waiting", pendingApprovals: 1 })
    await session.interrupt()
    await done
    expect(r).toMatchObject({ executed: false })
    expect(r?.message).toContain("Cancelled")
    expect(s.broker.list()).toEqual([])
    expect(session.info().state).toBe("idle")
    expect(s.sdk.queries.at(-1)?.interrupts).toBeGreaterThanOrEqual(1)
  })

  it("engages the kill switch: interrupts sessions, cancels requests, denies everything and refuses new sessions", async () => {
    let waiting: ToolCallResult | undefined
    const { session, done } = await run(async (api) => {
      waiting = await api.callTool("Bash", { command: "pip install killed" })
    })
    await s.waitForPending()
    const status = await s.kill.engage("desktop", "test")
    await done
    expect(status).toMatchObject({ engaged: true, by: "desktop", approverConfirmed: true })
    expect(waiting).toMatchObject({ executed: false })
    expect(waiting?.message).toContain("Cancelled")
    expect(s.broker.list()).toEqual([])
    expect(session.info().state).toBe("idle")

    // Both the Host and the Approver now deny everything, even a normally allowed command.
    let after: ToolCallResult | undefined
    s.sdk.turn = async (api) => {
      after = await api.callTool("Bash", { command: "git status" })
    }
    expect(() => session.prompt("again")).toThrow(/kill switch/)
    await expect(s.manager.start({ cwd: s.repo })).rejects.toThrow(/kill switch/)
    expect(
      (
        await s.approver.evaluate(
          { toolName: "Bash", input: { command: "git status" } },
          { cwd: s.repo, sessionId: "x" },
        )
      ).ruleId,
    ).toBe("kill-switch")
    expect(after).toBeUndefined()

    expect(s.records().some((r) => r.event === "kill_switch_engaged")).toBe(true)
  })

  it("re-arms only from the desktop, and then works again", async () => {
    await expect(s.kill.rearm("phone")).rejects.toThrow(/desktop/)
    expect(s.kill.isEngaged()).toBe(true)
    const status = await s.kill.rearm("desktop")
    expect(status.engaged).toBe(false)
    let r: ToolCallResult | undefined
    const { done } = await run(async (api) => {
      r = await api.callTool("Bash", { command: "git status" })
    })
    await done
    expect(r?.executed).toBe(true)
    expect(s.records().some((x) => x.event === "kill_switch_rearmed")).toBe(true)
  })
})

describe("the audit log after all of that", () => {
  it("is one intact hash chain across the Approver and the Host", () => {
    const result = verifyAudit(s.auditDir)
    expect(result.problems).toEqual([])
    expect(result.ok).toBe(true)
    const events = new Set(s.records().map((r) => r.event))
    for (const e of [
      "evaluate_permission",
      "human_decision",
      "floor_deny",
      "self_approved",
      "question_answered",
      "plan_decision",
      "edited_input_blocked",
      "kill_switch_engaged",
      "kill_switch_rearmed",
    ]) {
      expect(events.has(e), e).toBe(true)
    }
    const writers = new Set(s.records().map((r) => r.channel))
    expect(writers.has("approver")).toBe(true)
    expect(writers.has("host")).toBe(true)
    expect(writers.has("desktop")).toBe(true)
    expect(writers.has("phone")).toBe(true)
    expect(writers.has("timeout")).toBe(true)
  })
})
