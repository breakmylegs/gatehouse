// T-129: every account's plan limits as one pool: one segment per account, the pool's share used, and the next reset
// with what it gives back.
import { describe, expect, it } from "vitest"
import { poolLimits } from "../src/lib/plan-pool"

const now = Date.parse("2026-11-19T10:00:00Z")

describe("limits pooled across accounts (T-129)", () => {
  it("gives each account its share of the bar and says which reset comes next and what it returns", () => {
    const [five, weekly] = poolLimits(
      [
        { account: "main", label: "Work", limits: [{ label: "5-hour limit", percent: 80, resetsAt: "2026-11-19T12:00:00Z" }, { label: "Weekly, all models", percent: 40 }] },
        { account: "a2", label: "Second", limits: [{ label: "5-hour limit", percent: 20, resetsAt: "2026-11-19T11:00:00Z" }] },
      ],
      now,
    )
    expect(five).toEqual({
      label: "5-hour limit",
      used: 50,
      segments: [
        { account: "main", label: "Work", share: 50, used: 40 },
        { account: "a2", label: "Second", share: 50, used: 10 },
      ],
      next: { account: "a2", label: "Second", at: "2026-11-19T11:00:00Z", returns: 10 },
    })
    // A limit only one account has is that account's whole bar.
    expect(weekly).toMatchObject({ used: 40, segments: [{ account: "main", share: 100, used: 40 }] })
    expect(weekly).not.toHaveProperty("next")
  })

  it("skips a reset already past or one that gives nothing back", () => {
    const [p] = poolLimits(
      [
        { account: "main", label: "Work", limits: [{ label: "5-hour limit", percent: 60, resetsAt: "2026-11-19T09:00:00Z" }] },
        { account: "a2", label: "Second", limits: [{ label: "5-hour limit", percent: 0, resetsAt: "2026-11-19T10:30:00Z" }] },
        { account: "a3", label: "Third", limits: [{ label: "5-hour limit", percent: 150, resetsAt: "2026-11-19T13:00:00Z" }] },
      ],
      now,
    )
    expect(p!.next).toMatchObject({ account: "a3", returns: 100 / 3 })
    expect(p!.used).toBeCloseTo((60 + 100) / 3)
  })
})
