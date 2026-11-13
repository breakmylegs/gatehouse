import { describe, expect, it } from "vitest"
import { commitPercent } from "../src/memory-governor.js"
import { macMemoryReader, parseSysctl } from "../src/memory-governor-mac.js"

const GB16 = 17179869184

describe("the memory governor on a Mac", () => {
  it("reads the share of memory in use from sysctl, so Settings' point means the same as on Windows", () => {
    const r = parseSysctl(`${GB16}\n12\n`)
    expect(r).toEqual({
      commitUsed: 88,
      commitLimit: 100,
      physTotal: GB16,
      physAvail: Math.round(GB16 * 0.12),
    })
    expect(commitPercent(r)).toBe(88)
    expect(commitPercent(parseSysctl(`${GB16}\n70\n`))).toBe(30)
  })

  it("has no reading, and so refuses nothing, when sysctl says something that makes no sense", () => {
    for (const bad of ["", "abc", `${GB16}`, `0\n50`, `${GB16}\n101`, `${GB16}\n-1`])
      expect(parseSysctl(bad)).toBeUndefined()
  })

  it("asks sysctl for exactly the two values, and gives no reading when it fails", async () => {
    const calls: Array<{ file: string; args: string[] }> = []
    const ok = macMemoryReader(async (file, args) => {
      calls.push({ file, args })
      return `${GB16}\n40\n`
    })
    expect(commitPercent(await ok())).toBe(60)
    expect(calls).toEqual([
      { file: "/usr/sbin/sysctl", args: ["-n", "hw.memsize", "kern.memorystatus_level"] },
    ])
    const failing = macMemoryReader(async () => {
      throw new Error("sysctl: unknown oid")
    })
    expect(await failing()).toBeUndefined()
  })
})
