// D-090: measured time is said as a range with its sample size, against the baseline, or as not enough history.
import { describe, expect, it } from "vitest"
import { timeText } from "../src/components/MeasuredTime"

describe("measured time in words (D-090)", () => {
  it("gives both ranges, their sizes and the trend", () => {
    expect(
      timeText({ project: "api", now: { samples: 6, enough: true, minutes: { low: 4, median: 6, high: 9 } }, baseline: { samples: 5, enough: true, minutes: { low: 8, median: 12, high: 20 } }, trend: "faster" }, 30),
    ).toBe("api: a change took 4 to 9 minutes (typically 6) over 6 sessions in the last 30 days; 8 to 20 minutes (typically 12) over 5 sessions in the 30 days before. That is faster than your baseline.")
    expect(timeText({ project: "x", now: { samples: 2, enough: false }, baseline: { samples: 0, enough: false }, trend: "not enough history" }, 7)).toBe(
      "x: a change took not enough history (2 of 5 sessions) in the last 7 days; not enough history (0 of 5 sessions) in the 7 days before.",
    )
  })
})
