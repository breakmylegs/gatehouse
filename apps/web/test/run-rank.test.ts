// C-044: best of N runs in worktrees, ranked by their checks first (passing, not run, failing), then the size of their
// change (smaller first), then the calls that asked you or were stopped (fewer first).
import { describe, expect, it } from "vitest"
import { rankRuns } from "../src/lib/run-rank"

describe("ranking runs (C-044)", () => {
  it("puts passing checks first, then the smaller change, then fewer calls that asked", () => {
    expect(
      rankRuns([
        { id: "failing-small", testsFailing: true, lines: 4, hits: 0 },
        { id: "passing-big", testsFailing: false, lines: 400, hits: 0 },
        { id: "passing-small", testsFailing: false, lines: 12, hits: 3 },
        { id: "not-run", lines: 1, hits: 0 },
      ]),
    ).toEqual(["passing-small", "passing-big", "not-run", "failing-small"])
  })

  it("breaks a tie on size by the calls that asked, then keeps the order given", () => {
    expect(rankRuns([{ id: "a", testsFailing: false, lines: 10, hits: 2 }, { id: "b", testsFailing: false, lines: 10, hits: 0 }])).toEqual(["b", "a"])
    expect(rankRuns([{ id: "a", hits: 0 }, { id: "b", hits: 0 }])).toEqual(["a", "b"])
    // A run whose change is not read yet goes after one whose is.
    expect(rankRuns([{ id: "unknown", testsFailing: false, hits: 0 }, { id: "known", testsFailing: false, lines: 900, hits: 0 }])).toEqual(["known", "unknown"])
  })
})
