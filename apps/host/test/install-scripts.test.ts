// D-064, install-script default deny in canUseTool: "Run without scripts" is an edited input, checked again before it
// runs, and it runs with --ignore-scripts; Extreme approval leaves an install that runs scripts to you.
import { INSTALL_SCRIPTS_RULE, withoutScripts } from "@gatehouse/policy"
import { describe, expect, it, vi } from "vitest"
import { createCanUseTool, type CanUseDeps } from "../src/canuse.js"

const COMMAND = "npm install left-pad && npm test"
const escalated = {
  outcome: "escalate",
  ruleId: INSTALL_SCRIPTS_RULE,
  reason: 'This install would run install scripts with your rights: left-pad postinstall: "node steal.js".',
  risk: 78,
  decidedBy: "rules",
  policyHash: "h",
  withoutScripts: withoutScripts(COMMAND),
}

function setup(o: { extreme?: boolean; edited?: "allow" | "deny" }) {
  const evaluated: Array<Record<string, unknown>> = []
  const evaluate = vi.fn(async (call: { input: Record<string, unknown> }) => {
    evaluated.push(call.input)
    if (evaluated.length === 1) return escalated
    return o.edited === "deny"
      ? { outcome: "deny", ruleId: "destructive-shell", reason: "no", risk: 100, decidedBy: "rules", policyHash: "h" }
      : { outcome: "escalate", ruleId: "package-install", reason: "asks", risk: 60, decidedBy: "rules", policyHash: "h" }
  })
  // The person chooses Run without scripts: the card sends the verdict's command as the edited input.
  const request = vi.fn(async (r: { verdict: { withoutScripts?: string } }) => ({
    outcome: "allow",
    channel: "desktop",
    waitedMs: 1,
    updatedInput: { command: r.verdict.withoutScripts },
  }))
  const deps = {
    sessionId: "s1",
    cwd: "C:/p",
    project: "proj",
    approver: { evaluate },
    broker: { request },
    audit: { record: async () => true },
    kill: () => false,
    policy: () => undefined,
    engine: {},
    pwsh: undefined,
    decided: new Set<string>(),
    extreme: () => o.extreme === true,
    notifyAutoApproved: () => undefined,
    log: () => undefined,
  } as unknown as CanUseDeps
  const call = () =>
    createCanUseTool(deps)("Bash", { command: COMMAND }, { toolUseID: "t1", signal: new AbortController().signal } as never)
  return { call, evaluated, request }
}

describe("install-script default deny in canUseTool (D-064)", () => {
  it("re-checks Run without scripts and runs it with --ignore-scripts, never rewriting by itself", async () => {
    expect(withoutScripts(COMMAND)).toBe("npm install --ignore-scripts left-pad && npm test")
    const t = setup({})
    const r = await t.call()
    // It went to a person.
    expect(t.request).toHaveBeenCalledTimes(1)
    // The person's choice was checked again, as an edited input.
    expect(t.evaluated).toEqual([{ command: COMMAND }, { command: "npm install --ignore-scripts left-pad && npm test" }])
    expect(r).toMatchObject({ behavior: "allow", updatedInput: { command: "npm install --ignore-scripts left-pad && npm test" } })
  })

  it("blocks it when the check of the changed command denies", async () => {
    const t = setup({ edited: "deny" })
    expect((await t.call())?.behavior).toBe("deny")
  })
})
