import { LOCKED_TEST_RULE } from "../src/test-locks.js"
import { HANDOFF_RULE, HANDOFF_TOOL } from "../src/about-session.js"
import { describe, expect, it, vi } from "vitest"
import {
  createCanUseTool,
  EXTREME_ASKS,
  EXTREME_CANNOT_APPROVE,
  HANDOFF_ASKS,
  MAX_ASKS,
  NEVER_AUTO_APPROVED,
  overLimit,
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
  /** O36: Extreme max approval, or the Rules-based limit. */
  max?: boolean
  limit?: number
  strict?: boolean
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
    extremeLevel: () => ({ max: opts.max === true, limit: opts.limit ?? 80 }),
    ...(opts.strict ? { strictTests: () => true } : {}),
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
        verdict: {
          ruleId: id,
          reason:
            id === LOCKED_TEST_RULE
              ? "because"
              : id === HANDOFF_RULE
                ? `because ${HANDOFF_ASKS}`
                : `because ${EXTREME_CANNOT_APPROVE}`,
        },
      })
    }
    expect(EXTREME_ASKS.has("evaluator-unavailable")).toBe(true)
    expect(EXTREME_ASKS.has("audit-failure")).toBe(true)
    // O34 (owner, 14 Nov): a chat's prompt for a code session is always your own approval.
    expect(EXTREME_ASKS.has(HANDOFF_RULE)).toBe(true)
  })

  it("sends a chat's prompt for its code session to you whatever the rules said, in Extreme approval too (O34)", async () => {
    for (const v of [verdict("allow", "some-remembered-rule"), verdict("escalate", "no-rule")]) {
      const t = setup({ extreme: true, v })
      await t.call(HANDOFF_TOOL, { prompt: "Fix it" })
      expect(t.request, v.ruleId).toHaveBeenCalledTimes(1)
      expect(t.request.mock.calls[0]?.[0], v.ruleId).toMatchObject({ verdict: { ruleId: HANDOFF_RULE, risk: 85 } })
    }
    const denied = setup({ extreme: true, v: verdict("deny", "chat-no-shell") })
    expect((await denied.call(HANDOFF_TOOL, { prompt: "Fix it" }))?.behavior).toBe("deny")
  })

  it("Rules-based answers what a rule holds below the risk limit, and asks at or above it (owner, 15 Nov)", async () => {
    for (const id of [...NEVER_AUTO_APPROVED].filter((x) => !EXTREME_ASKS.has(x))) {
      const low = setup({ extreme: true, v: { ...verdict("escalate", id), risk: 79 } })
      expect((await low.call())?.behavior, id).toBe("allow")
      const high = setup({ extreme: true, v: { ...verdict("escalate", id), risk: 80 } })
      await high.call()
      expect(high.request, id).toHaveBeenCalledTimes(1)
      expect(high.request.mock.calls[0]?.[0], id).toMatchObject({ verdict: { reason: `because ${overLimit(80)}` } })
    }
    // The limit is the one in Settings; 101 means never on risk.
    const at90 = setup({ extreme: true, limit: 90, v: { ...verdict("escalate", "git-remote"), risk: 85 } })
    expect((await at90.call())?.behavior).toBe("allow")
    const never = setup({ extreme: true, limit: 101, v: { ...verdict("escalate", "git-remote"), risk: 100 } })
    expect((await never.call())?.behavior).toBe("allow")
  })

  it("Max answers every request a rule makes, whatever its risk, locked and strict tests too (owner, 15 Nov)", async () => {
    // "Extreme Max Approval mode which doesnt use any rules and approves everything."
    for (const id of [...NEVER_AUTO_APPROVED, LOCKED_TEST_RULE, "no-rule"].filter((x) => !MAX_ASKS.has(x))) {
      const t = setup({ extreme: true, max: true, strict: true, v: { ...verdict("escalate", id), risk: 100 } })
      expect((await t.call())?.behavior, id).toBe("allow")
      expect(t.request, id).not.toHaveBeenCalled()
    }
    const strict = setup({ extreme: true, max: true, strict: true, v: verdict("escalate", "test-integrity-assertion-removed") })
    expect((await strict.call())?.behavior).toBe("allow")
  })

  it("Max still waits for a failure and a chat's hand-off, and a floor deny stays a deny", async () => {
    for (const id of MAX_ASKS) {
      const t = setup({ extreme: true, max: true, v: verdict("escalate", id) })
      await t.call()
      expect(t.request, id).toHaveBeenCalledTimes(1)
    }
    expect(MAX_ASKS.has("evaluator-unavailable")).toBe(true)
    expect(MAX_ASKS.has(HANDOFF_RULE)).toBe(true)
    expect(MAX_ASKS.has(LOCKED_TEST_RULE)).toBe(false)
    const deny = setup({ extreme: true, max: true, v: verdict("deny", "secrets-files") })
    expect((await deny.call())?.behavior).toBe("deny")
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
