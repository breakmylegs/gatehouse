// D-018, the risk budget: opt-in; an allow given without a person spends it (Moderate 1, High 3); at zero an Extreme
// session pauses and any other goes back to Manual; your own message fills it again.
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"
import { LimitPauser } from "../src/limit-pause.js"
import type { ToolCallResult } from "./fake-sdk.js"
import { buildStack, type Stack } from "./stack.js"

let s: Stack
beforeAll(async () => {
  s = await buildStack({ hardTimeoutMs: 20_000, phoneExpiryMs: 10_000, config: { riskBudget: { points: 3 } } })
}, 60000)
afterAll(async () => {
  for (const x of s.manager.liveSessions()) await x.close()
  await s.stop()
})

/** Moderate: the rules ask about a network call at risk 60. */
const MODERATE = "curl -s https://example.org/status"

describe("the risk budget (D-018)", () => {
  it("pauses an Extreme session once its budget of 3 is spent, recorded, and no limit starts it again", async () => {
    const results: ToolCallResult[] = []
    s.sdk.turn = async (api, text) => {
      if (text !== "work") return api.say("QUEUE EMPTY")
      for (let i = 0; i < 4; i++) results.push(await api.callTool("Bash", { command: `${MODERATE}?n=${i}` }))
      api.say("done")
    }
    const session = await s.manager.start({ cwd: s.repo, extreme: true })
    expect(session.info().riskBudget).toBe(3)
    session.prompt("work")
    await vi.waitFor(() => expect(session.info().paused).toMatchObject({ reason: "risk" }), { timeout: 10_000 })
    expect(session.info().riskBudget).toBe(0)
    expect(results.slice(0, 3).every((r) => r.executed)).toBe(true)
    expect(s.records().some((r) => r.event === "risk_budget_exhausted" && r.session === session.id)).toBe(true)
    // The plan limit's look does not start it again, however low the limit.
    const pauser = new LimitPauser({
      sessions: () => [session],
      planUsage: async () => ({ limits: [{ label: "5-hour limit", percent: 1, group: "session" }], at: "" }),
      log: () => undefined,
    })
    await pauser.check()
    expect(session.info().paused).toMatchObject({ reason: "risk" })
    // You do, and its budget is full again.
    await session.resume("you")
    expect(session.info().paused).toBeUndefined()
    expect(session.info().riskBudget).toBe(3)
    await session.close()
  })

  it("sends an Auto session back to Manual once spent, so the next Moderate call asks", async () => {
    let asked: ToolCallResult | undefined
    s.sdk.turn = async (api, text) => {
      if (text !== "work") return api.say("done")
      for (let i = 0; i < 3; i++) await api.callTool("Bash", { command: `${MODERATE}?a=${i}` }, { selfApproved: true })
      const next = api.callTool("Bash", { command: `${MODERATE}?a=next` }, { selfApproved: true })
      await s.waitForPending()
      s.broker.resolve(s.pendingId(), { kind: "decision", decision: "deny" }, "desktop")
      asked = await next
      api.say("done")
    }
    const session = await s.manager.start({ cwd: s.repo, mode: "auto" })
    const done = new Promise<void>((res) => session.on("message", (m) => m.type === "result" && res()))
    session.prompt("work")
    await done
    expect(session.info().mode).toBe("default")
    expect(asked).toMatchObject({ executed: false, canUseToolCalled: true })
    // Your own message fills it again.
    s.sdk.turn = async (api) => api.say("ok")
    session.prompt("thanks")
    expect(session.info().riskBudget).toBe(3)
    await session.close()
  })
})

describe("with no budget set (D-018)", () => {
  let off: Stack
  beforeAll(async () => {
    off = await buildStack({ hardTimeoutMs: 20_000, phoneExpiryMs: 10_000 })
  }, 60000)
  afterAll(async () => {
    for (const x of off.manager.liveSessions()) await x.close()
    await off.stop()
  })

  it("is off by default: nothing is spent and nothing pauses", async () => {
    off.sdk.turn = async (api, text) => {
      if (text !== "work") return api.say("QUEUE EMPTY")
      for (let i = 0; i < 5; i++) await api.callTool("Bash", { command: `${MODERATE}?o=${i}` })
      api.say("done")
    }
    const session = await off.manager.start({ cwd: off.repo, extreme: true })
    const done = new Promise<void>((res) => session.on("message", (m) => m.type === "result" && res()))
    session.prompt("work")
    await done
    expect(session.info().riskBudget).toBeUndefined()
    expect(session.info().paused).toBeUndefined()
  })
})
