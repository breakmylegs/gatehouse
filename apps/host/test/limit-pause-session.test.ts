// A session Codehouse pauses at the plan's 5-hour limit (owner, 31 Oct): it stops, nothing carries on by itself, it is
// recorded, and it starts again when the limit resets or when you start it.
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"
import { CARRY_ON_PROMPT, LIMIT_RESUME_PROMPT } from "../src/carry-on.js"
import { LimitPauser } from "../src/limit-pause.js"
import type { PlanUsage } from "../src/plan-usage.js"
import { OpenSessionsStore } from "../src/open-sessions.js"
import { buildStack, type Stack } from "./stack.js"
import type { SessionInfo } from "@gatehouse/shared/ws-protocol"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"

let s: Stack
beforeAll(async () => {
  s = await buildStack({
    hardTimeoutMs: 1500,
    phoneExpiryMs: 800,
    config: { extremeCarryOn: { turns: 5, usd: 100 } },
  })
}, 60000)
afterAll(() => s.stop())

const RESET = "2026-10-31T14:20:00+00:00"
const limit = (percent: number): PlanUsage => ({
  limits: [{ label: "5-hour limit", percent, resetsAt: RESET, group: "session" }],
  at: "2026-10-31T10:00:00Z",
})
const records = (id: string, event: string) =>
  s.records().filter((x) => x.session === id && x.event === event)

/** A turn that does not end until it is interrupted, as a long piece of work does. */
const holdUntilStopped = (api: { signal: AbortSignal }) =>
  new Promise<void>((resolve) => {
    if (api.signal.aborted) return resolve()
    api.signal.addEventListener("abort", () => resolve())
  })

describe("pausing a session", () => {
  it("stops the turn in hand, keeps Extreme from carrying on, and records it", async () => {
    s.sdk.turn = async (api, text) => {
      if (text === "work") return holdUntilStopped(api)
      api.say("ok")
    }
    const session = await s.manager.start({ cwd: s.repo, extreme: true })
    session.prompt("work")
    await vi.waitFor(() => expect(session.info().state).toBe("running"))
    const told: string[] = []
    session.on("event", (e) => told.push(e.type))
    await session.pause(96, RESET)
    expect(session.info()).toMatchObject({
      state: "idle",
      paused: { percent: 96, wasRunning: true, until: RESET },
    })
    expect(told).toContain("paused")
    expect(s.sdk.queries.at(-1)?.interrupts).toBeGreaterThan(0)
    // Extreme's carry-on does not follow the stopped turn.
    await new Promise((r) => setTimeout(r, 150))
    expect(s.sdk.queries.at(-1)?.prompts).toEqual(["work"])
    const rec = records(session.id, "limit_pause")
    expect(rec).toHaveLength(1)
    expect(rec[0]?.verdict).toMatchObject({
      ruleId: "limit-pause",
      decidedBy: "rules",
      outcome: "allow",
    })
  })

  it("starts a session that was working again where it stopped, once the limit resets", async () => {
    s.sdk.turn = async (api, text) => {
      if (text === "work") return holdUntilStopped(api)
      api.say(text === CARRY_ON_PROMPT ? "QUEUE EMPTY" : "carrying on")
    }
    const session = await s.manager.start({ cwd: s.repo, extreme: true })
    session.prompt("work")
    await vi.waitFor(() => expect(session.info().state).toBe("running"))
    await session.pause(97, RESET)
    expect(await session.resume("limit-reset")).toBe(true)
    expect(session.info().paused).toBeUndefined()
    await vi.waitFor(() => expect(s.sdk.queries.at(-1)?.prompts).toContain(LIMIT_RESUME_PROMPT))
    const rec = records(session.id, "limit_resume")
    expect(rec).toHaveLength(1)
    expect(rec[0]?.verdict).toMatchObject({ ruleId: "limit-resume", decidedBy: "rules" })
    // Nothing more to start: a second reset changes nothing.
    expect(await session.resume("limit-reset")).toBe(false)
  })

  it("only becomes ready again when it was idle, and says nothing to Claude", async () => {
    s.sdk.turn = async (api) => api.say("done")
    const session = await s.manager.start({ cwd: s.repo })
    await session.pause(95)
    expect(session.info().paused).toMatchObject({ wasRunning: false })
    await session.resume("you")
    expect(s.sdk.queries.at(-1)?.prompts).toEqual([])
    expect(records(session.id, "limit_resume")[0]?.verdict).toMatchObject({
      decidedBy: "human-desktop",
    })
  })

  it("is ended by your own message, which is you starting it again", async () => {
    s.sdk.turn = async (api) => api.say("done")
    const session = await s.manager.start({ cwd: s.repo })
    await session.pause(95)
    session.prompt("go on, I know")
    await vi.waitFor(() => expect(session.info().paused).toBeUndefined())
    await vi.waitFor(() => expect(records(session.id, "limit_resume")).toHaveLength(1))
    expect(s.sdk.queries.at(-1)?.prompts).toEqual(["go on, I know"])
  })

  it("stays paused while the kill switch is engaged, and starts again after", async () => {
    s.sdk.turn = async (api, text) => {
      if (text === "work") return holdUntilStopped(api)
      api.say("done")
    }
    const session = await s.manager.start({ cwd: s.repo })
    session.prompt("work")
    await vi.waitFor(() => expect(session.info().state).toBe("running"))
    await session.pause(95)
    await s.kill.engage("desktop", "test")
    try {
      await expect(session.resume("limit-reset")).rejects.toThrow()
      expect(session.info().paused).toBeDefined()
    } finally {
      await s.kill.rearm("desktop")
    }
    expect(await session.resume("limit-reset")).toBe(true)
  })
})

describe("the pauser on real sessions", () => {
  it("pauses and starts again the sessions of an account from the plan numbers", async () => {
    s.sdk.turn = async (api) => api.say("done")
    const session = await s.manager.start({ cwd: s.repo })
    let percent = 96
    let now = Date.parse("2026-10-31T10:00:00Z")
    const pauser = new LimitPauser({
      sessions: () => s.manager.liveSessions(),
      planUsage: async () => limit(percent),
      now: () => now,
      log: () => undefined,
    })
    await pauser.check()
    expect(session.info().paused).toMatchObject({ percent: 96, until: RESET })
    now = Date.parse(RESET) + 1000
    percent = 2
    await pauser.check()
    expect(session.info().paused).toBeUndefined()
  })
})

describe("a pause across a restart", () => {
  const A = "019a0000-0000-7000-8000-0000000000a1"
  const info = (over: Partial<SessionInfo>): SessionInfo => ({
    id: A,
    cwd: "C:/dev/a",
    project: "a",
    mode: "default",
    extreme: false,
    state: "idle",
    pendingApprovals: 0,
    createdAt: "2026-10-31T10:00:00Z",
    ...over,
  })

  it("is saved, read back, and ended when the session starts again", async () => {
    const f = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "gh-pause-")), "open.json")
    const store = new OpenSessionsStore(f)
    store.note(info({ paused: { percent: 97, wasRunning: true, until: RESET } }))
    await store.flush()
    expect(new OpenSessionsStore(f).list()[0]?.paused).toEqual({
      percent: 97,
      wasRunning: true,
      until: RESET,
    })
    store.note(info({}))
    await store.flush()
    expect(new OpenSessionsStore(f).list()[0]?.paused).toBeUndefined()
    // Something that is not a pause Codehouse understands is not one.
    fs.writeFileSync(
      f,
      JSON.stringify({
        version: 1,
        sessions: [{ id: A, cwd: "C:/dev/a", paused: { percent: "lots" } }],
      }),
    )
    expect(new OpenSessionsStore(f).list()[0]?.paused).toBeUndefined()
  })

  it("comes back paused, does not carry on by itself, and starts again at the reset", async () => {
    s.sdk.turn = async (api) => api.say("done")
    const session = await s.manager.start({
      cwd: s.repo,
      extreme: true,
      restore: {
        id: "019a0000-0000-7000-8000-0000000000a2",
        createdAt: "2026-10-31T09:00:00Z",
        wasRunning: true,
        paused: { percent: 97, wasRunning: true, until: RESET },
      },
    })
    expect(session.info().paused).toMatchObject({ percent: 97, until: RESET })
    await new Promise((r) => setTimeout(r, 100))
    expect(s.sdk.queries.at(-1)?.prompts).toEqual([])
    expect(await session.resume("limit-reset")).toBe(true)
    await vi.waitFor(() => expect(s.sdk.queries.at(-1)?.prompts).toEqual([LIMIT_RESUME_PROMPT]))
  })
})
