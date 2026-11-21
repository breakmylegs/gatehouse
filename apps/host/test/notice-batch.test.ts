// D-087: non-urgent notices are gathered into one summary every so many minutes; approvals go to the phone at once.
import { describe, expect, it, vi } from "vitest"
import { Broker } from "../src/broker.js"
import { NoticeBatcher, type Notice } from "../src/notice-batch.js"

const setup = (minutes: number | undefined) => {
  const clock = { now: Date.parse("2026-11-21T10:00:00Z") }
  const sent: Notice[] = []
  const b = new NoticeBatcher({ minutes: () => minutes, send: async (n) => void sent.push(n), now: () => clock.now })
  return { b, sent, clock }
}
const finished = (project: string): Notice => ({ kind: "stop", title: "Session finished", body: "", project })

describe("the interruption budget", () => {
  it("sends each notice at once with no batch time", async () => {
    const t = setup(undefined)
    t.b.add(finished("shop"))
    await Promise.resolve()
    expect(t.sent).toEqual([finished("shop")])
  })

  it("holds notices until the batch time, then sends one summary", async () => {
    const t = setup(30)
    t.b.add(finished("shop"))
    t.b.add({ kind: "notify", title: "Claude", body: "The tests\npass now", project: "shop" })
    t.b.add(finished("cafe"))
    t.clock.now += 29 * 60_000
    await t.b.flush()
    expect(t.sent).toEqual([])
    t.clock.now += 2 * 60_000
    await t.b.flush()
    expect(t.sent).toEqual([
      { title: "3 updates", body: "shop: Session finished\nshop: Claude, The tests pass now\ncafe: Session finished", project: "Codehouse" },
    ])
    expect(t.b.held()).toBe(0)
  })

  it("sends a lone held notice as it was, and everything held when Codehouse closes", async () => {
    const t = setup(60)
    t.b.add({ kind: "info", title: "Codehouse digest", body: "3 sessions", project: "Codehouse" })
    await t.b.flush(true)
    expect(t.sent).toEqual([{ kind: "info", title: "Codehouse digest", body: "3 sessions", project: "Codehouse" }])
  })

  it("never holds an approval: the broker delivers it to the phone at once while notices wait", async () => {
    const t = setup(30)
    t.b.add(finished("shop"))
    const deliver = vi.fn(async () => undefined)
    const broker = new Broker({ phoneExpiryMs: 60_000, hardTimeoutMs: 120_000, redact: (v) => v, phone: { deliver, cancel: async () => undefined } })
    void broker.request({ kind: "permission", sessionId: "s1", toolUseId: "t1", toolName: "Bash", input: { command: "make" }, cwd: "C:/p", project: "shop", verdict: { outcome: "escalate", ruleId: "no-rule", reason: "r", risk: 80, decidedBy: "rules", policyHash: "h" } })
    await vi.waitFor(() => expect(deliver).toHaveBeenCalledTimes(1))
    expect(t.sent).toEqual([])
    expect(t.b.held()).toBe(1)
    broker.cancelAll()
  })
})
