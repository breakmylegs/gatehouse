// Extreme approval never waits on you: questions get the recommended answer, plans are approved, and the session
// carries on with its build queue by itself until it is empty (owner, 30 Oct; CLAUDE.md invariant 3).
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"
import { CARRY_ON_PROMPT, RESUME_PROMPT } from "../src/carry-on.js"
import type { Session } from "../src/sessions.js"
import type { ToolCallResult } from "./fake-sdk.js"
import { buildStack, type Stack } from "./stack.js"

let s: Stack
beforeAll(async () => {
  s = await buildStack({
    hardTimeoutMs: 1500,
    phoneExpiryMs: 800,
    config: { extremeCarryOn: { turns: 3, usd: 100 } },
  })
}, 60000)
afterAll(() => s.stop())

const results = (session: Session) => {
  let n = 0
  session.on("message", (m) => {
    if (m.type === "result") n++
  })
  return () => n
}

describe("Extreme approval", () => {
  it("answers a question with the recommended option and records who answered", async () => {
    let r: ToolCallResult | undefined
    s.sdk.turn = async (api, text) => {
      if (text === CARRY_ON_PROMPT) return api.say("QUEUE EMPTY")
      r = await api.callTool("AskUserQuestion", {
        questions: [
          {
            question: "Which database?",
            options: [{ label: "SQLite" }, { label: "Postgres (Recommended)" }],
          },
        ],
      })
    }
    const session = await s.manager.start({ cwd: s.repo, extreme: true })
    session.prompt("build it")
    await vi.waitFor(() => expect(r).toBeDefined())
    expect(r).toMatchObject({ executed: true })
    expect(r?.input).toMatchObject({ answers: { "Which database?": "Postgres (Recommended)" } })
    expect(s.broker.list()).toEqual([])
    const rec = s
      .records()
      .filter((x) => x.event === "question_answered")
      .at(-1)
    expect(rec?.verdict).toMatchObject({ outcome: "allow", decidedBy: "extreme-mode" })
  })

  it("carries on by itself until Claude says the queue is empty, and records each time", async () => {
    let left = 2
    s.sdk.turn = async (api, text) => {
      await api.callTool("Glob", { pattern: "*.md" })
      if (text !== CARRY_ON_PROMPT) return api.say("Built the first item.")
      left--
      api.say(left > 0 ? "Built the next item." : "All done.\nQUEUE EMPTY")
    }
    const session = await s.manager.start({ cwd: s.repo, extreme: true })
    const count = results(session)
    const told: Array<{ type: string; data: Record<string, unknown> }> = []
    session.on("event", (e) => told.push(e))
    session.prompt("work through the build queue")
    await vi.waitFor(() => expect(session.info().carryOn?.ended).toBe("done"))
    expect(count()).toBe(3)
    expect(s.sdk.queries.at(-1)?.prompts).toEqual([
      "work through the build queue",
      CARRY_ON_PROMPT,
      CARRY_ON_PROMPT,
    ])
    expect(told.filter((e) => e.type === "carry_on").map((e) => e.data)).toEqual([
      { turn: 1, of: 3 },
      { turn: 2, of: 3 },
    ])
    expect(told.at(-1)).toMatchObject({ type: "carry_on_end", data: { why: "done" } })
    expect(
      s.records().filter((x) => x.event === "extreme_carry_on" && x.session === session.id),
    ).toHaveLength(2)
  })

  it("starts a new run with your next message after the queue was empty", async () => {
    s.sdk.turn = async (api, text) =>
      api.say(text === CARRY_ON_PROMPT ? "QUEUE EMPTY" : "Done that.")
    const session = await s.manager.start({ cwd: s.repo, extreme: true })
    session.prompt("first job")
    await vi.waitFor(() => expect(session.info().carryOn?.ended).toBe("done"))
    session.prompt("second job")
    await vi.waitFor(() =>
      expect(s.sdk.queries.at(-1)?.prompts).toEqual([
        "first job",
        CARRY_ON_PROMPT,
        "second job",
        CARRY_ON_PROMPT,
      ]),
    )
  })

  it("stops at the most automatic turns", async () => {
    s.sdk.turn = async (api) => {
      await api.callTool("Glob", { pattern: "*.md" })
      api.say("Built another item; there are more.")
    }
    const session = await s.manager.start({ cwd: s.repo, extreme: true })
    session.prompt("go")
    await vi.waitFor(() => expect(session.info().carryOn?.ended).toBe("turns"))
    expect(s.sdk.queries.at(-1)?.prompts).toHaveLength(4)
  })

  it("stops when two turns in a row did no work, so a run with nothing left cannot loop", async () => {
    s.sdk.turn = async (api) => api.say("Nothing more that I can see.")
    const session = await s.manager.start({ cwd: s.repo, extreme: true })
    session.prompt("go")
    await vi.waitFor(() => expect(session.info().carryOn?.ended).toBe("stalled"))
    expect(s.sdk.queries.at(-1)?.prompts).toEqual(["go", CARRY_ON_PROMPT])
  })

  it("does not carry on after you stop it, nor when Extreme approval is off", async () => {
    s.sdk.turn = async (api) => api.say("Built an item; there are more.")
    const off = await s.manager.start({ cwd: s.repo })
    const offCount = results(off)
    off.prompt("go")
    await vi.waitFor(() => expect(offCount()).toBe(1))
    await new Promise((r) => setTimeout(r, 200))
    expect(s.sdk.queries.at(-1)?.prompts).toEqual(["go"])
    expect(off.info().carryOn).toBeUndefined()

    let release: () => void = () => undefined
    s.sdk.turn = async (api) => {
      await new Promise<void>((r) => (release = r))
      api.say("Half way.")
    }
    const on = await s.manager.start({ cwd: s.repo, extreme: true })
    on.prompt("go")
    await on.stop()
    release()
    await new Promise((r) => setTimeout(r, 200))
    expect(s.sdk.queries.at(-1)?.prompts).toEqual(["go"])
  })

  it("carries on by itself when brought back mid-run after a restart, but not after you force-stopped it", async () => {
    s.sdk.turn = async (api) => api.say("QUEUE EMPTY")
    const restore = (forced: boolean, id: string) => ({
      cwd: s.repo,
      extreme: true,
      resume: "sdk-earlier",
      restore: { id, createdAt: "2026-10-30T09:00:00Z", wasRunning: true, forced },
    })
    await s.manager.start(restore(false, "019a0000-0000-7000-8000-0000000000c1"))
    await vi.waitFor(() => expect(s.sdk.queries.at(-1)?.prompts).toEqual([CARRY_ON_PROMPT]))
    await s.manager.start(restore(true, "019a0000-0000-7000-8000-0000000000c2"))
    await new Promise((r) => setTimeout(r, 200))
    expect(s.sdk.queries.at(-1)?.prompts).toEqual([])
  })

  it("brings back any session that was working, in any mode, and tells it where it was (owner, 31 Oct)", async () => {
    s.sdk.turn = async (api) => api.say("Picked up where I was.")
    const session = await s.manager.start({
      cwd: s.repo,
      resume: "sdk-earlier",
      restore: {
        id: "019a0000-0000-7000-8000-0000000000c3",
        createdAt: "2026-10-31T09:00:00Z",
        wasRunning: true,
      },
    })
    await vi.waitFor(() => expect(s.sdk.queries.at(-1)?.prompts).toEqual([RESUME_PROMPT]))
    const rec = s
      .records()
      .filter((x) => x.event === "extreme_carry_on" && x.session === session.id)
    expect(rec).toHaveLength(1)
    expect(rec[0]?.verdict.reason).toMatch(/restarted/)
    // It picks up once; with Extreme approval off nothing carries on after that.
    await new Promise((r) => setTimeout(r, 200))
    expect(s.sdk.queries.at(-1)?.prompts).toEqual([RESUME_PROMPT])
  })

  it("approves a plan by itself", async () => {
    let r: ToolCallResult | undefined
    s.sdk.turn = async (api, text) => {
      if (text === CARRY_ON_PROMPT) return api.say("QUEUE EMPTY")
      r = await api.callTool("ExitPlanMode", { plan: "Build the export, then test it." })
    }
    const session = await s.manager.start({ cwd: s.repo, extreme: true })
    session.prompt("plan it")
    await vi.waitFor(() => expect(r).toBeDefined())
    expect(r).toMatchObject({ executed: true })
    expect(
      s
        .records()
        .filter((x) => x.event === "plan_decision")
        .at(-1)?.verdict,
    ).toMatchObject({
      decidedBy: "extreme-mode",
    })
  })
})
