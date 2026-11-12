// Mac fork: Settings, Updates in Codehouse.app says how a Mac copy is updated, not git pull or Codehouse-Setup.exe.
import { describe, expect, it } from "vitest"
import { compareVersions, isNewer, parseVersion } from "../src/update/version.js"
import { macAppWhy } from "../src/update/why-mac.js"

describe("updates in the Mac app", () => {
  it("says a newer Codehouse.app replaces it, only when the Mac app started the Host", () => {
    expect(macAppWhy({ GATEHOUSE_MAC_APP_VERSION: "2.0.170" })).toMatch(/newer Codehouse\.app/)
    expect(macAppWhy({ GATEHOUSE_MAC_APP_VERSION: "2.0.170" })).not.toMatch(/git pull|Setup\.exe/)
    expect(macAppWhy({})).toBeUndefined()
  })

  it("reads a Mac build as the upstream release it is made from (scripts/package-mac.mjs numbers it so)", () => {
    // 2.0.264+mac.25: upstream's 2.0.264 and 25 Mac commits. Up to date with 2.0.264, behind the next release.
    expect(compareVersions("2.0.264+mac.25", "2.0.264")).toBe(0)
    expect(isNewer("2.0.264", "2.0.264+mac.25")).toBe(false)
    expect(isNewer("2.0.270", "2.0.264+mac.25")).toBe(true)
    expect(parseVersion("2.0.264+mac.25.dev")).toEqual({ nums: [2, 0, 264] })
  })
})
