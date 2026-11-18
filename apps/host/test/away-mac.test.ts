// Mac fork (owner, 18 Nov): whether anyone is using the Mac, read from ioreg's HIDIdleTime, for the escalation ladder.
import { describe, expect, it } from "vitest"
import { AWAY_AFTER_MS, macAway, parseIdleMs } from "../src/away-mac.js"

const ioreg = (ns: number) => `    | |   "HIDIdleTime" = ${ns}\n`

describe("whether anyone is using the Mac", () => {
  it("reads the time since the last input, and nothing from output it does not know", () => {
    expect(parseIdleMs(ioreg(838_880_166))).toBeCloseTo(838.88)
    expect(parseIdleMs("+-o IOHIDSystem")).toBeUndefined()
  })

  it("is away after 2 minutes without input, and here before, or when ioreg cannot be read", async () => {
    const at = (out: string | Error) => macAway(async () => (out instanceof Error ? Promise.reject(out) : out))()
    expect(await at(ioreg(AWAY_AFTER_MS * 1e6))).toBe(true)
    expect(await at(ioreg((AWAY_AFTER_MS - 1000) * 1e6))).toBe(false)
    expect(await at("")).toBe(false)
    expect(await at(new Error("timed out"))).toBe(false)
  })
})
