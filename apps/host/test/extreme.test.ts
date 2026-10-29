import { describe, expect, it, vi } from "vitest"
import {
  createCanUseTool,
  EXTREME_CANNOT_APPROVE,
  NEVER_AUTO_APPROVED,
  type CanUseDeps,
} from "../src/canuse.js"

const verdict = (outcome: "allow" | "deny" | "escalate", ruleId: string) => ({
  outcome,
  ruleId,
  reason: "because",
  risk: 60,
  decidedBy: "rules" as const,
  policyHash: "h",
})

function setup(opts: { extreme: boolean; v: ReturnType<typeof verdict>; auditOk?: boolean }) {
  const records: Array<{ verdict: { decidedBy: string; outcome: string }; input: unknown }> = []
  const request = vi.fn(async (_r: unknown) => ({ outcome: "deny", channel: "desktop", waitedMs: 1 }))
  const notified: Array<[string, string]> = []
  const deps = {
    sessionId: "s1",
    cwd: "C:/p",
    project: "proj",
    approver: { evaluate: async () => opts.v },
    broker: { request },
    audit: {
      record: async (r: (typeof records)[number]) => {
        records.push(r)
        return opts.auditOk ?? true
      },
    },
    kill: () => false,
    policy: () => undefined,
    engine: {},
    pwsh: undefined,
    decided: new Set<string>(),
    extreme: () => opts.extreme,
    notifyAutoApproved: (tool: string, project: string) => notified.push([tool, project]),
    log: () => undefined,
  } as unknown as CanUseDeps
  const canUse = createCanUseTool(deps)
  const call = (tool = "Bash", input: Record<string, unknown> = { command: "npm install x" }) =>
    canUse(tool, input, {
      toolUseID: "t1",
      signal: new AbortController().signal,
    } as never)
  return { call, records, request, notified }
}

describe("Extreme approval mode", () => {
  it("approves what would have waited, audits it first, and tells the phone without the input", async () => {
    const t = setup({ extreme: true, v: verdict("escalate", "no-rule") })
    const r = await t.call()
    expect(r?.behavior).toBe("allow")
    expect(t.request).not.toHaveBeenCalled()
    expect(t.records).toHaveLength(1)
    expect(t.records[0]?.verdict).toMatchObject({ decidedBy: "extreme-mode", outcome: "allow" })
    expect(t.notified).toEqual([["Bash", "proj"]])
    expect(JSON.stringify(t.notified)).not.toContain("npm install")
  })

  it("asks as usual when the mode is off", async () => {
    const t = setup({ extreme: false, v: verdict("escalate", "no-rule") })
    const r = await t.call()
    expect(t.request).toHaveBeenCalledTimes(1)
    expect(r?.behavior).toBe("deny")
    expect(t.notified).toEqual([])
  })

  it("never turns a deny into an allow", async () => {
    const t = setup({ extreme: true, v: verdict("deny", "destructive-shell") })
    expect((await t.call())?.behavior).toBe("deny")
    expect(t.notified).toEqual([])
  })

  it("never approves an escalation that came from a failure", async () => {
    for (const id of NEVER_AUTO_APPROVED) {
      const t = setup({ extreme: true, v: verdict("escalate", id) })
      await t.call()
      expect(t.request, id).toHaveBeenCalledTimes(1)
      expect(t.notified, id).toEqual([])
      // The card says why Extreme approval did not approve it.
      expect(t.request.mock.calls[0]?.[0], id).toMatchObject({
        verdict: { ruleId: id, reason: `because ${EXTREME_CANNOT_APPROVE}` },
      })
    }
    expect(NEVER_AUTO_APPROVED.has("evaluator-unavailable")).toBe(true)
    expect(NEVER_AUTO_APPROVED.has("audit-failure")).toBe(true)
  })

  it("does not approve when the decision cannot be recorded", async () => {
    const t = setup({ extreme: true, v: verdict("escalate", "no-rule"), auditOk: false })
    const r = await t.call()
    expect(r?.behavior).toBe("deny")
    expect(t.notified).toEqual([])
  })

  it("still waits for you on questions from Claude", async () => {
    const t = setup({ extreme: true, v: verdict("escalate", "no-rule") })
    await t.call("AskUserQuestion", { questions: [] })
    expect(t.request).toHaveBeenCalledTimes(1)
  })
})
