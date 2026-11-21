// D-023: in Auto and Accept edits, the plan (or you) sets a lease of paths and command families; anything outside it
// is asked, by the floor hook and by canUseTool, whatever the rules would allow.
import path from "node:path"
import { describe, expect, it, vi } from "vitest"
import { loadPolicy } from "@gatehouse/policy"
import { createCanUseTool, type CanUseDeps } from "../src/canuse.js"
import { createFloorHook } from "../src/hooks.js"
import { cleanLease, leaseFromPlan, outsideLease, SCOPE_LEASE_RULE, type ScopeLease } from "../src/scope-lease.js"

const root = path.resolve("/work/shop")
const lease: ScopeLease = { paths: ["src/**", "test/**"], commands: ["npm", "git"], from: "plan", at: "2026-11-21T00:00:00Z" }
const out = (tool: string, input: Record<string, unknown>) => outsideLease(lease, root, root, tool, input)

describe("what is outside a lease", () => {
  it("asks about a write outside its paths, or outside the project, and not one inside", () => {
    expect(out("Write", { file_path: "src/cart.ts" })).toBeUndefined()
    expect(out("Edit", { file_path: path.join(root, "test", "cart.test.ts") })).toBeUndefined()
    expect(out("Write", { file_path: "package.json" })).toMatch(/writes package\.json, outside the paths/)
    expect(out("Write", { file_path: "../other/x.ts" })).toMatch(/outside the paths/)
    expect(out("Read", { file_path: "package.json" })).toBeUndefined()
  })

  it("asks about a command whose family it does not name, a redirect outside its paths, but not a read-only command", () => {
    expect(out("Bash", { command: "npm test && git status" })).toBeUndefined()
    expect(out("Bash", { command: "ls src; cat package.json | grep name" })).toBeUndefined()
    expect(out("Bash", { command: "npm test && curl https://example.test" })).toMatch(/runs curl/)
    expect(out("PowerShell", { command: "Remove-Item dist -Recurse" })).toMatch(/runs remove-item/)
    expect(out("Bash", { command: "FOO=1 npm run build > src/out.txt" })).toBeUndefined()
    expect(out("Bash", { command: "npm run build > dist/out.txt" })).toMatch(/overwrites dist\/out\.txt/)
  })
})

describe("a lease from a plan", () => {
  it("takes the folders of the files and folders it names, and the command families of its code spans", () => {
    const plan = [
      "1. Add the discount to `src/cart/total.ts` and its test in test/cart/",
      "2. Update docs/pricing.md",
      "3. Run `npm test` then `git commit -m done`; see https://example.test/a/b for why",
      "4. Never touch ../secrets/x.ts or `rm -rf /`",
    ].join("\n")
    expect(leaseFromPlan(plan, new Date("2026-11-21T00:00:00Z"))).toEqual({
      paths: ["docs/**", "src/cart/**", "test/cart/**"],
      commands: ["git", "npm"],
      from: "plan",
      at: "2026-11-21T00:00:00.000Z",
    })
    expect(leaseFromPlan("Think about it and report back.")).toBeUndefined()
  })

  it("takes a lease from the desktop only as globs inside the project and one-word commands", () => {
    expect(cleanLease(["src/**", " src/** "], ["NPM"])).toMatchObject({ paths: ["src/**"], commands: ["npm"], from: "you" })
    expect(cleanLease([], [])).toMatch(/at least one path/)
    expect(cleanLease(["../x/**"], [])).toMatch(/inside the project/)
    expect(cleanLease(["C:/Windows/**"], [])).toMatch(/inside the project/)
    expect(cleanLease(["src/**"], ["npm run"])).toMatch(/one word/)
  })
})

describe("the floor hook and the lease", () => {
  const policy = loadPolicy({ rulesPath: path.resolve(import.meta.dirname, "../../../policy/rules.yaml") })
  const hookFor = (mode: string, current: ScopeLease | undefined) =>
    createFloorHook({
      sessionId: "s",
      cwd: root,
      policy: () => policy,
      pwsh: undefined,
      audit: { record: async () => true } as never,
      kill: () => false,
      decided: new Set<string>(),
      onEvent: () => undefined,
      log: () => undefined,
      mode: () => mode,
      lease: () => current,
      scanCommits: false,
      approver: { evaluate: async () => ({ outcome: "allow", ruleId: "edit-workspace-source", reason: "ok", risk: 10, decidedBy: "rules", policyHash: "h" }) },
      verdicts: new Map(),
    })
  const decide = async (mode: string, current: ScopeLease | undefined, file: string) =>
    (
      (await hookFor(mode, current)(
        { hook_event_name: "PreToolUse", tool_name: "Write", tool_input: { file_path: file, content: "x" }, tool_use_id: "t", cwd: root, session_id: "x" } as never,
        "t",
        { signal: new AbortController().signal },
      )) as { hookSpecificOutput?: { permissionDecision?: string; permissionDecisionReason?: string } }
    ).hookSpecificOutput

  it("asks about a write outside the lease in Auto and Accept edits, and leaves one inside to the mode", async () => {
    for (const mode of ["auto", "acceptEdits"]) {
      expect(await decide(mode, lease, "package.json")).toMatchObject({ permissionDecision: "ask", permissionDecisionReason: expect.stringMatching(/outside the paths the scope lease allows/) })
      expect((await decide(mode, lease, "src/a.ts"))?.permissionDecision).toBeUndefined()
    }
    expect((await decide("auto", undefined, "package.json"))?.permissionDecision).toBeUndefined()
  })
})

describe("canUseTool and the lease", () => {
  function setup(mode: string, current: ScopeLease | undefined) {
    const request = vi.fn(async () => ({ outcome: "deny", channel: "desktop", waitedMs: 1 }))
    const plans: string[] = []
    const canUse = createCanUseTool({
      sessionId: "s1",
      cwd: root,
      project: "shop",
      approver: { evaluate: async () => ({ outcome: "allow", ruleId: "edit-workspace-source", reason: "ok", risk: 10, decidedBy: "rules", policyHash: "h" }) },
      broker: { request },
      audit: { record: async () => true },
      kill: () => false,
      policy: () => undefined,
      engine: {},
      pwsh: undefined,
      decided: new Set<string>(),
      extreme: () => false,
      mode: () => mode,
      lease: () => current,
      onPlanApproved: (p: string) => plans.push(p),
      effects: async () => undefined,
      log: () => undefined,
    } as unknown as CanUseDeps)
    const call = (tool: string, input: Record<string, unknown>) => canUse(tool, input, { toolUseID: "t1", signal: new AbortController().signal } as never)
    return { call, request, plans }
  }

  it("asks about a write outside the lease in Auto, though the rules allow it", async () => {
    const t = setup("auto", lease)
    expect((await t.call("Write", { file_path: "package.json", content: "{}" }))?.behavior).toBe("deny")
    expect(t.request).toHaveBeenCalledWith(expect.objectContaining({ verdict: expect.objectContaining({ ruleId: SCOPE_LEASE_RULE, outcome: "escalate" }) }))
    expect((await t.call("Write", { file_path: "src/a.ts", content: "x" }))?.behavior).toBe("allow")
  })

  it("is not used in Manual or Plan, nor with no lease", async () => {
    for (const [mode, l] of [["default", lease], ["auto", undefined]] as const) {
      const t = setup(mode, l)
      expect((await t.call("Write", { file_path: "package.json", content: "{}" }))?.behavior).toBe("allow")
      expect(t.request).not.toHaveBeenCalled()
    }
  })

  it("hands an approved plan's words to the session", async () => {
    const t = setup("plan", undefined)
    t.request.mockResolvedValueOnce({ outcome: "allow", channel: "desktop", waitedMs: 1 } as never)
    await t.call("ExitPlanMode", { plan: "Edit `src/a.ts`" })
    expect(t.plans).toEqual(["Edit `src/a.ts`"])
  })
})
