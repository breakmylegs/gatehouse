// E-100: the invariant canaries prove on this build that the protections hold. Each one fails when the check it
// guards is broken; all eight pass on the shipped rules; the run is quick; a failure names the canary, shows Doctor
// guidance and refuses new sessions.
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { loadPolicy } from "@gatehouse/policy"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { canaryProblem, runCanaries, type CanaryDeps, type CanaryFns, type CanaryId } from "../src/canaries.js"
import { canaryCheck } from "../src/doctor.js"
import { CanaryFailedError } from "../src/sessions.js"
import { buildStack, type Stack } from "./stack.js"

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..")
const rulesPath = path.join(root, "policy", "rules.yaml")
const ws = fs.mkdtempSync(path.join(os.tmpdir(), "gh-canary-ws-"))
afterAll(() => fs.rmSync(ws, { recursive: true, force: true }))
const policy = loadPolicy({ rulesPath, workspaceRootsOverride: [ws] })

/** A quick stand-in for the PowerShell verifier, so a run's time is the canaries' own. */
const fastPs: CanaryFns["powerShellVerifier"] = async () => ({ ok: true })
const deps = (fns: Partial<CanaryFns> = {}): CanaryDeps => ({ policy: () => policy, rulesPath, psVerifier: path.join(root, "scripts", "verify-audit.ps1"), fns: { powerShellVerifier: fastPs, ...fns } })

describe("the invariant canaries (E-100)", () => {
  it("all pass on the shipped rules, with the real PowerShell verifier too", async () => {
    const run = await runCanaries({ ...deps(), fns: {} })
    expect(run.results.filter((r) => !r.ok).map((r) => `${r.id}: ${r.detail}`)).toEqual([])
    expect(run.passed).toBe(8)
  }, 60_000)

  it("run in under five seconds", async () => {
    const run = await runCanaries(deps())
    expect(run.failed).toBe(0)
    expect(run.ms).toBeLessThan(5000)
  }, 30_000)

  // Each canary, with the check it guards broken, fails; and only it.
  const breaks: Array<[CanaryId, Partial<CanaryFns> | "no-policy"]> = [
    ["floor", "no-policy"],
    ["floor", { evaluateFloor: async () => null }],
    ["redaction", { redactString: (t: string) => t }],
    ["approver", { approver: () => ({ evaluate: async () => ({ outcome: "allow" }) as never }) }],
    ["listener", { checkHostRequest: () => ({ ok: true }) }],
    ["audit", { verifyAudit: () => ({ ok: true }) as never }],
    ["audit", { powerShellVerifier: async () => ({ ok: false }) }],
    ["org", { checkOrg: () => ({ ok: true }) }],
    ["mcp", { outOfProcessServers: () => [] }],
    ["managed", { loadPolicy: () => policy }],
  ]
  for (const [id, broken] of breaks)
    it(`fails "${id}" when its check is broken${broken === "no-policy" ? " (no policy loaded)" : ""}`, async () => {
      const run = await runCanaries(broken === "no-policy" ? { ...deps(), policy: () => undefined } : deps(broken))
      expect(run.results.filter((r) => !r.ok).map((r) => r.id)).toEqual([id])
    }, 30_000)

  it("says which canary failed, with Doctor's guidance, and nothing when all passed", async () => {
    const run = await runCanaries(deps({ redactString: (t: string) => t }))
    expect(canaryProblem(run)).toMatch(/Redaction masks a secret .*Open Doctor/)
    const doctor = canaryCheck(run)
    expect(doctor).toMatchObject({ id: "canaries", state: "fail" })
    expect(doctor.fix).toMatch(/Redaction is not working/)
    expect(canaryProblem(await runCanaries(deps()))).toBeUndefined()
    expect(canaryCheck(undefined).state).toBe("warn")
  }, 30_000)
})

describe("a failing canary and new sessions", () => {
  let s: Stack
  beforeAll(async () => {
    s = await buildStack({ hardTimeoutMs: 1500, phoneExpiryMs: 800 })
  }, 60_000)
  afterAll(() => s.stop())

  it("refuses to start a session while a canary fails, and starts once it passes", async () => {
    let problem: string | undefined = "A safety check failed when Codehouse started: The floor denies a secrets file (No policy is loaded). Open Doctor."
    s.deps.canaryProblem = () => problem
    await expect(s.manager.start({ cwd: s.repo })).rejects.toThrow(CanaryFailedError)
    problem = undefined
    await expect(s.manager.start({ cwd: s.repo })).resolves.toBeTruthy()
  }, 60_000)
})
