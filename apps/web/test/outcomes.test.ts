// D-100: the estimate is shown with its range and how many sessions it rests on, or as not enough history.
import { describe, expect, it } from "vitest"
import { estimateText } from "../src/components/Outcomes"

describe("the estimate's words (D-100)", () => {
  it("names the range and the sample size, or says there is not enough history", () => {
    expect(estimateText({ samples: 3, enough: false })).toBe("Not enough history for an estimate yet: 3 sessions with a change, and it needs 5.")
    expect(estimateText({ samples: 8, enough: true, costUsd: { low: 0.5, median: 1.2, high: 3 }, minutes: { low: 4, median: 9, high: 20 } })).toBe(
      "A change here usually costs $0.50 to $3.00 (typically $1.20), 4 to 20 minutes of Claude's time, from 8 sessions.",
    )
  })
})
