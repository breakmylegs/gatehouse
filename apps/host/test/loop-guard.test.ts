// G19: the same failure three times in a row, with nothing changed in between, stops the turn and says why.
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"
import { LOOP_REPEATS, LoopGuard } from "../src/loop-guard.js"
import { buildStack, type Stack } from "./stack.js"

const test = { command: "npm test" }

describe("the loop guard", () => {
  it("stops at the third same failure in a row, with timings and counts smoothed", () => {
    const g = new LoopGuard()
    expect(LOOP_REPEATS).toBe(3)
    expect(g.failed("Bash", test, "2 failed in 1.2s")).toBe(false)
    expect(g.failed("Bash", test, "2 failed in 3.4s")).toBe(false)
    expect(g.failed("Bash", test, "2 failed in 0.9s")).toBe(true)
    // It starts again after stopping.
    expect(g.failed("Bash", test, "2 failed")).toBe(false)
  })

  it("never counts a fix cycle: a change, a different failure or the command passing starts again", () => {
    const g = new LoopGuard()
    g.failed("Bash", test, "parser.test fails")
    g.failed("Bash", test, "parser.test fails")
    g.succeeded("Edit", { file_path: "src/parser.ts" })
    expect(g.failed("Bash", test, "parser.test fails")).toBe(false)
    g.failed("Bash", test, "parser.test fails")
    expect(g.failed("Bash", test, "lexer.test fails")).toBe(false)
    g.failed("Bash", test, "lexer.test fails")
    g.succeeded("Bash", test)
    expect(g.failed("Bash", test, "lexer.test fails")).toBe(false)
    // Reading in between is not a change: reading and trying again unchanged is the loop itself.
    g.failed("Bash", test, "lexer.test fails")
    g.succeeded("Read", { file_path: "src/lexer.ts" })
    expect(g.failed("Bash", test, "lexer.test fails")).toBe(true)
  })
})

describe("a session going round in circles", () => {
  let s: Stack
  beforeAll(async () => {
    s = await buildStack({ hardTimeoutMs: 1500, phoneExpiryMs: 800 })
  }, 60000)
  afterAll(() => s.stop())

  it("is stopped on the third same failure, recorded, and told to the screen as a loop", async () => {
    let calls = 0
    s.sdk.turn = async (api) => {
      for (let i = 0; i < 5 && !api.signal.aborted; i++) {
        calls++
        await api.callTool("Bash", { command: "npm test" }, { error: "1 failed: parser" })
      }
      api.say("done")
    }
    const session = await s.manager.start({ cwd: s.repo })
    const told: Array<{ type: string; data: Record<string, unknown> }> = []
    session.on("event", (e) => told.push(e))
    session.prompt("fix the parser")
    await vi.waitFor(() =>
      expect(told.find((e) => e.type === "interrupted")?.data).toEqual({ by: "loop" }),
    )
    expect(calls).toBeLessThanOrEqual(4)
    const rec = s
      .records()
      .filter((r) => r.event === "loop_stopped")
      .at(-1)
    expect(rec).toMatchObject({ verdict: { ruleId: "loop-guard" } })
    expect(JSON.parse(String((rec as { inputJson?: string }).inputJson))).toEqual({
      tool: "Bash",
      repeats: 3,
    })
    await session.close()
  })
})
