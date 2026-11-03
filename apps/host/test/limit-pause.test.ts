import { describe, expect, it } from "vitest"
import { LimitPauser, PAUSE_AT_PERCENT, pausePoint, type PauseTarget } from "../src/limit-pause.js"
import type { PlanUsage } from "../src/plan-usage.js"

// Owner, 31 Oct: every session pauses at 95% of the plan's 5-hour limit and starts again when it resets.
const RESET = "2026-10-31T14:20:00+00:00"
const usage = (percent: number, resetsAt: string | null = RESET): PlanUsage => ({
  limits: [
    { label: "5-hour limit", percent, ...(resetsAt ? { resetsAt } : {}), group: "session" },
    { label: "Weekly, all models", percent: 99, group: "weekly" },
  ],
  at: "2026-10-31T10:00:00Z",
})

function target(id: string, account = "main") {
  const calls: string[] = []
  const t: PauseTarget & { calls: string[]; failResume?: boolean } = {
    id,
    account,
    calls,
    async pause(percent, until) {
      calls.push(`pause ${percent} ${until ?? "-"}`)
      t.paused = { percent, wasRunning: false, ...(until ? { until } : {}) }
    },
    async resume() {
      if (t.failResume) throw new Error("the kill switch is engaged")
      calls.push("resume")
      t.paused = undefined
      return true
    },
  }
  return t
}

function setup(
  targets: PauseTarget[],
  answers: Record<string, PlanUsage | undefined>,
  at = Date.parse("2026-10-31T10:00:00Z"),
  pauseAt?: () => number | undefined,
) {
  const clock = { now: at }
  const logs: string[] = []
  const asked: Array<[string, boolean]> = []
  const pauser = new LimitPauser({
    sessions: () => targets,
    planUsage: async (account, fresh) => {
      asked.push([account, fresh])
      return answers[account]
    },
    now: () => clock.now,
    ...(pauseAt ? { pauseAt } : {}),
    log: (l) => logs.push(l),
  })
  return { pauser, clock, logs, asked, answers }
}

describe("pausing at the plan limit", () => {
  it("pauses every session of the account at the pause point, with the reset time, and no other account", async () => {
    expect(PAUSE_AT_PERCENT).toBe(95)
    const a = target("a")
    const b = target("b")
    const other = target("c", "work")
    const s = setup([a, b, other], { main: usage(95), work: usage(40) })
    await s.pauser.check()
    expect(a.calls).toEqual([`pause 95 ${RESET}`])
    expect(b.calls).toEqual([`pause 95 ${RESET}`])
    expect(other.calls).toEqual([])
  })

  it("pauses where Settings says, or never when it is off, and still starts a paused one at the reset", async () => {
    const a = target("a")
    let at: number | undefined = 80
    const s = setup([a], { main: usage(81) }, Date.parse("2026-10-31T10:00:00Z"), () => at)
    await s.pauser.check()
    expect(a.calls).toEqual([`pause 81 ${RESET}`])
    // Off: nothing new is paused, and the one paused already starts again at the reset.
    at = undefined
    const b = target("b")
    const t = setup([a, b], { main: usage(99) }, Date.parse(RESET) + 1000, () => at)
    await t.pauser.check()
    expect(a.calls.at(-1)).toBe("resume")
    expect(b.calls).toEqual([])
    // What Settings holds: off, a percentage, or the default for nothing or a value out of range.
    expect([
      pausePoint({ percent: 90, off: true }),
      pausePoint({ percent: 85 }),
      pausePoint(undefined),
      pausePoint({ percent: 20 }),
    ]).toEqual([undefined, 85, 95, 95])
  })

  it("keeps a paused session paused after the reset when starting again by itself is off, and still pauses (B26)", async () => {
    const a = target("a")
    const b = target("b")
    a.paused = { percent: 96, wasRunning: true, until: RESET }
    const pauser = new LimitPauser({
      sessions: () => [a, b],
      planUsage: async () => usage(97),
      now: () => Date.parse(RESET) + 1000,
      autoResume: () => false,
      log: () => undefined,
    })
    await pauser.check()
    expect(a.calls).toEqual([])
    expect(b.calls).toEqual([`pause 97 ${RESET}`])
  })

  it("leaves sessions alone just below the pause point", async () => {
    const a = target("a")
    await setup([a], { main: usage(94.9) }).pauser.check()
    expect(a.calls).toEqual([])
  })

  it("never pauses on a limit it cannot read", async () => {
    const a = target("a")
    await setup([a], { main: undefined }).pauser.check()
    expect(a.calls).toEqual([])
  })

  it("does not pause a session twice", async () => {
    const a = target("a")
    const s = setup([a], { main: usage(97) })
    await s.pauser.check()
    await s.pauser.check()
    expect(a.calls).toEqual([`pause 97 ${RESET}`])
  })
})

describe("starting paused sessions again", () => {
  it("starts them again by themselves once the reset time has passed, and asks fresh while any is paused", async () => {
    const a = target("a")
    const s = setup([a], { main: usage(97) })
    await s.pauser.check()
    s.clock.now = Date.parse(RESET) - 1000
    await s.pauser.check()
    expect(a.calls).toEqual([`pause 97 ${RESET}`])
    s.clock.now = Date.parse(RESET) + 1000
    s.answers.main = usage(3, "2026-10-31T19:20:00+00:00")
    await s.pauser.check()
    expect(a.calls).toEqual([`pause 97 ${RESET}`, "resume"])
    expect(s.asked.at(-1)).toEqual(["main", true])
  })

  it("does not pause again straight after, on a number that has not caught up with the reset", async () => {
    const a = target("a")
    const s = setup([a], { main: usage(97) })
    await s.pauser.check()
    s.clock.now = Date.parse(RESET) + 1000
    await s.pauser.check() // still says 97: resumed because the time passed, and not paused again at once
    expect(a.calls).toEqual([`pause 97 ${RESET}`, "resume"])
    s.clock.now += 5 * 60_000
    await s.pauser.check() // once the quiet time is over, a real 97 pauses it again
    expect(a.calls.at(-1)).toBe(`pause 97 ${RESET}`)
  })

  it("starts one again when the limit falls below the pause point and no reset time is known", async () => {
    const a = target("a")
    const s = setup([a], { main: usage(96, null) })
    await s.pauser.check()
    expect(a.calls).toEqual(["pause 96 -"])
    await s.pauser.check()
    expect(a.calls).toHaveLength(1)
    s.answers.main = usage(20, null)
    await s.pauser.check()
    expect(a.calls).toEqual(["pause 96 -", "resume"])
  })

  it("keeps one paused that cannot start, says why, and tries again next time", async () => {
    const a = target("a")
    const s = setup([a], { main: usage(97) })
    await s.pauser.check()
    a.failResume = true
    s.clock.now = Date.parse(RESET) + 1000
    s.answers.main = usage(1)
    await s.pauser.check()
    expect(a.paused).toBeDefined()
    expect(s.logs.join("\n")).toMatch(/could not start again: the kill switch is engaged/)
    a.failResume = false
    await s.pauser.check()
    expect(a.paused).toBeUndefined()
  })
})
