import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { describe, expect, it } from "vitest"
import { DigestScheduler } from "../src/digest.js"

const file = () => path.join(fs.mkdtempSync(path.join(os.tmpdir(), "gh-digest-")), "digest.json")
const at = (h: number, m = 0, day = 27) => new Date(2026, 9, day, h, m)

function make(opts: { time: string | null | undefined; ok?: boolean; throws?: boolean }) {
  const f = file()
  let now = at(7, 59)
  let sent = 0
  const s = new DigestScheduler({
    time: () => opts.time,
    stateFile: f,
    now: () => now,
    send: async () => {
      if (opts.throws) throw new Error("relay down")
      sent++
      return opts.ok ?? true
    },
  })
  return { s, f, set: (d: Date) => (now = d), sent: () => sent }
}

describe("DigestScheduler", () => {
  it("waits for the time, sends once that day, and again the next day", async () => {
    const t = make({ time: "08:00" })
    expect(await t.s.check()).toBe(false)
    t.set(at(8, 0))
    expect(await t.s.check()).toBe(true)
    t.set(at(8, 30))
    expect(await t.s.check()).toBe(false)
    t.set(at(23, 59))
    expect(await t.s.check()).toBe(false)
    t.set(at(8, 1, 28))
    expect(await t.s.check()).toBe(true)
    expect(t.sent()).toBe(2)
  })

  it("sends at the next check if the computer was asleep at the time, and remembers across restarts", async () => {
    const t = make({ time: "08:00" })
    t.set(at(13, 12))
    expect(await t.s.check()).toBe(true)
    const again = new DigestScheduler({
      time: () => "08:00",
      stateFile: t.f,
      now: () => at(14),
      send: async () => true,
    })
    expect(await again.check()).toBe(false)
  })

  it("does nothing when off or when the time is not a time", async () => {
    for (const time of [null, undefined, "", "8am", "25:00", "08:60"]) {
      const t = make({ time })
      t.set(at(12))
      expect(await t.s.check()).toBe(false)
      expect(t.sent()).toBe(0)
    }
  })

  it("tries again at the next check when sending fails or declines, and does not mark the day", async () => {
    for (const o of [{ throws: true }, { ok: false }]) {
      const t = make({ time: "08:00", ...o })
      t.set(at(9))
      expect(await t.s.check()).toBe(false)
      expect(fs.existsSync(t.f)).toBe(false)
    }
  })

  it("never sends two at once", async () => {
    const f = file()
    let n = 0
    let release!: () => void
    const gate = new Promise<void>((r) => (release = r))
    const s = new DigestScheduler({
      time: () => "08:00",
      stateFile: f,
      now: () => at(9),
      send: async () => (n++, await gate, true),
    })
    const a = s.check()
    const b = s.check()
    release()
    expect([await a, await b].filter(Boolean)).toHaveLength(1)
    expect(n).toBe(1)
  })
})
