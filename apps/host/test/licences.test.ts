// D-055, licence policy in canUseTool: the escalation is recorded as licence_escalated before anything is decided,
// and Extreme approval never approves a licence outside the list.
import { LICENCE_NOT_ALLOWED, LICENCE_UNKNOWN } from "@gatehouse/policy"
import { describe, expect, it, vi } from "vitest"
import { createCanUseTool, type CanUseDeps } from "../src/canuse.js"

function setup(ruleId: string, auditOk = true) {
  const records: Array<{ event?: string; verdict: { decidedBy: string; outcome: string; ruleId: string } }> = []
  const request = vi.fn(async (_r: unknown) => ({ outcome: "deny", channel: "desktop", waitedMs: 1 }))
  const deps = {
    sessionId: "s1",
    cwd: "C:/p",
    project: "proj",
    approver: {
      evaluate: async () => ({
        outcome: "escalate",
        ruleId,
        reason: "It adds gpl-thing (npm), whose licence is GPL-3.0.",
        risk: 82,
        decidedBy: "rules",
        policyHash: "h",
      }),
    },
    broker: { request },
    audit: {
      record: async (r: (typeof records)[number]) => {
        records.push(r)
        return auditOk
      },
    },
    kill: () => false,
    policy: () => undefined,
    engine: {},
    pwsh: undefined,
    decided: new Set<string>(),
    extreme: () => true,
    notifyAutoApproved: () => undefined,
    log: () => undefined,
  } as unknown as CanUseDeps
  const canUse = createCanUseTool(deps)
  const call = () =>
    canUse("Bash", { command: "npm install gpl-thing" }, { toolUseID: "t1", signal: new AbortController().signal } as never)
  return { call, records, request }
}

describe("licence policy in canUseTool (D-055)", () => {
  it("records licence_escalated, and Extreme approval approves a licence outside the list, saying so (owner, 14 Nov)", async () => {
    const t = setup(LICENCE_NOT_ALLOWED)
    expect((await t.call())?.behavior).toBe("allow")
    expect(t.records[0]).toMatchObject({ event: "licence_escalated", verdict: { ruleId: LICENCE_NOT_ALLOWED } })
    expect(t.request).not.toHaveBeenCalled()
    expect(t.records[1]?.verdict).toMatchObject({ decidedBy: "extreme-mode", outcome: "allow" })
    // An unreadable licence is recorded too, and approved the same way.
    const u = setup(LICENCE_UNKNOWN)
    expect((await u.call())?.behavior).toBe("allow")
    expect(u.records.map((r) => r.event)).toEqual(["licence_escalated", "human_decision"])
    expect(u.records[1]?.verdict).toMatchObject({ decidedBy: "extreme-mode", outcome: "allow" })
  })

  it("does not go on when licence_escalated cannot be recorded", async () => {
    const t = setup(LICENCE_UNKNOWN, false)
    expect((await t.call())?.behavior).toBe("deny")
    expect(t.request).not.toHaveBeenCalled()
  })
})
