// D-001, the test integrity guard, in canUseTool: a weakening of the tests is recorded with its pattern before it is
// decided; outside Max approval it goes to a person; in Max approval it is approved and the session flagged (O45: no
// project is strict about it any more).
import { describe, expect, it, vi } from "vitest"
import { createCanUseTool, type CanUseDeps } from "../src/canuse.js"

const weakening = {
  outcome: "escalate" as const,
  ruleId: "test-integrity-skip-added",
  reason: "It marks tests in math.test.ts to be skipped, or to run alone.",
  risk: 70,
  decidedBy: "rules" as const,
  policyHash: "h",
}

function setup(o: { extreme: boolean; recordFails?: boolean }) {
  const records: Array<Record<string, unknown>> = []
  const request = vi.fn(async () => ({ outcome: "deny", channel: "desktop", waitedMs: 1 }))
  const flagged: string[] = []
  const deps = {
    sessionId: "s1",
    cwd: "C:/p",
    project: "p",
    approver: { evaluate: async () => weakening },
    broker: { request },
    audit: {
      record: async (r: Record<string, unknown>) => {
        records.push(r)
        return !(o.recordFails && r.event === "test_integrity_escalated")
      },
    },
    kill: () => false,
    policy: () => undefined,
    engine: {},
    pwsh: undefined,
    decided: new Set<string>(),
    extreme: () => o.extreme,
    onTestsWeakened: (pattern: string) => flagged.push(pattern),
    effects: async () => undefined,
    log: () => undefined,
  } as unknown as CanUseDeps
  const call = () =>
    createCanUseTool(deps)("Edit", { file_path: "C:/p/tests/math.test.ts" }, {
      toolUseID: "t1",
      signal: new AbortController().signal,
    } as never)
  return { call, records, request, flagged }
}

describe("the test integrity guard in canUseTool (D-001)", () => {
  it("records the pattern before deciding, and sends a weakening to a person outside Max approval", async () => {
    const t = setup({ extreme: false })
    expect((await t.call())?.behavior).toBe("deny")
    expect(t.request).toHaveBeenCalledOnce()
    expect(t.records[0]).toMatchObject({ event: "test_integrity_escalated", input: { pattern: "skip-added" } })
  })

  it("in Max approval, approves a weakening and flags the session", async () => {
    const t = setup({ extreme: true })
    expect((await t.call())?.behavior).toBe("allow")
    expect(t.request).not.toHaveBeenCalled()
    expect(t.flagged).toEqual(["skip-added"])
    expect(t.records.map((r) => r.event)).toEqual(["test_integrity_escalated", "human_decision"])
  })

  it("is refused when the weakening cannot be recorded", async () => {
    const t = setup({ extreme: true, recordFails: true })
    expect((await t.call())?.behavior).toBe("deny")
    expect(t.request).not.toHaveBeenCalled()
    expect(t.flagged).toEqual([])
  })
})
