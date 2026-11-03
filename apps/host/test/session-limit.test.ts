// B09: the most sessions open at once, over the whole computer, set in Settings.
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { SessionLimitError } from "../src/sessions.js"
import { buildStack, type Stack } from "./stack.js"

let s: Stack
beforeAll(async () => {
  s = await buildStack({ hardTimeoutMs: 1500, phoneExpiryMs: 800 })
}, 60000)
afterAll(() => s.stop())
const setLimit = (n: number | undefined) => {
  const c = s.deps.config() as { maxSessions?: number }
  if (n === undefined) delete c.maxSessions
  else c.maxSessions = n
}

describe("the limit on sessions open at once", () => {
  it("refuses one more at the limit, says why, touches none that are open, and allows one again after a close", async () => {
    setLimit(2)
    try {
      const a = await s.manager.start({ cwd: s.repo })
      const b = await s.manager.start({ cwd: s.repo })
      await expect(s.manager.start({ cwd: s.repo })).rejects.toThrow(SessionLimitError)
      await expect(s.manager.start({ cwd: s.repo })).rejects.toThrow(/2 sessions are open/)
      expect([a.live, b.live]).toEqual([true, true])
      await b.close()
      const c = await s.manager.start({ cwd: s.repo })
      expect(c.live).toBe(true)
      for (const x of [a, c]) await x.close()
    } finally {
      setLimit(undefined)
    }
  })

  it("has no limit until one is set", async () => {
    const open = []
    for (let i = 0; i < 3; i++) open.push(await s.manager.start({ cwd: s.repo }))
    expect(open.every((x) => x.live)).toBe(true)
    for (const x of open) await x.close()
  })
})
