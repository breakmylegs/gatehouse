// E-046: roles are an overlay that can only restrict: a tester editing source escalates; a role that adds an allow is
// refused; a role's session keeps to its scope.
import path from "node:path"
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"
import { createCanUseTool, type CanUseDeps } from "../src/canuse.js"
import { parseRoles, ROLE_SCOPE_RULE, ROLE_TOOL_RULE, roleOverlay, rolePrompt, type Role } from "../src/roles.js"
import { buildStack, type Stack } from "./stack.js"

const ROLES = `roles:
  tester:
    model: claude-sonnet-5-5
    effort: medium
    paths: ["test/**", "tests/**", "**/*.test.ts"]
    denyTools: [WebFetch]
  reviewer:
    readOnly: true
`

describe("role definitions", () => {
  it("reads roles with their model, effort, paths and tool limits", () => {
    expect(parseRoles(ROLES)).toEqual({
      roles: [
        { name: "tester", model: "claude-sonnet-5-5", effort: "medium", paths: ["test/**", "tests/**", "**/*.test.ts"], denyTools: ["WebFetch"] },
        { name: "reviewer", readOnly: true },
      ],
    })
  })

  it("refuses a role definition that adds an allow, or sets what Codehouse does not know", () => {
    for (const bad of ["allowTools: [Bash]", "autoApprove: true", "permissionMode: acceptEdits", "rules: [{ allow: Bash }]", "bypassPermissions: true", "extreme: true"])
      expect(parseRoles(`roles:\n  tester:\n    ${bad}\n`)).toEqual({ refused: expect.stringMatching(/would add an allow; roles can only restrict/) })
    expect(parseRoles("roles:\n  tester:\n    superpowers: true\n")).toEqual({ refused: expect.stringMatching(/does not know/) })
    expect(parseRoles("roles:\n  tester:\n    effort: infinite\n")).toEqual({ refused: expect.stringMatching(/effort/) })
    expect(parseRoles("nothing: here\n")).toEqual({ refused: "roles.yml has no roles" })
  })
})

const tester: Role = { name: "tester", paths: ["test/**", "**/*.test.ts"], denyTools: ["WebFetch"] }

describe("the role overlay", () => {
  it("holds a tester's edit to source, leaves its tests alone, denies a tool it may not use and a reader's edits", () => {
    expect(roleOverlay(tester, "Edit", { file_path: "src/cart.ts" }, "C:/p", "C:/p")).toMatchObject({ outcome: "escalate", ruleId: ROLE_SCOPE_RULE, reason: expect.stringMatching(/src\/cart\.ts is outside/) })
    expect(roleOverlay(tester, "Edit", { file_path: "src/cart.test.ts" }, "C:/p", "C:/p")).toBeUndefined()
    expect(roleOverlay(tester, "Write", { file_path: "C:/p/test/x.ts" }, "C:/p", "C:/p")).toBeUndefined()
    expect(roleOverlay(tester, "WebFetch", { url: "https://x" }, "C:/p", "C:/p")).toMatchObject({ outcome: "deny", ruleId: ROLE_TOOL_RULE })
    expect(roleOverlay({ name: "reviewer", readOnly: true }, "Write", { file_path: "test/a.ts" }, "C:/p", "C:/p")).toMatchObject({ outcome: "deny" })
    expect(roleOverlay(tester, "Read", { file_path: "src/cart.ts" }, "C:/p", "C:/p")).toBeUndefined()
    expect(rolePrompt(tester, "Add tests for totals")).toMatch(/^You are the tester on this team[\s\S]*You work only in: test\/\*\*, \*\*\/\*\.test\.ts[\s\S]*Your task: Add tests for totals/)
  })

  it("only restricts: what the rules allow can be held, and what they deny stays denied", async () => {
    const canUse = (outcome: "allow" | "deny") => {
      const request = vi.fn(async () => ({ outcome: "deny", channel: "desktop", waitedMs: 1 }))
      const fn = createCanUseTool({
        sessionId: "s1", cwd: "C:/p", project: "p",
        approver: { evaluate: async () => ({ outcome, ruleId: outcome === "allow" ? "edit-workspace-source" : "critical-path", reason: "r", risk: 10, decidedBy: "rules", policyHash: "h" }) },
        broker: { request }, audit: { record: async () => true }, kill: () => false, policy: () => undefined, engine: {}, pwsh: undefined,
        decided: new Set<string>(), extreme: () => false, effects: async () => undefined, log: () => undefined,
        role: () => ({ role: tester, root: "C:/p" }),
      } as unknown as CanUseDeps)
      return { fn, request }
    }
    const a = canUse("allow")
    expect((await a.fn("Edit", { file_path: "src/cart.ts", old_string: "a", new_string: "b" }, { toolUseID: "t", signal: new AbortController().signal } as never))?.behavior).toBe("deny")
    expect(a.request).toHaveBeenCalledWith(expect.objectContaining({ verdict: expect.objectContaining({ ruleId: ROLE_SCOPE_RULE }) }))
    expect((await a.fn("Edit", { file_path: "test/cart.test.ts", old_string: "a", new_string: "b" }, { toolUseID: "t2", signal: new AbortController().signal } as never))?.behavior).toBe("allow")
    const d = canUse("deny")
    expect((await d.fn("Edit", { file_path: "test/cart.test.ts", old_string: "a", new_string: "b" }, { toolUseID: "t3", signal: new AbortController().signal } as never))?.behavior).toBe("deny")
    // Out of the role's paths too: still the rules' deny, never softened into a hold.
    expect((await d.fn("Edit", { file_path: "src/cart.ts", old_string: "a", new_string: "b" }, { toolUseID: "t4", signal: new AbortController().signal } as never))?.behavior).toBe("deny")
    expect(d.request).not.toHaveBeenCalled()
  })
})

describe("a role's session", () => {
  let s: Stack
  beforeAll(async () => {
    s = await buildStack({ hardTimeoutMs: 20_000, phoneExpiryMs: 10_000 })
  }, 90_000)
  afterAll(async () => {
    for (const x of s.manager.liveSessions()) await x.close()
    await s.stop()
  })

  it("holds a tester session's edit to source for a person", { timeout: 60_000 }, async () => {
    s.sdk.turn = async (api) => {
      await api.callTool("Edit", { file_path: path.join(s.repo, "src", "app.ts"), old_string: "a", new_string: "b" }, { selfApproved: false })
      api.say("done")
    }
    const t = await s.manager.start({ cwd: s.repo, role: tester })
    t.prompt("add tests")
    await s.waitForPending(1)
    expect(s.broker.list()[0]!.request.verdict).toMatchObject({ ruleId: ROLE_SCOPE_RULE })
    s.broker.resolve(s.pendingId(), { kind: "decision", decision: "deny" }, "desktop")
  })
})
