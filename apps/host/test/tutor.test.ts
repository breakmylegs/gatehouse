// E-072: in tutor mode an agent Write to a source file is denied (in canUseTool and in the floor hook, in every mode),
// tests can still be written and run, other commands go to you, and the session is told to give hints.
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { describe, expect, it, vi } from "vitest"
import { loadPolicy } from "@gatehouse/policy"
import { createCanUseTool, type CanUseDeps } from "../src/canuse.js"
import { createFloorHook } from "../src/hooks.js"
import { isTestFile, isTestRun, tutorOverlay, tutorPrompt, TUTOR_COMMAND_RULE, TUTOR_EDIT_RULE } from "../src/tutor.js"

const root = fs.mkdtempSync(path.join(os.tmpdir(), "codeh-tutor-"))

function canUse(tutor: boolean) {
  const request = vi.fn(async () => ({ outcome: "deny", channel: "desktop", waitedMs: 1 }))
  const records: Array<{ verdict: { outcome: string; ruleId: string } }> = []
  const c = createCanUseTool({
    sessionId: "s1", cwd: root, project: "p", projectRoot: root,
    approver: { evaluate: async () => ({ outcome: "allow", ruleId: "edit-workspace-source", reason: "ok", risk: 10, decidedBy: "rules", policyHash: "h" }) },
    broker: { request }, audit: { record: async (r: never) => (records.push(r), true) }, kill: () => false, policy: () => undefined, engine: {}, pwsh: undefined,
    decided: new Set<string>(), extreme: () => false, effects: async () => undefined, log: () => undefined,
    ...(tutor ? { tutor: () => true } : {}),
  } as unknown as CanUseDeps)
  return { call: (tool: string, input: Record<string, unknown>) => c(tool, input, { toolUseID: "t", signal: new AbortController().signal } as never), request, records }
}

describe("tutor mode", () => {
  it("denies an agent Write to a source file, and lets it write a test", async () => {
    const t = canUse(true)
    const r = await t.call("Write", { file_path: path.join(root, "src", "invoice.ts"), content: "x" })
    expect(r).toMatchObject({ behavior: "deny", message: expect.stringMatching(/Tutor mode: the agent may write tests, not src[\\/]invoice\.ts/) })
    expect(JSON.stringify(t.records)).toContain(TUTOR_EDIT_RULE)
    expect(t.request).not.toHaveBeenCalled()
    expect((await t.call("Write", { file_path: path.join(root, "test", "invoice.test.ts"), content: "x" }))?.behavior).toBe("allow")
    // Outside tutor mode the same write is the rules' to decide.
    expect((await canUse(false).call("Write", { file_path: path.join(root, "src", "invoice.ts"), content: "x" }))?.behavior).toBe("allow")
  })

  it("lets the tests run, and sends any other command to you", async () => {
    const t = canUse(true)
    expect((await t.call("Bash", { command: "npm test" }))?.behavior).toBe("allow")
    expect((await t.call("Bash", { command: "npm test && echo done > out.txt" }))?.behavior).toBe("deny")
    expect(t.request).toHaveBeenCalledWith(expect.objectContaining({ verdict: expect.objectContaining({ ruleId: TUTOR_COMMAND_RULE }) }))
    expect(isTestRun("npx vitest run src/a.test.ts")).toBe(true)
    expect(isTestRun("pytest -k invoice")).toBe(true)
    expect(isTestRun("sed -i s/a/b/ src/a.ts")).toBe(false)
    expect(isTestRun("npm test; rm -rf src")).toBe(false)
  })

  it("is refused by the floor hook too, so Auto and Accept edits cannot let it through", async () => {
    const policy = loadPolicy({ rulesPath: path.resolve(import.meta.dirname, "../../../policy/rules.yaml") })
    const records: unknown[] = []
    for (const mode of ["auto", "acceptEdits", "default"]) {
      const hook = createFloorHook({
        sessionId: "s", cwd: root, policy: () => policy, pwsh: undefined, audit: { record: async (r: unknown) => (records.push(r), true) } as never, kill: () => false,
        decided: new Set<string>(), onEvent: () => undefined, log: () => undefined, mode: () => mode, scanCommits: false,
        approver: { evaluate: async () => ({ outcome: "allow", ruleId: "edit-workspace-source", reason: "ok", risk: 10, decidedBy: "rules", policyHash: "h" }) },
        verdicts: new Map(), projectRoot: root, tutor: () => true,
      })
      const out = (await hook({ hook_event_name: "PreToolUse", tool_name: "Edit", tool_input: { file_path: path.join(root, "src", "a.ts"), old_string: "a", new_string: "b" }, tool_use_id: "t", cwd: root, session_id: "x" } as never, "t", { signal: new AbortController().signal })) as {
        hookSpecificOutput?: { permissionDecision?: string; permissionDecisionReason?: string }
      }
      expect(out.hookSpecificOutput, mode).toMatchObject({ permissionDecision: "deny", permissionDecisionReason: expect.stringMatching(/Tutor mode/) })
    }
    expect(records).toHaveLength(3)
    expect(records[0]).toMatchObject({ event: "floor_deny", verdict: { ruleId: TUTOR_EDIT_RULE } })
  })

  it("tells the session to give hints, and knows a test file", () => {
    const p = tutorPrompt("how the invoice totals are worked out")
    expect(p).toMatch(/give hints/)
    expect(p).toMatch(/Do not change source files/)
    expect(p).toContain("how the invoice totals are worked out")
    for (const f of ["src/a.test.ts", "tests/test_x.py", "pkg/x_test.go", "Billing.Tests/InvoiceTests.cs", "src/__tests__/a.tsx"]) expect(isTestFile(f), f).toBe(true)
    for (const f of ["src/a.ts", "src/testing-utils.ts", "README.md"]) expect(isTestFile(f), f).toBe(false)
    expect(tutorOverlay("Read", { file_path: "src/a.ts" }, root)).toBeUndefined()
  })
})
