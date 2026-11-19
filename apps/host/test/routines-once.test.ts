// T-119: a routine can run once at a date and time, and its runs can carry on the last conversation; each is checked.
import { describe, expect, it } from "vitest"
import { checkRoutine, isDue, RoutineError, type Routine } from "../src/routines.js"

const base = { name: "Tidy", folder: "C:\\dev\\shop", prompt: "Tidy the docs" }

describe("one-off routines and where runs go (T-119)", () => {
  it("takes a date and time instead of days, and refuses one that is not a date", () => {
    expect(checkRoutine({ ...base, once: "2026-12-01T09:00" })).toMatchObject({ once: "2026-12-01T09:00", time: "09:00", days: [], enabled: true })
    expect(() => checkRoutine({ ...base, once: "tomorrow" })).toThrow(RoutineError)
    expect(() => checkRoutine({ ...base, once: "2026-13-45T09:00" })).toThrow(RoutineError)
    expect(checkRoutine({ ...base, time: "07:30", days: ["mon"], into: "continue" })).toMatchObject({ into: "continue" })
    expect(checkRoutine({ ...base, time: "07:30", days: ["mon"], into: "sideways" as never })).not.toHaveProperty("into")
  })

  it("is due once, within the hour after its time, and never again", () => {
    const r = { id: "r1", ...checkRoutine({ ...base, once: "2026-12-01T09:00" }) } as Routine
    expect(isDue(r, new Date("2026-12-01T08:59:00"))).toBe(false)
    expect(isDue(r, new Date("2026-12-01T09:10:00"))).toBe(true)
    expect(isDue(r, new Date("2026-12-01T10:05:00"))).toBe(false)
    expect(isDue({ ...r, lastRun: "2026-12-01" }, new Date("2026-12-01T09:10:00"))).toBe(false)
    expect(isDue({ ...r, enabled: false }, new Date("2026-12-01T09:10:00"))).toBe(false)
  })
})
