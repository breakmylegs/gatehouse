import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { planLimits } from "../src/plan-usage.js"
import { buildStack, type Stack } from "./stack.js"

const now = new Date("2026-10-31T10:00:00Z")

describe("the account's plan limits", () => {
  it("reads the server's own list, with each weekly window's model, and extra usage in money", () => {
    // The shape this laptop's Enterprise account answered with, 31 Oct (numbers only).
    const u = planLimits(
      {
        subscription_type: "enterprise",
        rate_limits_available: true,
        rate_limits: {
          five_hour: { utilization: 22, resets_at: "2026-10-31T14:20:00+00:00" },
          extra_usage: {
            is_enabled: true,
            monthly_limit: 400000,
            used_credits: 10935,
            utilization: 2.73375,
            currency: "USD",
            decimal_places: 2,
          },
          limits: [
            { kind: "session", group: "session", percent: 22, resets_at: "2026-10-31T14:20:00+00:00" },
            {
              kind: "weekly_scoped",
              group: "weekly",
              percent: 0,
              resets_at: "2026-11-03T08:00:00+00:00",
              scope: { model: { id: null, display_name: "Fable" } },
            },
            { kind: "something_new", group: "monthly", percent: 3 },
          ],
        },
      },
      now,
    )
    expect(u).toEqual({
      plan: "enterprise",
      limits: [
        { label: "5-hour limit", percent: 22, resetsAt: "2026-10-31T14:20:00+00:00", group: "session" },
        { label: "Weekly, Fable", percent: 0, resetsAt: "2026-11-03T08:00:00+00:00", group: "weekly" },
      ],
      extra: { used: 109.35, limit: 4000, currency: "USD", percent: 2.73375 },
      at: "2026-10-31T10:00:00.000Z",
    })
  })

  it("falls back to the documented windows when there is no list", () => {
    const u = planLimits({
      rate_limits_available: true,
      rate_limits: {
        five_hour: { utilization: 140, resets_at: null },
        seven_day: { utilization: 41.5, resets_at: "2026-11-03T08:00:00Z" },
        seven_day_opus: null,
        model_scoped: [{ display_name: "Fable", utilization: 7, resets_at: null }],
        extra_usage: { is_enabled: false, monthly_limit: null, used_credits: null, utilization: null },
      },
    })
    expect(u?.limits).toEqual([
      { label: "5-hour limit", percent: 100, group: "session" },
      { label: "Weekly, all models", percent: 41.5, resetsAt: "2026-11-03T08:00:00Z", group: "weekly" },
      { label: "Weekly, Fable", percent: 7, group: "weekly" },
    ])
    expect(u).not.toHaveProperty("extra")
  })

  it("is nothing where plan limits do not apply, or have not been read yet", () => {
    expect(planLimits({ rate_limits_available: false, rate_limits: null })).toBeUndefined()
    expect(planLimits({ rate_limits_available: true, rate_limits: null })).toBeUndefined()
    expect(planLimits(undefined)).toBeUndefined()
    expect(planLimits("nonsense")).toBeUndefined()
  })
})

describe("reading the plan limits on an open session", () => {
  let s: Stack
  beforeAll(async () => {
    s = await buildStack()
  }, 60000)
  afterAll(() => s.stop())

  it("asks an open session of that account, at most once a minute, and waits for numbers not yet fetched", async () => {
    expect(await s.manager.planUsage("main")).toBeUndefined()
    await s.manager.start({ cwd: s.repo })
    // The first answer can come before Claude Code has fetched the numbers (probe, 31 Oct).
    s.sdk.usageAnswers = [
      { rate_limits_available: true, rate_limits: null },
      { rate_limits_available: true, rate_limits: { five_hour: { utilization: 22, resets_at: null } } },
    ]
    const u = await s.manager.planUsage("main")
    expect(u?.limits).toEqual([{ label: "5-hour limit", percent: 22, group: "session" }])
    expect(s.sdk.usageCalls).toBe(2)
    await s.manager.planUsage("main")
    expect(s.sdk.usageCalls).toBe(2)
    s.sdk.usageAnswers = [
      { rate_limits_available: true, rate_limits: { five_hour: { utilization: 30, resets_at: null } } },
    ]
    expect((await s.manager.planUsage("main", true))?.limits[0]?.percent).toBe(30)
    // An account with no open session has nothing to read it on.
    expect(await s.manager.planUsage("personal")).toBeUndefined()
  })
})
