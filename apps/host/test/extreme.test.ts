import { LOCKED_TEST_RULE } from "../src/test-locks.js"
import { describe, expect, it, vi } from "vitest"
import {
  createCanUseTool,
  EXTREME_ASKS,
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

const lost = {
  kind: "delete" as const,
  count: 2,
  paths: ["a.txt", "b.txt"],
  more: false,
  reversible: false,
  undo: "Cannot be undone.",
}

function setup(opts: {
  extreme: boolean
  v:
    | ReturnType<typeof verdict>
    | (Omit<ReturnType<typeof verdict>, "decidedBy"> & { decidedBy: "judge" })
  auditOk?: boolean
  effects?: CanUseDeps["effects"]
}) {
  const records: Array<{ verdict: { decidedBy: string; outcome: string }; input: unknown }> = []
  const request = vi.fn(async (_r: unknown) => ({
    outcome: "deny",
    channel: "desktop",
    waitedMs: 1,
  }))
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
    ...(opts.effects ? { effects: opts.effects } : {}),
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

  it("never approves an escalation that came from a failure, nor a locked test", async () => {
    for (const id of EXTREME_ASKS) {
      const t = setup({ extreme: true, v: verdict("escalate", id) })
      await t.call()
      expect(t.request, id).toHaveBeenCalledTimes(1)
      expect(t.notified, id).toEqual([])
      // The card says why Extreme approval did not approve it; a locked test's own reason already says so.
      expect(t.request.mock.calls[0]?.[0], id).toMatchObject({
        verdict: { ruleId: id, reason: id === LOCKED_TEST_RULE ? "because" : `because ${EXTREME_CANNOT_APPROVE}` },
      })
    }
    expect(EXTREME_ASKS.has("evaluator-unavailable")).toBe(true)
    expect(EXTREME_ASKS.has("audit-failure")).toBe(true)
  })

  it("approves every escalation a rule made, whatever its risk, as the owner asked (14 Nov)", async () => {
    // "When I have extreme approval on I shouldnt be asked to approve any risks even if they are 100."
    for (const id of [...NEVER_AUTO_APPROVED].filter((x) => !EXTREME_ASKS.has(x))) {
      const t = setup({ extreme: true, v: { ...verdict("escalate", id), risk: 100 } })
      expect((await t.call())?.behavior, id).toBe("allow")
      expect(t.request, id).not.toHaveBeenCalled()
    }
  })

  it("does not approve when the decision cannot be recorded", async () => {
    const t = setup({ extreme: true, v: verdict("escalate", "no-rule"), auditOk: false })
    const r = await t.call()
    expect(r?.behavior).toBe("deny")
    expect(t.notified).toEqual([])
  })

  it("approves what cannot be undone too, in Extreme approval (owner, 14 Nov), and shows what would go in Manual (G20)", async () => {
    const t = setup({ extreme: true, v: verdict("escalate", "no-rule"), effects: async () => lost })
    expect((await t.call("Bash", { command: "rm a.txt b.txt" }))?.behavior).toBe("allow")
    expect(t.request).not.toHaveBeenCalled()
    const manual = setup({ extreme: false, v: verdict("escalate", "no-rule"), effects: async () => lost })
    await manual.call("Bash", { command: "rm a.txt b.txt" })
    expect(manual.request.mock.calls[0]?.[0]).toMatchObject({ effects: lost })
  })

  it("does not let the judge allow what cannot be undone (G20)", async () => {
    const judged = { ...verdict("allow", "network"), decidedBy: "judge" as const }
    const t = setup({ extreme: false, v: judged, effects: async () => lost })
    await t.call("Bash", { command: "curl x && rm a.txt" })
    expect(t.request).toHaveBeenCalledTimes(1)
    expect(t.request.mock.calls[0]?.[0]).toMatchObject({
      effects: lost,
      verdict: { outcome: "escalate", decidedBy: "judge" },
    })
    const fine = setup({ extreme: false, v: judged, effects: async () => undefined })
    expect((await fine.call())?.behavior).toBe("allow")
  })

  it("still waits for you on questions from Claude", async () => {
    const t = setup({ extreme: true, v: verdict("escalate", "no-rule") })
    await t.call("AskUserQuestion", { questions: [] })
    expect(t.request).toHaveBeenCalledTimes(1)
  })
})
