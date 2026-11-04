// B37: when IT's signed policy is on this computer but does not check out, no session starts.
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { ManagedPolicyError } from "../src/sessions.js"
import { buildStack, type Stack } from "./stack.js"

let s: Stack
beforeAll(async () => {
  s = await buildStack({ hardTimeoutMs: 1500, phoneExpiryMs: 800 })
}, 60000)
afterAll(() => s.stop())

describe("IT's policy and sessions", () => {
  it("refuses to start a session while IT's policy fails its check, and says why, then starts once it is right", async () => {
    let problem: string | undefined = "managed policy: the signature does not match policy.yaml"
    s.deps.managedPolicyProblem = () => problem
    await expect(s.manager.start({ cwd: s.repo })).rejects.toThrow(ManagedPolicyError)
    await expect(s.manager.start({ cwd: s.repo })).rejects.toThrow(
      /IT team's policy .* could not be checked \(the signature does not match policy\.yaml\)/,
    )
    problem = undefined
    const ok = await s.manager.start({ cwd: s.repo })
    expect(ok.live).toBe(true)
    await ok.close()
  })
})
