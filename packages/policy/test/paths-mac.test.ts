import { describe, expect, it } from "vitest"
import { normaliseRaw } from "../src/paths.js"
import { isLocalAbsolute } from "../src/paths-mac.js"

describe("paths on a Mac in the policy", () => {
  it("keeps /c and /mnt/d as the folders they are on a Mac, not Windows drives", () => {
    expect(normaliseRaw("/c/dev/x", "darwin")).toBe("/c/dev/x")
    expect(normaliseRaw("/mnt/d/x", "darwin")).toBe("/mnt/d/x")
    expect(normaliseRaw("/Users/you/dev", "darwin")).toBe("/Users/you/dev")
    expect(normaliseRaw("/c/dev/x", "win32")).toBe("C:/dev/x")
  })

  it("lets a remembered file rule name a Mac path on a Mac, and only a drive path on Windows", () => {
    expect(isLocalAbsolute("/Users/you/dev/app/src/a.ts", "darwin")).toBe(true)
    expect(isLocalAbsolute("/", "darwin")).toBe(false)
    expect(isLocalAbsolute("//server/share/a.ts", "darwin")).toBe(false)
    expect(isLocalAbsolute("src/a.ts", "darwin")).toBe(false)
    expect(isLocalAbsolute("C:/dev/app/a.ts", "win32")).toBe(true)
    expect(isLocalAbsolute("C:\\dev\\app\\a.ts", "win32")).toBe(true)
    expect(isLocalAbsolute("/Users/you/a.ts", "win32")).toBe(false)
  })
})
