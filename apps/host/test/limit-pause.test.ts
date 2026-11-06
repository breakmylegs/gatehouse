import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { describe, expect, it } from "vitest"
import {
  ExtraSpendToday,
  LimitPauser,
  PAUSE_AT_PERCENT,
  pausePoint,
  type PauseTarget,
} from "../src/limit-pause.js"
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
    async pause(percent, until, reason) {
      calls.push(`pause ${percent} ${until ?? "-"}`)
      t.paused = {
        percent,
        wasRunning: false,
        ...(until ? { until } : {}),
        ...(reason ? { reason } : {}),
      }
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

  it("pauses every session when today's spending reaches the cap, and starts them at midnight or when it is lifted (B20)", async () => {
    const a = target("a")
    const b = target("b", "work")
    let spent = 30
    let cap: number | undefined = 25
    let clock = Date.parse("2026-11-04T15:00:00")
    const pauser = new LimitPauser({
      sessions: () => [a, b],
      planUsage: async () => usage(10),
      now: () => clock,
      spendToday: () => spent,
      spendCap: () => cap,
      log: () => undefined,
    })
    await pauser.check()
    // Every account's sessions, for the reason spend, until midnight; the low plan limit does not start them again.
    expect(a.paused).toMatchObject({ reason: "spend" })
    expect(b.paused).toMatchObject({ reason: "spend" })
    expect(a.calls[0]).toMatch(/^pause 120 /)
    await pauser.check()
    expect(a.calls).toHaveLength(1)
    // The cap is lifted: they start again.
    cap = undefined
    await pauser.check()
    expect(a.calls.at(-1)).toBe("resume")
    // Over it again, then past midnight: they start again by themselves.
    cap = 25
    a.calls.length = 0
    await pauser.check()
    expect(a.paused?.reason).toBe("spend")
    clock = Date.parse(a.paused!.until!) + 1000
    spent = 0
    await pauser.check()
    expect(a.calls.at(-1)).toBe("resume")
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

describe("extra usage and Start now (owner, 5 Nov)", () => {
  const withExtra = (percent: number, used: number, limit = 4000): PlanUsage => ({
    ...usage(percent),
    extra: { used, limit, currency: "USD", percent: Math.round((100 * used) / limit) },
  })

  it("carries on into extra usage while some is left, and pauses only when it runs out", async () => {
    const a = target("a")
    const s = setup([a], { main: withExtra(100, 7.65) })
    await s.pauser.check()
    expect(a.calls).toEqual([])
    // One the plan limit paused before starts again, since the work can carry on.
    a.paused = { percent: 100, wasRunning: true, until: RESET }
    await s.pauser.check()
    expect(a.calls).toEqual(["resume"])
    s.answers.main = withExtra(100, 4000)
    s.clock.now += 10 * 60_000
    await s.pauser.check()
    expect(a.calls.at(-1)).toBe(`pause 100 ${RESET}`)
  })

  it("counts extra usage spent today towards the cap, never the API price of work inside the plan (owner, 6 Nov)", async () => {
    const a = target("a")
    let used = 120
    const extra = new ExtraSpendToday({ today: () => "2026-11-06" })
    const pauser = new LimitPauser({
      sessions: () => [a],
      planUsage: async () => withExtra(17, used),
      now: () => Date.parse("2026-11-06T09:00:00"),
      // Nothing pay-as-you-go open: the sessions run on the plan, whatever price they report.
      spendToday: () => 0,
      spendCap: () => 25,
      extraToday: (account, u) => extra.spent(account, u),
      log: () => undefined,
    })
    // The 120 used earlier this month is not today's.
    await pauser.check()
    expect(a.calls).toEqual([])
    used = 140
    await pauser.check()
    expect(a.calls).toEqual([])
    used = 145
    await pauser.check()
    expect(a.paused?.reason).toBe("spend")
  })

  it("starts each day, and each month, from the amount used then, and keeps it through a restart", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "gh-extra-"))
    try {
      const file = path.join(dir, "extra.json")
      let day = "2026-11-06"
      const first = new ExtraSpendToday({ file, today: () => day })
      expect(first.spent("main", 100)).toBe(0)
      expect(first.spent("main", 130)).toBe(30)
      expect(first.spent("work", 5)).toBe(0)
      await first.flushed()
      const again = new ExtraSpendToday({ file, today: () => day })
      expect(again.spent("main", 131)).toBe(31)
      day = "2026-11-07"
      expect(again.spent("main", 131)).toBe(0)
      expect(again.spent("main", 140)).toBe(9)
      // A new month: the amount falls and counting starts from it.
      expect(again.spent("main", 2)).toBe(0)
      expect(again.spent("main", 6)).toBe(4)
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })

  it("leaves a session you started alone, over the cap and at the plan limit, until its hold ends", async () => {
    const a = target("a")
    let clock = Date.parse("2026-11-05T09:00:00")
    a.protectionOffUntil = clock + 3_600_000
    const pauser = new LimitPauser({
      sessions: () => [a],
      planUsage: async () => usage(100),
      now: () => clock,
      spendToday: () => 92,
      spendCap: () => 50,
      log: () => undefined,
    })
    await pauser.check()
    await pauser.check()
    expect(a.calls).toEqual([])
    clock += 3_600_000
    await pauser.check()
    expect(a.paused?.reason).toBe("spend")
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
