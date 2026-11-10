// D-001, the test integrity guard, in canUseTool: a weakening of the tests is recorded with its pattern before it is
// decided; outside Extreme approval it goes to a person; in Extreme approval it is approved and flagged by default,
// and waits for a person when the project is strict.
import { describe, expect, it, vi } from "vitest"
import { createCanUseTool, STRICT_TESTS_ASKS, type CanUseDeps } from "../src/canuse.js"
import { strictAboutTests } from "../src/sessions.js"

const weakening = {
  outcome: "escalate" as const,
  ruleId: "test-integrity-skip-added",
  reason: "It marks tests in math.test.ts to be skipped, or to run alone.",
  risk: 70,
  decidedBy: "rules" as const,
  policyHash: "h",
}

function setup(o: { extreme: boolean; strict?: boolean; recordFails?: boolean }) {
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
    strictTests: () => o.strict === true,
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
  it("records the pattern before deciding, and sends a weakening to a person outside Extreme approval", async () => {
    const t = setup({ extreme: false })
    expect((await t.call())?.behavior).toBe("deny")
    expect(t.request).toHaveBeenCalledOnce()
    expect(t.records[0]).toMatchObject({ event: "test_integrity_escalated", input: { pattern: "skip-added" } })
  })

  it("in Extreme approval, approves a weakening and flags the session, by default", async () => {
    const t = setup({ extreme: true })
    expect((await t.call())?.behavior).toBe("allow")
    expect(t.request).not.toHaveBeenCalled()
    expect(t.flagged).toEqual(["skip-added"])
    expect(t.records.map((r) => r.event)).toEqual(["test_integrity_escalated", "human_decision"])
  })

  it("in Extreme approval, waits for a person when the project is strict", async () => {
    const t = setup({ extreme: true, strict: true })
    expect((await t.call())?.behavior).toBe("deny")
    expect(t.request).toHaveBeenCalledOnce()
    expect(JSON.stringify(t.request.mock.calls[0])).toContain(STRICT_TESTS_ASKS.slice(0, 40))
    expect(t.flagged).toEqual([])
  })

  it("is refused when the weakening cannot be recorded", async () => {
    const t = setup({ extreme: true, recordFails: true })
    expect((await t.call())?.behavior).toBe("deny")
    expect(t.request).not.toHaveBeenCalled()
    expect(t.flagged).toEqual([])
  })

  it("is strict for the projects named, by folder name in any case, or for every project", () => {
    expect(strictAboutTests(undefined, "gatehouse")).toBe(false)
    expect(strictAboutTests({ strictProjects: ["Gatehouse"] }, "gatehouse")).toBe(true)
    expect(strictAboutTests({ strictProjects: ["other"] }, "gatehouse")).toBe(false)
    expect(strictAboutTests({ strictAll: true }, "anything")).toBe(true)
  })
})
