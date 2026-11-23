// E-088: a Contradicted overnight run appears near the top of the daily plan, the rest ordered by urgency.
import { describe, expect, it } from "vitest"
import { dailyPlan, type PlanInput } from "../src/daily-plan.js"

const NOW = new Date("2026-11-20T08:00:00Z")
const INPUT: PlanInput = {
  sessions: [
    { id: "s1", project: "shop", title: "Checkout", claims: [{ outcome: "verified" }] },
    { id: "s2", project: "blog", title: "Feed", claims: [{ outcome: "contradicted", quote: "All tests pass" }] },
  ],
  pending: [
    { id: "r1", sessionId: "s1", project: "shop", tool: "Bash", risk: 90, reason: "Deletes the build cache" },
    { id: "r2", sessionId: "s1", project: "shop", tool: "Edit", risk: 30, reason: "Edits a config file" },
  ],
  reminders: [{ id: "g1", inDays: 1, text: "The grant for Bash npm test ends tomorrow." }],
  night: {
    lines: [
      { task: "refactor-billing", status: "done", evidence: "1 Verified, 2 Contradicted, 0 Unverified", sessionId: "n1" },
      { task: "docs", status: "done", evidence: "3 Verified, 0 Contradicted, 0 Unverified", sessionId: "n2" },
      { task: "migrate", status: "skipped", evidence: "no claims checked" },
    ],
  },
  runs: [
    { name: "Nightly lint", sessionId: "r9", at: "2026-11-20T02:00:00Z", branch: "routine/lint-1120" },
    { name: "Old", sessionId: "r8", at: "2026-11-10T02:00:00Z", branch: "routine/old" },
  ],
  today: [{ name: "Standup notes", time: "09:30" }],
  now: NOW,
}

describe("the daily plan", () => {
  it("puts a Contradicted overnight run at the top, then the rest by urgency", () => {
    const p = dailyPlan(INPUT)
    expect(p[0]).toMatchObject({ kind: "contradicted", title: "Overnight task refactor-billing: its claims were Contradicted", sessionId: "n1" })
    expect(p.map((x) => x.kind)).toEqual(["contradicted", "contradicted", "escalation", "night", "grant", "escalation", "review", "routine"])
    expect(p[1]).toMatchObject({ title: "blog: Feed has 1 Contradicted claim(s)", why: expect.stringMatching(/"All tests pass"/) })
    expect(p.find((x) => x.kind === "night")!.title).toBe("Overnight task migrate skipped")
    // A night task that went well, and an old routine run, are not on it.
    expect(p.some((x) => x.title.includes("docs") || x.title.includes("Old"))).toBe(false)
  })

  it("leaves a night task's open session off twice, and ranks a grant ending today higher", () => {
    const p = dailyPlan({ ...INPUT, sessions: [{ id: "n1", project: "shop", title: "Night", claims: [{ outcome: "contradicted" }] }], reminders: [{ id: "g", inDays: 0, text: "ends today" }] })
    expect(p.filter((x) => x.sessionId === "n1")).toHaveLength(1)
    expect(p.find((x) => x.kind === "grant")!.urgency).toBe(75)
  })
})
