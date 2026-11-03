// B18: one effort scale; Settings can cap it, and the Host holds every session to the cap.
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { aboveCap, capEffort, EFFORT_ORDER } from "@gatehouse/shared"
import { buildStack, type Stack } from "./stack.js"

let s: Stack
beforeAll(async () => {
  s = await buildStack({ hardTimeoutMs: 1500, phoneExpiryMs: 800 })
}, 60000)
afterAll(() => s.stop())
const setCap = (cap: string | undefined) => {
  const c = s.deps.config() as { effortCap?: string }
  if (cap) c.effortCap = cap
  else delete c.effortCap
}

describe("the effort cap", () => {
  it("is one scale, least first, and caps only what is above it", () => {
    expect(EFFORT_ORDER).toEqual(["low", "medium", "high", "xhigh", "max"])
    expect(capEffort("max", "high")).toBe("high")
    expect(capEffort("low", "high")).toBe("low")
    expect(capEffort("max", undefined)).toBe("max")
    expect([
      aboveCap("xhigh", "high"),
      aboveCap("high", "high"),
      aboveCap("max", undefined),
    ]).toEqual([true, false, false])
  })

  it("starts a session asked for more at the cap, says so in its info, and refuses a change above it", async () => {
    setCap("high")
    try {
      const session = await s.manager.start({ cwd: s.repo, effort: "max" })
      expect(session.info()).toMatchObject({ effort: "high", effortCap: "high" })
      await expect(session.setEffort("xhigh")).rejects.toThrow(/limits effort to high/)
      await session.setEffort("low")
      expect(session.info().effort).toBe("low")
    } finally {
      setCap(undefined)
    }
    const free = await s.manager.start({ cwd: s.repo, effort: "max" })
    expect(free.info().effort).toBe("max")
    expect(free.info().effortCap).toBeUndefined()
  })
})
