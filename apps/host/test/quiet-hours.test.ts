import { describe, expect, it } from "vitest"
import { msUntilPhoneAllowed, phoneHeld, type QuietHours } from "../src/quiet-hours.js"

const london: QuietHours = { start: "22:00", end: "07:00", tz: "Europe/London", phone: false }
const at = (iso: string) => new Date(iso)

describe("phoneHeld", () => {
  it("holds the phone inside a window that crosses midnight", () => {
    // 2026-01-15 is winter, London is UTC.
    expect(phoneHeld(at("2026-01-15T22:00:00Z"), london)).toBe(true)
    expect(phoneHeld(at("2026-01-15T23:59:00Z"), london)).toBe(true)
    expect(phoneHeld(at("2026-01-16T00:00:00Z"), london)).toBe(true)
    expect(phoneHeld(at("2026-01-16T06:59:00Z"), london)).toBe(true)
    expect(phoneHeld(at("2026-01-16T07:00:00Z"), london)).toBe(false)
    expect(phoneHeld(at("2026-01-15T12:00:00Z"), london)).toBe(false)
    expect(phoneHeld(at("2026-01-15T21:59:00Z"), london)).toBe(false)
  })

  it("follows the time zone, including summer time", () => {
    // 2026-07-15 is summer, London is UTC+1, so 21:30Z is 22:30 local and 06:30Z is 07:30 local.
    expect(phoneHeld(at("2026-07-15T21:30:00Z"), london)).toBe(true)
    expect(phoneHeld(at("2026-07-16T06:30:00Z"), london)).toBe(false)
    expect(phoneHeld(at("2026-07-15T20:59:00Z"), london)).toBe(false)
    const newYork: QuietHours = {
      start: "22:00",
      end: "07:00",
      tz: "America/New_York",
      phone: false,
    }
    expect(phoneHeld(at("2026-01-16T03:30:00Z"), newYork)).toBe(true) // 22:30 local
    expect(phoneHeld(at("2026-01-16T13:00:00Z"), newYork)).toBe(false) // 08:00 local
  })

  it("handles a window inside one day and an empty window", () => {
    const lunch: QuietHours = { start: "12:00", end: "13:00", tz: "UTC", phone: false }
    expect(phoneHeld(at("2026-01-15T12:30:00Z"), lunch)).toBe(true)
    expect(phoneHeld(at("2026-01-15T13:00:00Z"), lunch)).toBe(false)
    expect(phoneHeld(at("2026-01-15T12:30:00Z"), { ...lunch, start: "12:00", end: "12:00" })).toBe(
      false,
    )
  })

  it("does not hold anything when phone is true or there are no quiet hours", () => {
    expect(phoneHeld(at("2026-01-15T23:00:00Z"), { ...london, phone: true })).toBe(false)
    expect(phoneHeld(at("2026-01-15T23:00:00Z"), undefined)).toBe(false)
  })
})

describe("msUntilPhoneAllowed", () => {
  it("is undefined outside quiet hours", () => {
    expect(msUntilPhoneAllowed(at("2026-01-15T12:00:00Z"), london)).toBeUndefined()
    expect(msUntilPhoneAllowed(at("2026-01-15T12:00:00Z"), undefined)).toBeUndefined()
  })

  it("counts to just after the window ends", () => {
    const now = at("2026-01-15T23:00:00Z")
    const ms = msUntilPhoneAllowed(now, london) as number
    // 07:00 is 8 hours away. The timer is set a second late so it fires after the window has ended.
    expect(ms).toBe(8 * 3600_000 + 1000)
    expect(phoneHeld(new Date(now.getTime() + ms), london)).toBe(false)
  })

  it("works from the middle of a minute", () => {
    const now = at("2026-01-16T06:59:30Z")
    const ms = msUntilPhoneAllowed(now, london) as number
    expect(ms).toBeGreaterThan(0)
    expect(ms).toBeLessThanOrEqual(31_000)
    expect(phoneHeld(new Date(now.getTime() + ms), london)).toBe(false)
  })
})
