// Work that carries on after a turn ends (background subagents and shell commands), Stop, and Force stop (owner, 30
// Oct: a session doing something showed Ready, and there was no way to stop it there and then).
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"
import type { Session } from "../src/sessions.js"
import type { TurnScript } from "./fake-sdk.js"
import { buildStack, type Stack } from "./stack.js"

let s: Stack
beforeAll(async () => {
  s = await buildStack({ hardTimeoutMs: 1500, phoneExpiryMs: 800 })
}, 60000)
afterAll(() => s.stop())

const tasks = (...list: Array<{ id: string; what: string; ambient?: boolean }>) => ({
  type: "system",
  subtype: "background_tasks_changed",
  tasks: list.map((t) => ({
    task_id: t.id,
    task_type: "local_agent",
    description: t.what,
    ...(t.ambient ? { ambient: true } : {}),
  })),
})

/** Starts a session and runs one turn that leaves work going in the background. */
async function turnWithBackground(): Promise<Session> {
  const turn: TurnScript = async (api) => {
    api.system(
      tasks(
        { id: "t1", what: "Sweep the auth module" },
        { id: "t2", what: "Sweep billing" },
        { id: "w", what: "Watch the dev server", ambient: true },
      ),
    )
    api.say("All the sweeps are running. I will put it together when they report back.")
  }
  s.sdk.turn = turn
  const session = await s.manager.start({ cwd: s.repo })
  const done = new Promise<void>((r) => session.on("message", (m) => m.type === "result" && r()))
  session.prompt("sweep it all")
  await done
  return session
}

describe("work in the background", () => {
  it("says what is still working after the turn ends, leaving out watchers", async () => {
    const session = await turnWithBackground()
    expect(session.info()).toMatchObject({
      state: "idle",
      background: ["Sweep the auth module", "Sweep billing"],
    })
    // One finishing says so on its own; the full list replaces what was there.
    s.sdk.queries.at(-1)?.emit({
      type: "system",
      subtype: "task_notification",
      task_id: "t1",
      status: "completed",
    })
    await vi.waitFor(() => expect(session.info().background).toEqual(["Sweep billing"]))
    s.sdk.queries.at(-1)?.emit(tasks())
    await vi.waitFor(() => expect(session.info().background).toBeUndefined())
  })

  it("stops the turn and every background task on Stop", async () => {
    const session = await turnWithBackground()
    await session.stop()
    expect(s.sdk.queries.at(-1)?.stopped).toEqual(["t1", "t2"])
    await vi.waitFor(() => expect(session.info().background).toBeUndefined())
  })

  it("stops background tasks with the kill switch too", async () => {
    await turnWithBackground()
    const handle = s.sdk.queries.at(-1)
    await s.kill.engage("desktop", "test")
    try {
      expect(handle?.stopped).toEqual(["t1", "t2"])
    } finally {
      await s.kill.rearm("desktop")
    }
  })

  it("force-stops a session and starts it again on the same conversation, under the same id", async () => {
    const session = await turnWithBackground()
    const before = s.sdk.queries.at(-1)
    const sdkId = session.info().sdkSessionId
    const again = await s.manager.forceStop(session.id)
    expect(before?.closed).toBe(true)
    expect(again.id).toBe(session.id)
    expect(s.manager.get(session.id)).toBe(again)
    expect(again.info()).toMatchObject({
      historyFrom: sdkId,
      restarted: { wasRunning: false, forced: true },
    })
    expect(again.info().background).toBeUndefined()
    expect(s.sdk.queries.at(-1)?.options).toMatchObject({ resume: sdkId })
  })
})
