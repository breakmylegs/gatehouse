// G19 and D-075: the same failure three times in a row with nothing changed, or an edit undone twice, is first told
// to Claude; doing it again stops the turn, recorded, and the phone and the screen are told.
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"
import { LOOP_REPEATS, LoopGuard } from "../src/loop-guard.js"
import type { ToolCallResult } from "./fake-sdk.js"
import { buildStack, type Stack } from "./stack.js"

const test = { command: "npm test" }

describe("the loop guard", () => {
  it("warns at the third same failure in a row, timings and counts smoothed, and stops at the next", () => {
    const g = new LoopGuard()
    expect(LOOP_REPEATS).toBe(3)
    expect(g.failed("Bash", test, "2 failed in 1.2s")).toBeUndefined()
    expect(g.failed("Bash", test, "2 failed in 3.4s")).toBeUndefined()
    expect(g.failed("Bash", test, "2 failed in 0.9s")).toEqual({ act: "warn", what: "Bash npm test" })
    expect(g.failed("Bash", test, "2 failed in 0.7s")).toEqual({ act: "stop", what: "Bash npm test" })
    // It starts again after stopping.
    expect(g.failed("Bash", test, "2 failed")).toBeUndefined()
  })

  it("never counts a fix cycle: a change, a different failure or the command passing starts again", () => {
    const g = new LoopGuard()
    g.failed("Bash", test, "parser.test fails")
    g.failed("Bash", test, "parser.test fails")
    g.succeeded("Edit", { file_path: "src/parser.ts" })
    expect(g.failed("Bash", test, "parser.test fails")).toBeUndefined()
    g.failed("Bash", test, "parser.test fails")
    expect(g.failed("Bash", test, "lexer.test fails")).toBeUndefined()
    g.failed("Bash", test, "lexer.test fails")
    g.succeeded("Bash", test)
    expect(g.failed("Bash", test, "lexer.test fails")).toBeUndefined()
    // Reading in between is not a change: reading and trying again unchanged is the loop itself.
    g.failed("Bash", test, "lexer.test fails")
    g.succeeded("Read", { file_path: "src/lexer.ts" })
    expect(g.failed("Bash", test, "lexer.test fails")?.act).toBe("warn")
  })

  it("warns when an edit is made and undone twice, and stops when it is undone again", () => {
    const g = new LoopGuard()
    const there = { file_path: "src/a.ts", old_string: "x = 1", new_string: "x = 2" }
    const back = { file_path: "src/a.ts", old_string: "x = 2", new_string: "x = 1" }
    expect(g.succeeded("Edit", there)).toBeUndefined()
    expect(g.succeeded("Edit", back)).toBeUndefined()
    expect(g.succeeded("Edit", there)?.act).toBe("warn")
    expect(g.succeeded("Edit", back)?.act).toBe("stop")
    // A different edit is not a reversal.
    expect(g.succeeded("Edit", { file_path: "src/a.ts", old_string: "x = 1", new_string: "x = 3" })).toBeUndefined()
  })
})

describe("a session going round in circles", () => {
  let s: Stack
  beforeAll(async () => {
    s = await buildStack({ hardTimeoutMs: 1500, phoneExpiryMs: 800 })
  }, 60000)
  afterAll(() => s.stop())

  it("gets the message after the third repeat, is stopped after the next, and both are recorded", async () => {
    const results: ToolCallResult[] = []
    s.sdk.turn = async (api) => {
      for (let i = 0; i < 6 && !api.signal.aborted; i++)
        results.push(await api.callTool("Bash", { command: "npm test" }, { error: "1 failed: parser" }))
      api.say("done")
    }
    const session = await s.manager.start({ cwd: s.repo })
    const told: Array<{ type: string; data: Record<string, unknown> }> = []
    session.on("event", (e) => told.push(e))
    session.prompt("fix the parser")
    await vi.waitFor(() => expect(told.find((e) => e.type === "interrupted")?.data).toEqual({ by: "loop" }))
    // Told with the third failure, in what Claude reads with the call's result; not before.
    expect(results[1]?.told).toBeUndefined()
    expect(results[2]?.told).toMatch(/^Codehouse: this is the same thing again \(Bash npm test\)/)
    expect(results.length).toBeLessThanOrEqual(5)
    const events = s.records().filter((r) => r.session === session.id).map((r) => r.event)
    expect(events).toContain("thrash_warned")
    expect(events).toContain("thrash_paused")
    expect(told.map((e) => e.type)).toEqual(expect.arrayContaining(["thrash_warned", "thrash_paused"]))
    await session.close()
  })
})
