// D-025, the dead-man timer for Extreme approval: off by default; on, an Extreme session pauses when nothing is heard
// from you in time, and anything you do, on the desktop or signed on the phone, starts it again.
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"
import { buildStack, type Stack } from "./stack.js"

let s: Stack
beforeAll(async () => {
  // A minute of the timer is 400 ms here, looked at every 50 ms.
  s = await buildStack({ hardTimeoutMs: 20_000, phoneExpiryMs: 10_000, deadman: { minuteMs: 400, lookMs: 50 } })
}, 60000)
afterAll(async () => {
  for (const x of s.manager.liveSessions()) await x.close()
  await s.stop()
})

describe("the dead-man timer (D-025)", () => {
  it("pauses an Extreme session with N = 1 within the minute and a little, recorded, and only you start it again", async () => {
    s.sdk.turn = async (api) => api.say("ok")
    const session = await s.manager.start({ cwd: s.repo, extreme: true })
    await session.setDeadman(1)
    const set = Date.now()
    await vi.waitFor(() => expect(session.info().paused).toMatchObject({ reason: "heartbeat" }), { timeout: 3000 })
    // The equivalent of 70 seconds with real minutes.
    expect(Date.now() - set).toBeLessThan((70 / 60) * 400 + 200)
    expect(s.records().some((r) => r.event === "extreme_heartbeat_missed" && r.session === session.id)).toBe(true)
    expect(await session.resume("limit-reset")).toBe(false)
    expect(await session.resume("you")).toBe(true)
    await session.close()
  })

  it("starts again when you are heard from, as a phone heartbeat does", async () => {
    s.sdk.turn = async (api) => api.say("ok")
    const session = await s.manager.start({ cwd: s.repo, extreme: true })
    await session.setDeadman(1)
    // A heartbeat from the phone (what PhoneService calls) every 300 ms keeps it going past the minute.
    for (let i = 0; i < 6; i++) {
      await new Promise((r) => setTimeout(r, 300))
      s.manager.heartbeat()
    }
    expect(session.info().paused).toBeUndefined()
    await vi.waitFor(() => expect(session.info().paused).toMatchObject({ reason: "heartbeat" }), { timeout: 3000 })
    await session.close()
  })

  it("is off by default, and never pauses a session that is not in Extreme approval", async () => {
    s.sdk.turn = async (api) => api.say("ok")
    const plain = await s.manager.start({ cwd: s.repo, extreme: true })
    const manual = await s.manager.start({ cwd: s.repo })
    await manual.setDeadman(1)
    await new Promise((r) => setTimeout(r, 900))
    expect(plain.info().deadman).toBeUndefined()
    expect(plain.info().paused).toBeUndefined()
    expect(manual.info().paused).toBeUndefined()
    await plain.close()
    await manual.close()
  })
})
