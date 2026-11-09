// C-004, the memory governor: above the commit charge in Settings (85% unless you choose), Codehouse starts no new
// session, chat or page look, records each refusal before giving it, and offers idle sessions to suspend.
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"
import {
  commitPercent,
  DEFAULT_MEMORY_PERCENT,
  MemoryGovernor,
  MemoryRefusedError,
  memoryPoint,
  parseReading,
  type MemoryReading,
} from "../src/memory-governor.js"
import { buildStack, type Stack } from "./stack.js"

const GB = 1024 ** 3
const at = (percent: number): MemoryReading => ({
  commitUsed: (percent / 100) * 32 * GB,
  commitLimit: 32 * GB,
  physTotal: 16 * GB,
  physAvail: 2 * GB,
})

function governor(reading: () => MemoryReading | undefined, point: number | undefined = 85) {
  const records: Array<Record<string, unknown>> = []
  let clock = 0
  const g = new MemoryGovernor({
    read: async () => reading(),
    point: () => point,
    audit: {
      record: async (r) => {
        records.push(r as unknown as Record<string, unknown>)
        return true
      },
    },
    log: () => undefined,
    now: () => (clock += 10_000),
  })
  return { g, records }
}

describe("the memory governor (C-004)", () => {
  it("refuses above the point, with the reading, and records the refusal before giving it", async () => {
    expect(DEFAULT_MEMORY_PERCENT).toBe(85)
    const { g, records } = governor(() => at(90))
    const refused = g.admit("session", { cwd: "C:/p" })
    await expect(refused).rejects.toBeInstanceOf(MemoryRefusedError)
    await expect(refused).rejects.toThrow(/90% committed, over the 85% set in Settings/)
    expect(records).toHaveLength(1)
    expect(records[0]).toMatchObject({
      event: "memory_refused",
      input: { what: "session", percent: 90, point: 85, cwd: "C:/p" },
      verdict: { outcome: "deny", ruleId: "memory-governor" },
    })
  })

  it("lets things start below the point, when off, and when memory cannot be read", async () => {
    await expect(governor(() => at(84)).g.admit("chat")).resolves.toBeUndefined()
    await expect(governor(() => at(99), undefined).g.admit("chat")).resolves.toBeUndefined()
    await expect(governor(() => undefined).g.admit("chat")).resolves.toBeUndefined()
    expect([memoryPoint(undefined), memoryPoint({ percent: 70 }), memoryPoint({ percent: 30 })]).toEqual([
      85, 70, 85,
    ])
    expect(memoryPoint({ percent: 90, off: true })).toBeUndefined()
  })

  it("still refuses when the refusal cannot be recorded", async () => {
    const g = new MemoryGovernor({
      read: async () => at(95),
      point: () => 85,
      audit: { record: async () => false },
      log: () => undefined,
    })
    await expect(g.admit("page look")).rejects.toBeInstanceOf(MemoryRefusedError)
  })

  it("reads the helper's line, and refuses nothing on one that makes no sense", () => {
    const r = parseReading('{"commitUsed":27277557760,"commitLimit":33143939072,"physTotal":1,"physAvail":1}\n')
    expect(commitPercent(r)).toBe(82)
    expect(parseReading("usage: ...")).toBeUndefined()
    expect(parseReading('{"commitUsed":1,"commitLimit":0,"physTotal":1,"physAvail":1}')).toBeUndefined()
  })
})

describe("under simulated memory pressure, on real sessions (C-004)", () => {
  let s: Stack
  let percent = 50
  let records: Array<Record<string, unknown>> = []
  beforeAll(async () => {
    s = await buildStack({ hardTimeoutMs: 1500, phoneExpiryMs: 800 })
    const g = new MemoryGovernor({
      read: async () => at(percent),
      point: () => 85,
      audit: {
        record: async (r) => {
          records.push(r as unknown as Record<string, unknown>)
          return s.audit.record(r)
        },
      },
      log: () => undefined,
      now: (() => {
        let t = 0
        return () => (t += 10_000)
      })(),
    })
    s.hooks.admit = (what, detail) => g.admit(what as never, detail)
  }, 60000)
  afterAll(() => s.stop())

  it("refuses a new session with the reason and an audit record, and starts one once memory allows", async () => {
    s.sdk.turn = async (api) => api.say("ok")
    percent = 92
    records = []
    await expect(s.manager.start({ cwd: s.repo })).rejects.toThrow(/92% committed/)
    expect(records.map((r) => r.event)).toEqual(["memory_refused"])
    expect(s.records().some((r) => r.event === "memory_refused")).toBe(true)
    percent = 60
    const session = await s.manager.start({ cwd: s.repo })
    expect(session.info().state).not.toBe("error")
  })

  it("lets a session come back after a restart, which was open before", async () => {
    percent = 95
    const session = await s.manager.start({
      cwd: s.repo,
      restore: { id: "019a0000-0000-7000-8000-0000000000c4", createdAt: "2026-11-09T10:00:00Z", wasRunning: false },
    })
    expect(session.info().state).not.toBe("error")
    percent = 50
  })

  it("suspends an idle session, keeps it listed, and starts it again only when memory allows", async () => {
    s.sdk.turn = async (api) => api.say("ok")
    percent = 50
    const session = await s.manager.start({ cwd: s.repo })
    await vi.waitFor(() => expect(s.manager.idle().map((i) => i.id)).toContain(session.id))
    const info = await s.manager.suspend(session.id)
    expect(info).toMatchObject({ state: "error", suspended: true })
    expect(s.manager.get(session.id)).toBeUndefined()
    expect(s.manager.list().find((i) => i.id === session.id)).toMatchObject({ suspended: true })
    percent = 93
    await expect(s.manager.forceStop(session.id)).rejects.toThrow(/session started again/)
    expect(s.manager.list().find((i) => i.id === session.id)).toMatchObject({ suspended: true })
    percent = 40
    const back = await s.manager.forceStop(session.id)
    expect(back.id).toBe(session.id)
    expect(back.info().suspended).toBeUndefined()
  })

  it("will not suspend a session that is working or waiting", async () => {
    s.sdk.turn = async (api) =>
      new Promise<void>((resolve) => api.signal.addEventListener("abort", () => resolve()))
    percent = 40
    const busy = await s.manager.start({ cwd: s.repo })
    busy.prompt("work")
    await vi.waitFor(() => expect(busy.info().state).toBe("running"))
    await expect(s.manager.suspend(busy.id)).rejects.toThrow(/Only a session that is idle/)
    await busy.stop()
  })
})
