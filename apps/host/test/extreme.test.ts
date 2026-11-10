import { LOCKED_TEST_RULE } from "../src/test-locks.js"
import { INSTALLER_RULE } from "@gatehouse/policy"
import { describe, expect, it, vi } from "vitest"
import {
  CANNOT_UNDO_ASKS,
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

  it("never approves an escalation that came from a failure", async () => {
    for (const id of NEVER_AUTO_APPROVED) {
      const t = setup({ extreme: true, v: verdict("escalate", id) })
      await t.call()
      expect(t.request, id).toHaveBeenCalledTimes(1)
      expect(t.notified, id).toEqual([])
      // The card says why Extreme approval did not approve it.
      expect(t.request.mock.calls[0]?.[0], id).toMatchObject({
        // D-007: a locked test's own reason already says Extreme approval does not approve it.
        verdict: { ruleId: id, reason: id === LOCKED_TEST_RULE || id === INSTALLER_RULE ? "because" : `because ${EXTREME_CANNOT_APPROVE}` },
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

  it("never approves by itself what cannot be undone, and the card shows what would go (G20)", async () => {
    const t = setup({ extreme: true, v: verdict("escalate", "no-rule"), effects: async () => lost })
    await t.call("Bash", { command: "rm a.txt b.txt" })
    expect(t.request).toHaveBeenCalledTimes(1)
    expect(t.notified).toEqual([])
    expect(t.request.mock.calls[0]?.[0]).toMatchObject({
      effects: lost,
      verdict: { reason: `because ${CANNOT_UNDO_ASKS}` },
    })
    // What git can bring back is still approved, with nothing shown that is not there.
    const back = setup({
      extreme: true,
      v: verdict("escalate", "no-rule"),
      effects: async () => ({ ...lost, reversible: true }),
    })
    expect((await back.call("Bash", { command: "rm a.txt" }))?.behavior).toBe("allow")
  })

  it("takes a failure working out the effects of a command as cannot be undone (G20)", async () => {
    const t = setup({
      extreme: true,
      v: verdict("escalate", "no-rule"),
      effects: async () => {
        throw new Error("no")
      },
    })
    await t.call("Bash", { command: "rm -rf x" })
    expect(t.request).toHaveBeenCalledTimes(1)
    expect(t.request.mock.calls[0]?.[0]).toMatchObject({ effects: { reversible: false } })
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
