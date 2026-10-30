import { describe, expect, it } from "vitest"
import { age, clock, commandText, money, riskBand, stamp } from "../src/lib/format"

describe("format", () => {
  it("bands risk at 40, 70 and 85", () => {
    expect([0, 39, 40, 69, 70, 84, 85, 100].map(riskBand)).toEqual([
      "Low",
      "Low",
      "Moderate",
      "Moderate",
      "High",
      "High",
      "Severe",
      "Severe",
    ])
  })
  it("ages in words", () => {
    const now = Date.parse("2026-01-01T12:00:00Z")
    expect(age("2026-01-01T11:59:30Z", now)).toBe("30s")
    expect(age("2026-01-01T11:55:00Z", now)).toBe("5 min")
    expect(age("2026-01-01T09:00:00Z", now)).toBe("3 h")
    expect(age("2025-12-30T12:00:00Z", now)).toBe("2 d")
    expect(age("2026-01-01T12:05:00Z", now)).toBe("0s")
  })
  it("gives an empty clock for a bad date and formats money", () => {
    expect(clock("nonsense")).toBe("")
    expect(money(0.1234)).toBe("$0.123")
    expect(money(12.3456)).toBe("$12.35")
  })
  it("shows a shell command as typed and anything else as full JSON", () => {
    expect(commandText("Bash", { command: "ls -la" })).toBe("ls -la")
    expect(commandText("PowerShell", { command: "Get-Date" })).toBe("Get-Date")
    expect(commandText("Write", { file_path: "a", content: "b" })).toBe(
      JSON.stringify({ file_path: "a", content: "b" }, null, 2),
    )
    expect(commandText("Bash", { nope: 1 })).toContain("nope")
  })
})

describe("the time beside a message", () => {
  const now = new Date(2026, 9, 30, 15, 30).getTime()
  it("is the time today, the day and month earlier this year, and the year before that", () => {
    expect(stamp(new Date(2026, 9, 30, 14, 2).getTime(), now)).toBe("14:02")
    expect(stamp(new Date(2026, 9, 29, 9, 5).getTime(), now)).toBe("29 Oct, 09:05")
    expect(stamp(new Date(2025, 11, 31, 23, 59).getTime(), now)).toBe("31 Dec 2025, 23:59")
  })
})
