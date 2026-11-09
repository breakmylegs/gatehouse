// C-013: a remembered rule with a use limit allows that many calls, each counted once however many times it is
// decided, then asks again; the counts survive a restart, and a counts file that cannot be read spends them all.
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { afterAll, describe, expect, it, vi } from "vitest"
import { createCanUseTool, grantLimitsFor, type CanUseDeps } from "../src/canuse.js"
import { GrantUses } from "../src/grant-uses.js"
import { createFloorHook, type SessionHookDeps } from "../src/hooks.js"

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "gh-grant-uses-"))
afterAll(() => fs.rmSync(dir, { recursive: true, force: true }))
const policy = () =>
  ({
    rules: { floor: [] },
    remember: [
      {
        id: "remember-a",
        tools: ["Bash"],
        commands: ["npm install x"],
        remember: true,
        maxUses: 2,
      },
      { id: "remember-b", tools: ["Bash"], commands: ["npm ci"], remember: true },
    ],
  }) as never
const allow = (ruleId: string) => ({ outcome: "allow" as const, ruleId })

describe("grant use limits (C-013)", () => {
  it("allows a limited grant its uses, counting each call once, then asks", async () => {
    const file = path.join(dir, "uses.json")
    const g = new GrantUses(file, policy)
    expect(g.spent(allow("remember-a"), "t1")).toBe(false)
    // The same call decided again (the hook, then canUseTool) is one use.
    expect(g.spent(allow("remember-a"), "t1")).toBe(false)
    expect(g.spent(allow("remember-a"), "t2")).toBe(false)
    expect(g.spent(allow("remember-a"), "t3")).toBe(true)
    expect(g.used("remember-a")).toBe(2)
    // A grant with no limit, and anything that is not a remembered allow, is never spent.
    for (let i = 0; i < 5; i++) expect(g.spent(allow("remember-b"), `u${i}`)).toBe(false)
    expect(g.spent({ outcome: "escalate", ruleId: "remember-a" }, "t4")).toBe(false)
    expect(g.spent(allow("safe-shell"), "t5")).toBe(false)
    await new Promise((r) => setTimeout(r, 50))
    expect(new GrantUses(file, policy).spent(allow("remember-a"), "t9")).toBe(true)
  })

  it("spends every limited grant when its counts cannot be read", () => {
    const file = path.join(dir, "broken.json")
    fs.writeFileSync(file, "{ not json")
    const g = new GrantUses(file, policy)
    expect(g.spent(allow("remember-a"), "t1")).toBe(true)
    expect(g.spent(allow("remember-b"), "t2")).toBe(false)
  })
})

describe("a used-up grant reaches a person (C-013)", () => {
  it("sends the call to you instead of allowing it, saying why", async () => {
    const g = new GrantUses(path.join(dir, "canuse.json"), policy)
    const request = vi.fn(async () => ({ outcome: "deny", channel: "desktop", waitedMs: 1 }))
    const deps = {
      sessionId: "s1",
      cwd: "C:/p",
      project: "proj",
      approver: {
        evaluate: async () => ({
          outcome: "allow",
          ruleId: "remember-a",
          reason: "You remembered this.",
          risk: 20,
          decidedBy: "rules",
          policyHash: "h",
        }),
      },
      broker: { request },
      audit: { record: async () => true },
      kill: () => false,
      policy,
      engine: {},
      pwsh: undefined,
      decided: new Set<string>(),
      grants: g,
      log: () => undefined,
    } as unknown as CanUseDeps
    const canUse = createCanUseTool(deps)
    const call = (id: string) =>
      canUse("Bash", { command: "npm install x" }, {
        toolUseID: id,
        signal: new AbortController().signal,
      } as never)
    expect((await call("c1"))?.behavior).toBe("allow")
    expect((await call("c2"))?.behavior).toBe("allow")
    expect(request).not.toHaveBeenCalled()
    expect((await call("c3"))?.behavior).toBe("deny")
    expect(request).toHaveBeenCalledOnce()
    expect(JSON.stringify(request.mock.calls[0])).toContain("has allowed its 2 uses")
  })

  it("asks instead in Auto, where Claude Code would otherwise run it by itself", async () => {
    const hook = createFloorHook({
      sessionId: "s1",
      cwd: "C:/p",
      policy,
      pwsh: undefined,
      audit: { record: async () => true },
      kill: () => false,
      decided: new Set<string>(),
      mode: () => "auto",
      approver: {
        evaluate: async () => ({
          outcome: "allow",
          ruleId: "remember-a",
          reason: "You remembered this.",
          risk: 20,
          decidedBy: "rules",
          policyHash: "h",
        }),
      },
      grants: new GrantUses(path.join(dir, "hook.json"), policy),
      scanCommits: false,
      onEvent: () => undefined,
      log: () => undefined,
    } as unknown as SessionHookDeps)
    const call = (id: string) =>
      hook(
        {
          hook_event_name: "PreToolUse",
          tool_name: "Bash",
          tool_input: { command: "npm install x" },
          tool_use_id: id,
          cwd: "C:/p",
        } as never,
        id,
        { signal: new AbortController().signal },
      )
    const decision = (out: unknown) =>
      (out as { hookSpecificOutput?: { permissionDecision?: string } }).hookSpecificOutput
        ?.permissionDecision
    expect(decision(await call("h1"))).toBeUndefined()
    expect(decision(await call("h2"))).toBeUndefined()
    expect(decision(await call("h3"))).toBe("ask")
  })

  it("lasts 30 days in the session folder unless you choose otherwise", () => {
    const now = Date.parse("2026-11-09T12:00:00Z")
    expect(grantLimitsFor(undefined, "C:/p", now)).toEqual({
      expiresAt: "2026-12-09T12:00:00.000Z",
      scope: "C:/p",
    })
    expect(grantLimitsFor({ days: null, anywhere: true, maxUses: 5 }, "C:/p", now)).toEqual({
      maxUses: 5,
    })
  })
})
