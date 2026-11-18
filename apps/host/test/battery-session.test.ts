// E-089: with "Pause Extreme approval sessions on battery" on, each working Extreme session pauses on battery, a limit
// reset never starts it again, mains power does (where it stopped), and a session you did not give a level starts
// lower on battery.
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"
import { LIMIT_RESUME_PROMPT } from "../src/carry-on.js"
import { buildStack, type Stack } from "./stack.js"

let s: Stack
beforeAll(async () => {
  s = await buildStack({ config: { extremeCarryOn: { turns: 5, usd: 100 } } })
}, 60000)
afterAll(() => s.stop())

const holdUntilStopped = (api: { signal: AbortSignal }) =>
  new Promise<void>((resolve) => {
    if (api.signal.aborted) return resolve()
    api.signal.addEventListener("abort", () => resolve())
  })

describe("Extreme approval on battery (E-089)", () => {
  it("pauses only Extreme sessions, waits through a limit reset, and starts again on mains", async () => {
    s.sdk.turn = async (api, text) => {
      if (text === "work") return holdUntilStopped(api)
      api.say("carrying on")
    }
    const extreme = await s.manager.start({ cwd: s.repo, extreme: true })
    const manual = await s.manager.start({ cwd: s.repo })
    extreme.prompt("work")
    await vi.waitFor(() => expect(extreme.info().state).toBe("running"))
    expect(await s.manager.pauseForBattery()).toBe(1)
    expect(extreme.info().paused).toMatchObject({ reason: "battery", wasRunning: true })
    expect(manual.info().paused).toBeUndefined()
    expect(await extreme.resume("limit-reset")).toBe(false)
    expect(extreme.info().paused).toBeDefined()
    await s.manager.resumeAfterBattery()
    expect(extreme.info().paused).toBeUndefined()
    await vi.waitFor(() => expect(s.sdk.queries.some((q) => q.prompts.includes(LIMIT_RESUME_PROMPT))).toBe(true))
    const resumed = s.records().filter((r) => r.session === extreme.id && r.event === "limit_resume")
    expect(resumed.at(-1)?.verdict.reason).toMatch(/mains power/)
  })

  it("starts a new session lower on battery, unless you chose its level", async () => {
    s.hooks.defaultResources = () => "low"
    try {
      expect((await s.manager.start({ cwd: s.repo })).restartOptions().resources).toBe("low")
      expect((await s.manager.start({ cwd: s.repo, resources: "high" })).restartOptions().resources).toBe("high")
    } finally {
      delete s.hooks.defaultResources
    }
    expect((await s.manager.start({ cwd: s.repo })).restartOptions().resources).toBe("high")
  })
})
