import { describe, expect, it } from "vitest"
import { CarryOn, carryOnLimits, recommendedAnswers } from "../src/carry-on.js"

const run = (turns = 3, usd = 5) => new CarryOn(() => ({ turns, usd }))
const ok = (text = "Done the next item.", costUsd?: number) => ({
  text,
  isError: false,
  ...(costUsd !== undefined ? { costUsd } : {}),
})

describe("Extreme approval carrying on by itself", () => {
  it("carries on after each turn until Claude says the queue is empty, and then says so once", () => {
    const c = run()
    c.started()
    expect(c.next(ok())).toEqual({ go: true, turn: 1, of: 3 })
    expect(c.next(ok())).toEqual({ go: true, turn: 2, of: 3 })
    expect(c.next(ok("All built.\nQUEUE EMPTY"))).toMatchObject({ go: false, why: "done" })
    expect(c.next(ok())).toBeUndefined()
    expect(c.status()).toMatchObject({ turns: 2, ended: "done" })
  })

  it("stops at the most automatic turns, and at the spend since your message", () => {
    const turns = run(2, 100)
    turns.started()
    turns.next(ok())
    turns.next(ok())
    expect(turns.next(ok())).toMatchObject({ go: false, why: "turns", turns: 2 })
    // Spend counts from your message: the session had already cost 10 before it.
    const spend = run(50, 5)
    spend.started(10)
    expect(spend.next(ok("next", 12))).toMatchObject({ go: true })
    expect(spend.next(ok("next", 15.5))).toMatchObject({ go: false, why: "spend", spentUsd: 5.5 })
  })

  it("stops on a failed turn and when you stop it, and your next message starts again", () => {
    const c = run()
    c.started()
    expect(c.next({ text: "", isError: true })).toMatchObject({ go: false, why: "error" })
    c.started()
    c.stopped()
    expect(c.next(ok())).toBeUndefined()
    expect(c.status().ended).toBe("stopped")
    c.started()
    expect(c.next(ok())).toEqual({ go: true, turn: 1, of: 3 })
  })

  it("keeps going with no limit when Settings says so, and an older reader still gets a number", () => {
    const c = new CarryOn(() => carryOnLimits({ turns: 500, usd: 1000, noTurnLimit: true, noSpendLimit: true }))
    c.started()
    for (let i = 1; i <= 600; i++) expect(c.next(ok("next", i * 10))).toEqual({ go: true, turn: i })
    expect(c.status()).not.toHaveProperty("maxTurns")
    expect(c.status()).not.toHaveProperty("maxUsd")
    // Owner, 31 Oct: the defaults leave room for a long build queue.
    expect(carryOnLimits()).toEqual({ turns: 200, usd: 500 })
    expect(carryOnLimits({ turns: 40, usd: 60, noSpendLimit: true })).toEqual({ turns: 40 })
  })

  it("stops when two turns in a row did no work, even with no limit", () => {
    const c = new CarryOn(() => ({}))
    c.started()
    expect(c.next({ ...ok("Shall I go on?"), steps: 1 })).toMatchObject({ go: true })
    expect(c.next({ ...ok("Built it."), steps: 9 })).toMatchObject({ go: true })
    expect(c.next({ ...ok("Nothing to do."), steps: 1 })).toMatchObject({ go: true })
    expect(c.next({ ...ok("Still nothing."), steps: 1 })).toMatchObject({
      go: false,
      why: "stalled",
    })
  })
})

describe("answering questions with the recommended option", () => {
  it("picks the option marked Recommended, else the first, for each question", () => {
    expect(
      recommendedAnswers({
        questions: [
          {
            question: "Which database?",
            options: [{ label: "SQLite" }, { label: "Postgres (Recommended)" }],
          },
          { question: "Which port?", options: [{ label: "8080" }, { label: "3000" }] },
          {
            question: "Which checks?",
            multiSelect: true,
            options: [
              { label: "Lint (Recommended)" },
              { label: "Types" },
              { label: "Tests (recommended)" },
            ],
          },
        ],
      }),
    ).toEqual({
      "Which database?": "Postgres (Recommended)",
      "Which port?": "8080",
      "Which checks?": "Lint (Recommended), Tests (recommended)",
    })
  })

  it("leaves it to you when there is nothing to choose from", () => {
    expect(recommendedAnswers({})).toBeUndefined()
    expect(
      recommendedAnswers({ questions: [{ question: "Anything else?", options: [] }] }),
    ).toBeUndefined()
    expect(recommendedAnswers({ questions: [{ options: [{ label: "Yes" }] }] })).toBeUndefined()
  })
})
