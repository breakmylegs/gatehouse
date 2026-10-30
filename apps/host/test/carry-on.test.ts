import { describe, expect, it } from "vitest"
import { CarryOn, recommendedAnswers } from "../src/carry-on.js"

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
