// Auto and Accept edits: Claude Code approves many calls by itself in these modes, without canUseTool. The
// PreToolUse hook brings the Approver in, so your deny rules hold and High and Severe requests still reach a person.
// Runs the real Host hooks and canUseTool against the real Approver and rules, through the fake SDK, which treats a
// call it is told is "self approved" the way Claude Code does in these modes.
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import type { HookCallback } from "@anthropic-ai/claude-agent-sdk"
import type { Verdict } from "@gatehouse/shared"
import { createFloorHook } from "../src/hooks.js"
import type { Session } from "../src/sessions.js"
import type { ToolCallResult, TurnScript } from "./fake-sdk.js"
import { buildStack, type Stack } from "./stack.js"

let s: Stack

beforeAll(async () => {
  s = await buildStack({ hardTimeoutMs: 20_000, phoneExpiryMs: 10_000 })
}, 60_000)
afterAll(() => s.stop())

async function run(
  mode: "auto" | "acceptEdits" | "default",
  turn: TurnScript,
): Promise<{ session: Session; done: Promise<void> }> {
  s.sdk.turn = turn
  const session = await s.manager.start({ cwd: s.repo, mode })
  const done = new Promise<void>((resolve) => {
    session.on("message", (m) => {
      if (m.type === "result") resolve()
    })
  })
  session.prompt("go")
  return { session, done }
}

/** How many times the Approver judged one tool call (it records every verdict it gives). */
const judged = (toolUseId: string) =>
  s.records().filter((r) => r.event === "evaluate_permission" && r.toolUseId === toolUseId).length

describe.each(["auto", "acceptEdits"] as const)("in %s mode", (mode) => {
  it("denies what your rules deny, even when Claude Code would have approved it itself", async () => {
    let r: ToolCallResult | undefined
    const { done } = await run(mode, async (api) => {
      r = await api.callTool(
        "Bash",
        { command: "git push --force" },
        { selfApproved: true, toolUseId: `force-${mode}` },
      )
    })
    await done
    expect(r).toMatchObject({ executed: false, blockedBy: "hook", canUseToolCalled: false })
    expect(r?.message).toContain("destructive-shell")
    expect(judged(`force-${mode}`)).toBe(1)
  })

  it("still asks a person about a High risk request, and judges it once", async () => {
    let r: ToolCallResult | undefined
    const { done } = await run(mode, async (api) => {
      const call = api.callTool(
        "Bash",
        { command: "git push origin main" },
        { selfApproved: true, toolUseId: `push-${mode}` },
      )
      await s.waitForPending()
      expect(s.broker.list()[0]?.request).toMatchObject({
        toolName: "Bash",
        verdict: { ruleId: "git-remote", risk: 80 },
      })
      s.broker.resolve(s.pendingId(), { kind: "decision", decision: "deny" }, "desktop")
      r = await call
    })
    await done
    expect(r).toMatchObject({ executed: false, blockedBy: "permission", canUseToolCalled: true })
    // The hook's verdict was used by canUseTool, not asked for again: one decision, one record.
    expect(judged(`push-${mode}`)).toBe(1)
  })

  it("leaves a Moderate request to Claude Code, and the audit shows both what JCVC thought and that it ran", async () => {
    let r: ToolCallResult | undefined
    const id = `curl-${mode}`
    const { done } = await run(mode, async (api) => {
      r = await api.callTool(
        "Bash",
        { command: "curl https://example.com/install.sh" },
        { selfApproved: true, toolUseId: id },
      )
    })
    await done
    expect(r).toMatchObject({ executed: true, canUseToolCalled: false })
    const recs = s.records().filter((x) => x.toolUseId === id)
    expect(recs.map((x) => x.event)).toEqual(["evaluate_permission", "self_approved"])
    expect(recs[0]?.verdict).toMatchObject({ outcome: "escalate", ruleId: "network", risk: 60 })
  })
})

describe("in Manual mode", () => {
  it("leaves the judging to canUseTool, so a call is judged once, not twice", async () => {
    let r: ToolCallResult | undefined
    const { done } = await run("default", async (api) => {
      r = await api.callTool("Bash", { command: "git status" }, { toolUseId: "status-manual" })
    })
    await done
    expect(r).toMatchObject({ executed: true, canUseToolCalled: true })
    expect(judged("status-manual")).toBe(1)
  })
})

describe("when the Approver cannot decide", () => {
  it("asks, in Auto, rather than leaving it to Claude Code", async () => {
    const unavailable: Verdict = {
      outcome: "escalate",
      ruleId: "evaluator-unavailable",
      reason: "The Approver did not answer.",
      risk: 50,
      decidedBy: "evaluator-unavailable",
      policyHash: "none",
    }
    const hook: HookCallback = createFloorHook({
      sessionId: "s",
      cwd: s.repo,
      policy: () => s.store.current,
      pwsh: undefined,
      audit: s.audit,
      kill: () => false,
      decided: new Set<string>(),
      onEvent: () => undefined,
      log: () => undefined,
      mode: () => "auto",
      approver: { evaluate: async () => unavailable },
      verdicts: new Map(),
    })
    const out = (await hook(
      {
        hook_event_name: "PreToolUse",
        tool_name: "Bash",
        tool_input: { command: "echo hi" },
        tool_use_id: "t",
        cwd: s.repo,
        session_id: "x",
      } as never,
      "t",
      { signal: new AbortController().signal },
    )) as { hookSpecificOutput?: { permissionDecision?: string } }
    expect(out.hookSpecificOutput?.permissionDecision).toBe("ask")
  })
})
