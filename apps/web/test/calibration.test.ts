// D-078: a model's claim calibration is said in words, with how many claims it rests on.
import { describe, expect, it } from "vitest"
import { calibrationText } from "../src/components/FailureTaxonomy"

describe("claim calibration in words (D-078)", () => {
  it("gives the share that held, the counts, and says when there are too few", () => {
    expect(calibrationText({ model: "claude-opus-5-5", verified: 3, contradicted: 1, unverified: 2, flaky: 1, score: 0.75, few: true })).toBe(
      "75% of claude-opus-5-5's checked claims held (3 of 4); 2 could not be checked, 1 met flaky tests. Too few to go on yet.",
    )
    expect(calibrationText({ model: "m", verified: 9, contradicted: 1, unverified: 0, flaky: 0, score: 0.9, few: false })).toBe("90% of m's checked claims held (9 of 10).")
    expect(calibrationText({ model: "m", verified: 0, contradicted: 0, unverified: 2, flaky: 0, few: true })).toBe("No claim of m's could be checked yet (2 unchecked).")
  })
})
