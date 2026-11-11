// Mac fork: Settings, Updates in Codehouse.app says how a Mac copy is updated, not git pull or Codehouse-Setup.exe.
import { describe, expect, it } from "vitest"
import { macAppWhy } from "../src/update/why-mac.js"

describe("updates in the Mac app", () => {
  it("says a newer Codehouse.app replaces it, only when the Mac app started the Host", () => {
    expect(macAppWhy({ GATEHOUSE_MAC_APP_VERSION: "2.0.170" })).toMatch(/newer Codehouse\.app/)
    expect(macAppWhy({ GATEHOUSE_MAC_APP_VERSION: "2.0.170" })).not.toMatch(/git pull|Setup\.exe/)
    expect(macAppWhy({})).toBeUndefined()
  })
})
