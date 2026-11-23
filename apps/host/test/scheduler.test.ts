// E-049: under memory pressure a queued job waits, says why, and starts once memory frees; approvals, the kill switch
// and Stop are never delayed; with the memory governor off nothing waits.
import { describe, expect, it, vi } from "vitest"
import { createCanUseTool, type CanUseDeps } from "../src/canuse.js"
import { cpuSampler, Scheduler, SchedulerCancelled } from "../src/scheduler.js"

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))

function pressure(memory: number) {
  const reading = { memory, cpu: 10 }
  const s = new Scheduler({ probe: async () => reading, limits: () => ({ memory: 85, cpu: 90 }), killed: () => false, pollMs: 20 })
  return { s, reading }
}

describe("the resource-aware scheduler", () => {
  it("holds a job under memory pressure, says why, and starts it once memory frees", async () => {
    const { s, reading } = pressure(92)
    const job = vi.fn(async () => "done")
    const result = s.run({ label: "mutation run", sessionId: "s1" }, job)
    await wait(80)
    expect(job).not.toHaveBeenCalled()
    expect(s.waiting()).toEqual([expect.objectContaining({ label: "mutation run", reason: "waiting for memory: 92% committed, 85% is the point" })])
    reading.memory = 60
    expect(await result).toBe("done")
    expect(s.waiting()).toEqual([])
    s.stop()
  })

  it("starts the highest priority first, then in order", async () => {
    const { s, reading } = pressure(92)
    const order: string[] = []
    const a = s.run({ label: "a", priority: 1 }, async () => void order.push("a"))
    const b = s.run({ label: "b", priority: 9 }, async () => void order.push("b"))
    const c = s.run({ label: "c", priority: 9 }, async () => void order.push("c"))
    await wait(40)
    reading.memory = 10
    await Promise.all([a, b, c])
    expect(order).toEqual(["b", "c", "a"])
    s.stop()
  })

  it("lets the kill switch and Stop cancel what waits, at once", async () => {
    let killed = false
    const s = new Scheduler({ probe: async () => ({ memory: 99 }), limits: () => ({ memory: 85, cpu: 90 }), killed: () => killed, pollMs: 20 })
    const mine = s.run({ label: "x", sessionId: "s1" }, async () => 1)
    const other = s.run({ label: "y", sessionId: "s2" }, async () => 2)
    expect(s.cancelSession("s1")).toBe(1)
    await expect(mine).rejects.toBeInstanceOf(SchedulerCancelled)
    killed = true
    await expect(other).rejects.toThrow(/kill switch/)
    expect(s.waiting()).toEqual([])
    s.stop()
  })

  it("holds nothing while the memory governor is off", async () => {
    const s = new Scheduler({ probe: async () => ({ memory: 99, cpu: 99 }), limits: () => undefined, killed: () => false })
    expect(await s.run({ label: "x" }, async () => "now")).toBe("now")
  })

  it("never delays an approval, even with jobs held", async () => {
    const { s } = pressure(99)
    void s.run({ label: "held job", sessionId: "s1" }, async () => undefined).catch(() => undefined)
    const request = vi.fn(async () => ({ outcome: "allow", channel: "desktop", waitedMs: 1 }))
    const canUse = createCanUseTool({
      sessionId: "s1", cwd: "C:/p", project: "p",
      approver: { evaluate: async () => ({ outcome: "escalate", ruleId: "no-rule", reason: "r", risk: 40, decidedBy: "rules", policyHash: "h" }) },
      broker: { request }, audit: { record: async () => true }, kill: () => false, policy: () => undefined, engine: {}, pwsh: undefined,
      decided: new Set<string>(), extreme: () => false, effects: async () => undefined, log: () => undefined,
    } as unknown as CanUseDeps)
    const began = Date.now()
    const r = await canUse("Bash", { command: "npm run thing" }, { toolUseID: "t", signal: new AbortController().signal } as never)
    expect(r?.behavior).toBe("allow")
    expect(Date.now() - began).toBeLessThan(2000)
    expect(s.waiting()).toHaveLength(1)
    s.cancelAll("test over")
    s.stop()
  })

  it("reads how busy the CPU is", () => {
    const read = cpuSampler()
    const v = read()
    expect(v).toBeGreaterThanOrEqual(0)
    expect(v).toBeLessThanOrEqual(100)
  })
})
