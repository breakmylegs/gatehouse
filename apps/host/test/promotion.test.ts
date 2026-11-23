// E-061: a promotion goes to a person unless its gate passes; to production with a failing gate it is Severe, and to
// production at all it goes to a person in Manual; Max approval (O45) approves it, audited, as you chose.
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { afterEach, describe, expect, it, vi } from "vitest"
import { loadPolicy } from "@gatehouse/policy"
import { createCanUseTool, extremeAnswers, type CanUseDeps } from "../src/canuse.js"
import { createFloorHook } from "../src/hooks.js"
import type { GateSources } from "../src/gates.js"
import { judgePromotion, promotionFor, readEnvironments, PROMOTION_GATE_RULE, PRODUCTION_PROMOTION_RULE } from "../src/promotion.js"

const dirs: string[] = []
afterEach(() => {
  for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true })
})
function project(yaml: string) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "codeh-promote-"))
  dirs.push(root)
  fs.mkdirSync(path.join(root, ".codehouse"))
  fs.writeFileSync(path.join(root, ".codehouse", "environments.yaml"), yaml)
  return root
}
const YAML = `environments:
  - name: staging
    promote: npm run deploy:staging
    gates: [{ tests: verified }]
  - name: production
    production: true
    promote: npm   run deploy:prod
    gates:
      - tests: verified
      - mutation: 70
  - name: preview
    promote: ./preview.sh
`
const sources = (testsVerified: boolean | undefined, score?: number): GateSources => ({
  testsVerified: async () => testsVerified,
  sealedPass: async () => undefined,
  mutationScore: async () => score,
  readFile: () => undefined,
  dodItems: async () => undefined,
})

describe("environment promotion gate", () => {
  it("escalates a promotion to production with a failing gate as Severe", async () => {
    const envs = readEnvironments(project(YAML)).environments
    const env = promotionFor(envs, "git pull && npm run deploy:prod --force")
    expect(env?.name).toBe("production")
    const v = await judgePromotion(env!, sources(true, 40))
    expect(v).toMatchObject({ ruleId: PROMOTION_GATE_RULE, risk: 90 })
    expect(v!.reason).toMatch(/production/)
    expect(v!.reason).toMatch(/40/)
    // O45: Max approval answers it, as it answers every rule's request.
    expect(extremeAnswers(v!)).toBe(true)
  })

  it("lets a promotion whose gates pass go to the rules, but still asks for production", async () => {
    const envs = readEnvironments(project(YAML)).environments
    expect(await judgePromotion(promotionFor(envs, "npm run deploy:staging")!, sources(true))).toBeUndefined()
    const prod = await judgePromotion(promotionFor(envs, "npm run deploy:prod")!, sources(true, 80))
    expect(prod).toMatchObject({ ruleId: PRODUCTION_PROMOTION_RULE })
    expect(extremeAnswers(prod!)).toBe(true)
  })

  it("escalates a failing gate below production, and an environment with no gate", async () => {
    const envs = readEnvironments(project(YAML)).environments
    expect(await judgePromotion(promotionFor(envs, "npm run deploy:staging")!, sources(false))).toMatchObject({ ruleId: PROMOTION_GATE_RULE, risk: 70 })
    // No evidence yet fails closed.
    expect(await judgePromotion(promotionFor(envs, "npm run deploy:staging")!, sources(undefined))).toMatchObject({ ruleId: PROMOTION_GATE_RULE })
    expect(await judgePromotion(promotionFor(envs, "./preview.sh")!, sources(true))).toMatchObject({ ruleId: PROMOTION_GATE_RULE, reason: expect.stringMatching(/no gate is set/) })
  })

  it("matches only a part of the command that runs the promote command", () => {
    const envs = readEnvironments(project(YAML)).environments
    expect(promotionFor(envs, "npm run deploy:production")).toBeUndefined()
    expect(promotionFor(envs, "echo done; npm run deploy:staging")?.name).toBe("staging")
    expect(promotionFor(envs, "npm test")).toBeUndefined()
  })

  it("fails closed on a file it cannot read: a promote line in it is a production promotion that cannot pass", async () => {
    const r = readEnvironments(project("environments:\n  - name: production\n    promote: make ship\n    gates: [{ tests: verified\n"))
    expect(r.error).toBeDefined()
    const env = promotionFor(r.environments, "make ship")
    expect(await judgePromotion(env!, sources(true))).toMatchObject({ ruleId: PROMOTION_GATE_RULE, risk: 90 })
  })

  it("holds the promotion in canUseTool, even when the rules allow the command", async () => {
    const root = project(YAML)
    const request = vi.fn(async () => ({ outcome: "deny", channel: "desktop", waitedMs: 1 }))
    const canUse = createCanUseTool({
      sessionId: "s1", cwd: root, project: "app",
      approver: { evaluate: async () => ({ outcome: "allow", ruleId: "safe-shell", reason: "ok", risk: 10, decidedBy: "rules", policyHash: "h" }) },
      broker: { request }, audit: { record: async () => true }, kill: () => false, policy: () => undefined, engine: {}, pwsh: undefined,
      decided: new Set<string>(), extreme: () => false, effects: async () => undefined, log: () => undefined,
      promotion: async (command: string) => {
        const env = promotionFor(readEnvironments(root).environments, command)
        return env ? await judgePromotion(env, sources(false)) : undefined
      },
    } as unknown as CanUseDeps)
    const call = (command: string) => canUse("Bash", { command }, { toolUseID: "t", signal: new AbortController().signal } as never)
    expect((await call("npm run deploy:prod"))?.behavior).toBe("deny")
    expect(request).toHaveBeenCalledWith(expect.objectContaining({ verdict: expect.objectContaining({ ruleId: PROMOTION_GATE_RULE, risk: 90 }) }))
    expect((await call("npm test"))?.behavior).toBe("allow")
  })

  it("asks about a promotion in Auto and Accept edits, so its gate is checked", async () => {
    const root = project(YAML)
    const policy = loadPolicy({ rulesPath: path.resolve(import.meta.dirname, "../../../policy/rules.yaml") })
    const decide = async (mode: string, command: string) =>
      (
        (await createFloorHook({
          sessionId: "s", cwd: root, policy: () => policy, pwsh: undefined, audit: { record: async () => true } as never, kill: () => false,
          decided: new Set<string>(), onEvent: () => undefined, log: () => undefined, mode: () => mode, scanCommits: false,
          approver: { evaluate: async () => ({ outcome: "allow", ruleId: "safe-shell", reason: "ok", risk: 10, decidedBy: "rules", policyHash: "h" }) },
          verdicts: new Map(),
          promotes: (c: string) => promotionFor(readEnvironments(root).environments, c)?.name,
        })({ hook_event_name: "PreToolUse", tool_name: "Bash", tool_input: { command }, tool_use_id: "t", cwd: root, session_id: "x" } as never, "t", { signal: new AbortController().signal })) as {
          hookSpecificOutput?: { permissionDecision?: string; permissionDecisionReason?: string }
        }
      ).hookSpecificOutput
    for (const mode of ["auto", "acceptEdits"]) expect(await decide(mode, "npm run deploy:staging")).toMatchObject({ permissionDecision: "ask", permissionDecisionReason: expect.stringMatching(/promotes to staging/) })
    expect((await decide("auto", "npm test"))?.permissionDecision).not.toBe("ask")
  })
})
