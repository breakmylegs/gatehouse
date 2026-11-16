// T-006 (t3code review): a scratch folder name is dated, with a short random tail, and is a clean folder name.
import { describe, expect, it } from "vitest"
import { cleanName } from "@gatehouse/shared/project-name"
import { scratchName } from "../src/lib/scratch"

describe("scratch folders (T-006)", () => {
  it("names a dated folder that stays as it is when cleaned", () => {
    const n = scratchName(new Date("2026-11-15T09:00:00Z"), () => 0)
    expect(n).toBe("scratch-2026-11-15-aaaa")
    expect(cleanName(n)).toBe(n)
    expect(scratchName()).toMatch(/^scratch-\d{4}-\d{2}-\d{2}-[a-z2-9]{4}$/)
  })
})
