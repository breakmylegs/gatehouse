// E-054: dependent tasks run in order; the morning report shows each status; the night's budget stops the run.
import { describe, expect, it, vi } from "vitest"
import { morningReport, newNight, order, runNight, type NightDeps, type NightTask } from "../src/night-shift.js"

const tasks: NightTask[] = [
  { id: "docs", prompt: "Document the API", folder: "C:/p", dependsOn: ["api"] },
  { id: "schema", prompt: "Add the orders table", folder: "C:/p" },
  { id: "api", prompt: "Add the orders API", folder: "C:/p", dependsOn: ["schema"], budgetUsd: 5 },
]

function deps(cost: Record<string, number>, fail: string[] = []) {
  const ran: string[] = []
  const caps: Record<string, number | undefined> = {}
  const d: NightDeps = {
    runTask: vi.fn(async (t) => {
      ran.push(t.id)
      caps[t.id] = t.budgetUsd
      return { sessionId: `s-${t.id}`, ok: !fail.includes(t.id), costUsd: cost[t.id] ?? 1, ...(fail.includes(t.id) ? { why: "its tests failed" } : {}) }
    }),
    save: vi.fn(),
  }
  return { d, ran, caps }
}

describe("the night shift", () => {
  it("runs dependent tasks in order", async () => {
    const { d, ran } = deps({})
    const r = await runNight(newNight(tasks, 50), d)
    expect(ran).toEqual(["schema", "api", "docs"])
    expect(Object.values(r.outcomes).map((o) => o.status)).toEqual(["done", "done", "done"])
  })

  it("skips a task whose dependency failed", async () => {
    const { d, ran } = deps({}, ["api"])
    const r = await runNight(newNight(tasks, 50), d)
    expect(ran).toEqual(["schema", "api"])
    expect(r.outcomes.docs).toEqual({ status: "skipped", costUsd: 0, why: "api did not finish" })
  })

  it("stops when the night's budget is reached, and caps each task to what is left", async () => {
    const { d, ran, caps } = deps({ schema: 7, api: 4 })
    const r = await runNight(newNight(tasks, 10), d)
    expect(ran).toEqual(["schema", "api"])
    expect(caps).toEqual({ schema: 10, api: 3 })
    expect(r.outcomes.docs).toMatchObject({ status: "not run", why: "the night's budget was reached" })
    expect(r.stopped).toBe("The night's budget of $10 was reached, so no more tasks started.")
  })

  it("shows each task's status, evidence, cost and open decisions in the morning report", async () => {
    const { d } = deps({ schema: 1.234 }, ["api"])
    const r = await runNight(newNight(tasks, 50), d)
    const rep = morningReport(r, (sid) => (sid === "s-schema" ? { claims: [{ outcome: "verified" }, { outcome: "contradicted" }] } : undefined), (sid) => (sid === "s-api" ? 2 : 0))
    expect(rep.lines).toEqual([
      { task: "docs", status: "skipped", costUsd: 0, evidence: "no claims checked", openDecisions: 0, why: "api did not finish" },
      { task: "schema", status: "done", costUsd: 1.23, evidence: "1 Verified, 1 Contradicted, 0 Unverified", openDecisions: 0 },
      { task: "api", status: "failed", costUsd: 1, evidence: "no claims checked", openDecisions: 2, why: "its tests failed" },
    ])
    expect(rep.totalUsd).toBe(2.23)
  })

  it("refuses a night whose tasks depend on each other in a circle, or on a task not queued", async () => {
    expect(order([{ id: "a", prompt: "x", folder: "C:/p", dependsOn: ["b"] }, { id: "b", prompt: "x", folder: "C:/p", dependsOn: ["a"] }])).toMatchObject({ problem: expect.stringMatching(/circle/) })
    const { d, ran } = deps({})
    const r = await runNight(newNight([{ id: "a", prompt: "x", folder: "C:/p", dependsOn: ["ghost"] }], 10), d)
    expect(ran).toEqual([])
    expect(r.stopped).toMatch(/depends on ghost, which is not queued/)
  })
})
