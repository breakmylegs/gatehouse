// @vitest-environment jsdom
// Backlog G29: a remembered rule unused for 90 days is marked, counting from its last use, or from when it was added.
import { describe, expect, it } from "vitest"
import { isStale, STALE_DAYS } from "../src/surfaces/PolicyChoices"

const DAY = 86_400_000
const now = Date.parse("2026-11-08T12:00:00Z")
const ago = (days: number) => new Date(now - days * DAY).toISOString()

describe("rules not used for a while", () => {
  it("counts from the last use, else from when it was added, and never marks what it does not know", () => {
    expect(STALE_DAYS).toBe(90)
    expect(isStale({ id: "a", uses: 3, lastUsed: ago(10), createdAt: ago(400) }, now)).toBe(false)
    expect(isStale({ id: "a", uses: 3, lastUsed: ago(91) }, now)).toBe(true)
    expect(isStale({ id: "a", uses: 0, createdAt: ago(89) }, now)).toBe(false)
    expect(isStale({ id: "a", uses: 0, createdAt: ago(120) }, now)).toBe(true)
    expect(isStale({ id: "a", uses: 0 }, now)).toBe(false)
    expect(isStale(undefined, now)).toBe(false)
  })
})
