// B25 (goal mode): Extreme approval carries on until a check you name passes.
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"
import { CarryOn, goalOk, goalPrompt } from "../src/carry-on.js"
import { buildStack, type Stack } from "./stack.js"

describe("a goal", () => {
  it("ends carrying on when Claude says GOAL MET, and is one line it is told to run exactly", () => {
    const c = new CarryOn(() => ({ turns: 10 }))
    c.started()
    expect(c.next({ text: "Fixed two tests.", isError: false, steps: 3 })).toMatchObject({
      go: true,
    })
    expect(c.next({ text: "npm test passed.\nGOAL MET", isError: false, steps: 2 })).toMatchObject({
      go: false,
      why: "goal",
    })
    expect(goalPrompt("  npm test ")).toContain("run exactly this check: npm test .")
    expect(goalPrompt("npm test")).toContain("never end with GOAL MET unless that check passed")
    expect([goalOk("npm test"), goalOk(""), goalOk("a\nb"), goalOk("x".repeat(301))]).toEqual([
      true,
      false,
      false,
      false,
    ])
  })
})

describe("a session with a goal", () => {
  let s: Stack
  beforeAll(async () => {
    s = await buildStack({
      hardTimeoutMs: 1500,
      phoneExpiryMs: 800,
      config: { extremeCarryOn: { turns: 5, usd: 100 } },
    })
  }, 60000)
  afterAll(() => s.stop())

  it("is told the goal after each turn, stops when it is met, and the goal is recorded", async () => {
    let turns = 0
    s.sdk.turn = async (api) => {
      await api.callTool("Glob", { pattern: "*.md" })
      turns++
      api.say(turns >= 3 ? "The check passed.\nGOAL MET" : "Still failing; fixing.")
    }
    const session = await s.manager.start({ cwd: s.repo, extreme: true })
    await session.setGoal("npm test")
    expect(session.info().goal).toBe("npm test")
    session.prompt("make the tests pass")
    await vi.waitFor(() => expect(session.info().carryOn?.ended).toBe("goal"), { timeout: 15_000 })
    const prompts = s.sdk.queries.at(-1)?.prompts ?? []
    expect(prompts[0]).toBe("make the tests pass")
    expect(prompts.slice(1).every((p) => p === goalPrompt("npm test"))).toBe(true)
    expect(prompts).toHaveLength(3)
    expect(
      s.records().filter((r) => r.event === "settings_changed" && r.verdict.ruleId === "goal-set"),
    ).toHaveLength(1)
    await session.setGoal(undefined)
    expect(session.info().goal).toBeUndefined()
    await expect(session.setGoal("a\nb")).rejects.toThrow(/one line/)
  })
})
