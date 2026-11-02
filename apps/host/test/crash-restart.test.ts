// A session that was working when its Claude Code crashed is started again on the same conversation and carries on
// (owner, 1 Nov: a crash when Windows ran out of memory stopped a build session, screenshot 118c19).
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest"
import { CRASH_RESUME_PROMPT } from "../src/crash.js"
import type { Session } from "../src/sessions.js"
import { buildStack, type Stack } from "./stack.js"

const CRASH = "Claude Code process exited with code 3221226505"

let s: Stack
beforeAll(async () => {
  s = await buildStack()
}, 60000)
afterAll(() => s.stop())
afterEach(() => vi.restoreAllMocks())

/** A session whose first turn waits until released, so it is working when the process crashes. */
async function working(): Promise<{ session: Session; release: () => void }> {
  let release: () => void = () => undefined
  s.sdk.turn = async (api, text) => {
    if (text === CRASH_RESUME_PROMPT) return api.say("Carried on.")
    await new Promise<void>((r) => (release = r))
    api.say("Done.")
  }
  const session = await s.manager.start({ cwd: s.repo })
  session.prompt("build the next item")
  await vi.waitFor(() => expect(s.sdk.queries.at(-1)?.prompts).toEqual(["build the next item"]))
  return { session, release: () => release() }
}

const restarts = (id: string) =>
  s.records().filter((r) => r.event === "session_restarted_after_crash" && r.session === id)

describe("after Claude Code crashes", () => {
  it("starts a working session again on the same conversation, under the same id, and records it", async () => {
    const { session } = await working()
    const before = s.sdk.queries.length
    const conversation = session.info().sdkSessionId
    s.sdk.queries.at(-1)?.crash(CRASH)
    await vi.waitFor(() => expect(s.sdk.queries.length).toBe(before + 1), { timeout: 15_000 })
    const again = s.manager.get(session.id)
    expect(again).toBeDefined()
    expect(again).not.toBe(session)
    expect(s.sdk.queries.at(-1)?.options.resume).toBe(conversation)
    await vi.waitFor(() => expect(s.sdk.queries.at(-1)?.prompts).toEqual([CRASH_RESUME_PROMPT]), {
      timeout: 15_000,
    })
    expect(again?.info().restarted).toEqual({ wasRunning: true, crashed: true })
    expect(restarts(session.id)).toHaveLength(1)
    expect(restarts(session.id)[0]?.verdict.ruleId).toBe("session-restarted-after-crash")
    await again?.close()
  })

  it("leaves an idle session stopped, with the reason in words", async () => {
    s.sdk.turn = async (api) => api.say("Done.")
    const session = await s.manager.start({ cwd: s.repo })
    const before = s.sdk.queries.length
    s.sdk.queries.at(-1)?.crash(CRASH)
    await vi.waitFor(() => expect(session.info().state).toBe("error"))
    await new Promise((r) => setTimeout(r, 300))
    expect(s.sdk.queries.length).toBe(before)
    expect(session.info().error).toContain("low on memory")
    expect(session.info().error).toContain("0xC0000409")
    expect(restarts(session.id)).toHaveLength(0)
  })

  it("starts one at most twice in 30 minutes, so a process that keeps crashing stays stopped", async () => {
    const { session } = await working()
    // Each start carries on with a turn that never ends, so it is working when it crashes again.
    s.sdk.turn = async () => new Promise<void>(() => undefined)
    for (let n = 1; n <= 3; n++) {
      if (n > 1)
        await vi.waitFor(
          () => expect(s.sdk.queries.at(-1)?.prompts).toEqual([CRASH_RESUME_PROMPT]),
          { timeout: 15_000 },
        )
      const live = s.manager.get(session.id)
      const before = s.sdk.queries.length
      s.sdk.queries.at(-1)?.crash(CRASH)
      if (n < 3)
        await vi.waitFor(() => expect(s.sdk.queries.length).toBe(before + 1), { timeout: 15_000 })
      else {
        await vi.waitFor(() => expect(live?.info().state).toBe("error"))
        await new Promise((r) => setTimeout(r, 300))
        expect(s.sdk.queries.length).toBe(before)
      }
    }
    expect(restarts(session.id)).toHaveLength(2)
  })

  it("does not start one again with the kill switch engaged", async () => {
    const { session } = await working()
    vi.spyOn(s.kill, "isEngaged").mockReturnValue(true)
    const before = s.sdk.queries.length
    s.sdk.queries.at(-1)?.crash(CRASH)
    await vi.waitFor(() => expect(session.info().state).toBe("error"))
    await new Promise((r) => setTimeout(r, 300))
    expect(s.sdk.queries.length).toBe(before)
    expect(restarts(session.id)).toHaveLength(0)
  })

  it("does not start one again when the restart cannot be recorded", async () => {
    const { session } = await working()
    const record = s.audit.record.bind(s.audit)
    vi.spyOn(s.audit, "record").mockImplementation(async (e) =>
      e.event === "session_restarted_after_crash" ? false : record(e),
    )
    const before = s.sdk.queries.length
    s.sdk.queries.at(-1)?.crash(CRASH)
    await vi.waitFor(() => expect(session.info().state).toBe("error"))
    await new Promise((r) => setTimeout(r, 300))
    expect(s.sdk.queries.length).toBe(before)
  })

  it("does not start one again after a plain exit, which can be Claude Code refusing to go on", async () => {
    const { session } = await working()
    const before = s.sdk.queries.length
    s.sdk.queries.at(-1)?.crash("Claude Code process exited with code 1")
    await vi.waitFor(() => expect(session.info().state).toBe("error"))
    await new Promise((r) => setTimeout(r, 300))
    expect(s.sdk.queries.length).toBe(before)
    expect(session.info().error).toBe("Claude Code process exited with code 1")
  })
})
