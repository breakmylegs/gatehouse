// Owner, 10 Nov: after an Interrupt, Claude carried on with the message it already had, but the session showed no
// activity and no spinner until another message was sent. A turn Claude starts by itself is a turn: the session is
// working until its result.
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"
import { buildStack, type Stack } from "./stack.js"

let s: Stack
beforeAll(async () => {
  s = await buildStack({ hardTimeoutMs: 1500, phoneExpiryMs: 800 })
}, 60000)
afterAll(() => s.stop())

describe("a turn Claude starts by itself", () => {
  it("shows the session working from its first message until its result", async () => {
    s.sdk.turn = async (api) => api.say("ok")
    const session = await s.manager.start({ cwd: s.repo })
    const done = new Promise<void>((r) => session.on("message", (m) => m.type === "result" && r()))
    session.prompt("first")
    await done
    expect(session.info().state).toBe("idle")
    const q = s.sdk.queries.at(-1)!
    const states: string[] = []
    session.on("state", (i) => states.push(i.state))
    // Nothing is sent; Claude starts on the message it had.
    q.emit({ type: "assistant", message: { role: "assistant", content: [{ type: "text", text: "Picking up your message." }] } })
    await vi.waitFor(() => expect(session.info().state).toBe("running"))
    q.emit({ type: "result", subtype: "success", is_error: false, duration_ms: 5, num_turns: 1, result: "done", total_cost_usd: 0.01, usage: {} })
    await vi.waitFor(() => expect(session.info().state).toBe("idle"))
    expect(states.filter((x, i) => x !== states[i - 1])).toEqual(["running", "idle"])
    await session.close()
  })
})
