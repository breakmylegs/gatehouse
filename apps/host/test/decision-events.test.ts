import { describe, expect, it, vi } from "vitest"
import { createCanUseTool, type CanUseDeps } from "../src/canuse.js"

const verdict = (outcome: "allow" | "deny" | "escalate", ruleId: string) => ({
  outcome,
  ruleId,
  reason: "Reading files inside this project.",
  risk: 5,
  decidedBy: "rules" as const,
  policyHash: "h",
})

function setup(v: ReturnType<typeof verdict>, early?: ReturnType<typeof verdict>) {
  const told: Array<[string, unknown]> = []
  const evaluate = vi.fn(async () => v)
  const deps = {
    sessionId: "s1",
    cwd: "C:/p",
    project: "proj",
    approver: { evaluate },
    broker: { request: async () => ({ outcome: "deny", channel: "desktop", waitedMs: 1 }) },
    audit: { record: async () => true },
    kill: () => false,
    policy: () => undefined,
    engine: {},
    pwsh: undefined,
    decided: new Set<string>(),
    verdicts: new Map(early ? [["t1", early]] : []),
    onDecision: (toolUseId: string, d: unknown) => told.push([toolUseId, d]),
    log: () => undefined,
  } as unknown as CanUseDeps
  const canUse = createCanUseTool(deps)
  const call = () =>
    canUse("Read", { file_path: "C:/p/a.ts" }, {
      toolUseID: "t1",
      signal: new AbortController().signal,
    } as never)
  return { call, told, evaluate }
}

describe("each tool call's decision reaches the screen", () => {
  it("tells the screen what the rules decided, allow or deny, with the reason", async () => {
    for (const outcome of ["allow", "deny"] as const) {
      const t = setup(verdict(outcome, "read-workspace"))
      expect((await t.call())?.behavior).toBe(outcome)
      expect(t.told).toEqual([
        ["t1", expect.objectContaining({ outcome, ruleId: "read-workspace", decidedBy: "rules" })],
      ])
    }
  })

  it("tells it the question too, before a person answers", async () => {
    const t = setup(verdict("escalate", "git-push"))
    await t.call()
    expect(t.told[0]).toEqual(["t1", expect.objectContaining({ outcome: "escalate" })])
  })

  it("says nothing more when the floor hook already said it, and asks the Approver once", async () => {
    const t = setup(verdict("deny", "never"), verdict("allow", "read-workspace"))
    expect((await t.call())?.behavior).toBe("allow")
    expect(t.evaluate).not.toHaveBeenCalled()
    expect(t.told).toEqual([])
  })
})
