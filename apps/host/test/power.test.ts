// E-089: on battery a heavy job Codehouse starts by itself waits, and runs once mains power is back; Extreme approval
// keeps running unless "Pause Extreme on battery" is on; new sessions start lower; each change is audited; and the
// readings of Windows and a Mac are understood.
import { describe, expect, it } from "vitest"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { LOW_BATTERY_PERCENT, parseMac, parseMacPercent, parseWindows, Power, type PowerSource } from "../src/power.js"
import { SessionTimeline } from "../src/session-timeline.js"

function power(o: { pauseSetting?: boolean } = {}) {
  let now: PowerSource = "mains"
  const audited: Array<{ source: PowerSource; was: PowerSource }> = []
  let paused = 0
  let resumed = 0
  const p = new Power({
    read: async () => now,
    audit: async (i) => void audited.push(i),
    pauseExtremeOnBattery: () => o.pauseSetting === true,
    pauseExtreme: () => void paused++,
    resumeExtreme: () => void resumed++,
  })
  return { p, set: (s: PowerSource) => (now = s), audited, paused: () => paused, resumed: () => resumed }
}

describe("battery-aware scheduling (E-089)", () => {
  it("defers a heavy job on battery, runs it once on mains, and audits each change", async () => {
    const s = power()
    await s.p.check()
    let ran = 0
    expect(s.p.heavy("routine", () => void ran++)).toBe("ran")
    s.set("battery")
    await s.p.check()
    expect(s.p.heavy("routine", () => void ran++)).toBe("deferred")
    expect(s.p.heavy("routine", () => void ran++)).toBe("deferred")
    expect(s.p.waiting()).toEqual(["routine"])
    expect(ran).toBe(1)
    s.set("mains")
    await s.p.check()
    expect(ran).toBe(2)
    expect(s.p.waiting()).toEqual([])
    expect(s.audited).toEqual([
      { source: "mains", was: "unknown" },
      { source: "battery", was: "mains" },
      { source: "mains", was: "battery" },
    ])
  })

  it("keeps Extreme running on battery by default, and pauses it only when you chose so", async () => {
    const usual = power()
    usual.set("battery")
    await usual.p.check()
    expect(usual.paused()).toBe(0)
    const chosen = power({ pauseSetting: true })
    chosen.set("battery")
    await chosen.p.check()
    expect(chosen.paused()).toBe(1)
    expect(chosen.resumed()).toBe(0)
    chosen.set("mains")
    await chosen.p.check()
    expect(chosen.resumed()).toBe(1)
  })

  it("keeps the timeline summaries waiting on battery, with what happened, until mains power", async () => {
    const s = power()
    s.set("battery")
    await s.p.check()
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "gh-power-"))
    const sent: number[] = []
    const t = new SessionTimeline({
      dir,
      writer: async (i) => (sent.push(i.lines.length), "Did things."),
      enabled: () => true,
      wait: () => s.p.onBattery,
      session: () => ({ project: "p" }),
      orgOk: () => true,
      redact: (x) => x,
      audit: { record: async () => true },
      policyHash: () => "h",
      log: () => undefined,
    })
    try {
      t.note("s1", { who: "you", text: "fix the bug" })
      expect(await t.tick()).toBe(0)
      s.set("mains")
      await s.p.check()
      expect(await t.tick()).toBe(1)
      expect(sent).toEqual([1])
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })

  it("starts new sessions lower on battery", async () => {
    const s = power()
    await s.p.check()
    expect(s.p.defaultResources("normal", "low")).toBe("normal")
    s.set("battery")
    await s.p.check()
    expect(s.p.defaultResources("normal", "low")).toBe("low")
  })

  it("reads Windows' battery status and a Mac's pmset", () => {
    expect(parseWindows("1\r\n")).toBe("battery")
    expect(parseWindows("2\r\n")).toBe("mains")
    expect(parseWindows("")).toBe("mains")
    expect(parseMac("Now drawing from 'Battery Power'\n -InternalBattery-0 80%")).toBe("battery")
    expect(parseMac("Now drawing from 'AC Power'")).toBe("mains")
    expect(parseMac("")).toBe("unknown")
  })

  // Mac fork (owner, 25 Nov): a low battery pauses Extreme approval whatever the setting says, until mains power.
  describe("a low battery on a Mac", () => {
    function charged(o: { pauseSetting?: boolean } = {}) {
      let now: { source: PowerSource; percent?: number } = { source: "mains", percent: 100 }
      const audited: unknown[] = []
      let paused = 0
      let resumed = 0
      const p = new Power({
        read: async () => now,
        audit: async (i) => void audited.push(i),
        pauseExtremeOnBattery: () => o.pauseSetting === true,
        pauseExtreme: () => void paused++,
        resumeExtreme: () => void resumed++,
      })
      return { p, set: (source: PowerSource, percent?: number) => (now = { source, ...(percent !== undefined ? { percent } : {}) }), audited, paused: () => paused, resumed: () => resumed }
    }

    it("reads the charge from pmset", () => {
      const out = "Now drawing from 'Battery Power'\n -InternalBattery-0 (id=24117347)\t18%; discharging; 1:02 remaining present: true\n"
      expect(parseMacPercent(out)).toBe(18)
      expect(parseMacPercent("Now drawing from 'AC Power'\n")).toBeUndefined()
    })

    it("pauses Extreme once when the charge falls to 20%, audits it, and starts it again on mains", async () => {
      const s = charged()
      await s.p.check()
      s.set("battery", 60)
      await s.p.check()
      expect([s.p.low, s.paused()]).toEqual([false, 0])
      s.set("battery", LOW_BATTERY_PERCENT)
      await s.p.check()
      expect([s.p.low, s.paused()]).toEqual([true, 1])
      expect(s.audited.at(-1)).toEqual({ source: "battery", was: "battery", low: true, percent: LOW_BATTERY_PERCENT })
      s.set("battery", 12)
      await s.p.check()
      expect(s.paused()).toBe(1)
      s.set("mains", 13)
      await s.p.check()
      expect([s.p.low, s.resumed()]).toEqual([false, 1])
    })

    it("pauses once when it goes on battery already low, and once only with the setting on too", async () => {
      for (const pauseSetting of [false, true]) {
        const s = charged({ pauseSetting })
        await s.p.check()
        s.set("battery", 10)
        await s.p.check()
        expect([s.p.low, s.paused()]).toEqual([true, 1])
      }
    })

    it("is never low without a charge in the reading, as on Windows", async () => {
      const s = charged()
      s.set("battery")
      await s.p.check()
      expect([s.p.onBattery, s.p.low, s.paused()]).toEqual([true, false, 0])
    })
  })
})
