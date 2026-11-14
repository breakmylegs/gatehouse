// O35 (owner, 14 Nov): a session says when its state last changed, so the strip along the top can run most recently
// active first. It starts at the session's start, and moves on when a turn begins and ends.
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { buildStack, type Stack } from "./stack.js"

let s: Stack
beforeAll(async () => {
  s = await buildStack({ hardTimeoutMs: 1500, phoneExpiryMs: 800 })
}, 60000)
afterAll(() => s.stop())

describe("when a session was last active (O35)", () => {
  it("moves on when a turn runs", async () => {
    s.sdk.turn = async (api) => api.say("Done.")
    const session = await s.manager.start({ cwd: s.repo })
    const first = session.info().activeAt!
    expect(Date.parse(first)).toBeGreaterThanOrEqual(Date.parse(session.info().createdAt))
    await new Promise((r) => setTimeout(r, 20))
    const done = new Promise<void>((r) => session.on("message", (m) => m.type === "result" && r()))
    session.prompt("go")
    await done
    expect(Date.parse(session.info().activeAt!)).toBeGreaterThan(Date.parse(first))
  })
})
