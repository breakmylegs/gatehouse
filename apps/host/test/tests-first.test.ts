// D-036, tests-first contract mode: before the tests are approved, an implementation edit goes to a person (even in
// Extreme approval) while a test file does not; approving locks the tests (D-007) and ends the mode.
import fs from "node:fs"
import path from "node:path"
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"
import { createCanUseTool, type CanUseDeps } from "../src/canuse.js"
import { TESTS_FIRST_RULE } from "../src/mutation.js"
import { TestLocks } from "../src/test-locks.js"
import { buildStack, type Stack } from "./stack.js"

const sealer = () => ({
  protect: async (b: Uint8Array) => Buffer.from(Buffer.from(b).map((x) => x ^ 0x44)),
  unprotect: async (b: Uint8Array) => Buffer.from(Buffer.from(b).map((x) => x ^ 0x44)),
})

let s: Stack
let locks: TestLocks
beforeAll(async () => {
  locks = new TestLocks({ dir: path.join(process.env.TEMP ?? ".", `gh-tf-locks-${Date.now()}`), sealer })
  s = await buildStack({ locks })
}, 60000)
afterAll(() => s.stop())

describe("tests-first contract mode (D-036)", () => {
  it("sends an implementation edit to a person before the tests are approved", async () => {
    const request = vi.fn(async () => ({ outcome: "deny", channel: "desktop", waitedMs: 1 }))
    const deps = {
      sessionId: "s1",
      cwd: "C:/p",
      project: "p",
      approver: { evaluate: async () => ({ outcome: "allow", ruleId: "edit-workspace-source", reason: "ok", risk: 10, decidedBy: "rules", policyHash: "h" }) },
      broker: { request },
      audit: { record: async () => true },
      kill: () => false,
      policy: () => undefined,
      engine: {},
      pwsh: undefined,
      decided: new Set<string>(),
      extreme: () => false,
      notifyAutoApproved: () => undefined,
      log: () => undefined,
      testsFirst: () => true,
    } as unknown as CanUseDeps
    const canUse = createCanUseTool(deps)
    const opts = (id: string) => ({ toolUseID: id, signal: new AbortController().signal }) as never
    await canUse("Write", { file_path: "C:/p/src/cart.ts", content: "x" }, opts("t1"))
    expect((request.mock.calls[0] as unknown as [{ verdict: { ruleId: string } }])[0].verdict.ruleId).toBe(TESTS_FIRST_RULE)
    expect((await canUse("Write", { file_path: "C:/p/test/cart.test.ts", content: "x" }, opts("t2")))?.behavior).toBe("allow")
    expect(request).toHaveBeenCalledTimes(1)
  })

  it("locks the tests when you approve them, and ends the mode", async () => {
    s.sdk.turn = async (api) => api.say("ok")
    const session = await s.manager.start({ cwd: s.repo })
    fs.mkdirSync(path.join(s.repo, "test"), { recursive: true })
    fs.writeFileSync(path.join(s.repo, "test", "cart.test.ts"), "it('adds', () => {})\n")
    session.startTestsFirst("A cart adds items and totals them.")
    expect(session.info().testsFirst).toBe(true)
    expect(s.sdk.queries.length).toBeGreaterThan(0)
    await expect(session.approveTests([])).rejects.toThrow(/nothing to approve/)
    expect(await session.approveTests(["test/cart.test.ts"])).toEqual(["test/cart.test.ts"])
    expect(session.info().testsFirst).toBeUndefined()
    expect(await locks.touched(s.repo, "Edit", { file_path: path.join(s.repo, "test", "cart.test.ts"), old_string: "a", new_string: "b" })).not.toEqual([])
    await session.close()
  })
})
