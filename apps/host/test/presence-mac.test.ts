// Mac fork (owner, 25 Nov): Codehouse.app's news of the screen locking, sleep, wake and power, on the Host's input.
// Leaving tells the phone at once what waits only while you are here; waking looks again; nothing else is read.
import { describe, expect, it } from "vitest"
import { macAway } from "../src/away-mac.js"
import { MacPresence, parseSignal, UPDATES_AFTER_WAKE_MS } from "../src/presence-mac.js"

function make() {
  const did: string[] = []
  let now = 0
  const p = new MacPresence({
    hurry: () => (did.push("hurry"), 1),
    nudgeRelay: () => void did.push("relay"),
    checkPower: async () => void did.push("power"),
    checkUpdates: async () => void did.push("updates"),
    log: () => undefined,
    now: () => now,
  })
  return { p, did, at: (ms: number) => (now = ms) }
}

describe("what Codehouse.app tells the Host about the Mac", () => {
  it("knows only its own words, one short JSON line each", () => {
    expect(parseSignal('{"event":"locked"}')).toBe("locked")
    expect(parseSignal('{"event":"wake"}')).toBe("wake")
    for (const junk of ['{"event":"allow"}', "locked", '{"event":1}', "", `{"event":"locked","x":"${"a".repeat(300)}"}`])
      expect(parseSignal(junk)).toBeUndefined()
  })

  it("counts you away at once while the screen is locked or the Mac asleep, and tells the phone now", async () => {
    const { p, did } = make()
    let asked = 0
    const away = macAway(async () => (asked++, '"HIDIdleTime" = 0'), p)
    expect(await away()).toBe(false)
    await p.take('{"event":"locked"}')
    expect([p.away, await away(), did]).toEqual([true, true, ["hurry"]])
    await p.take('{"event":"unlocked"}')
    expect([p.away, await away()]).toEqual([false, false])
    await p.take('{"event":"sleep"}')
    expect([p.away, did]).toEqual([true, ["hurry", "hurry"]])
    await p.take('{"event":"wake"}')
    expect(p.away).toBe(false)
    expect(asked).toBe(2)
  })

  it("on waking tries the Relay again and reads the power, and looks for updates at most every 15 minutes", async () => {
    const { p, did, at } = make()
    await p.take('{"event":"wake"}')
    expect(did).toEqual(["relay", "power", "updates"])
    did.length = 0
    at(UPDATES_AFTER_WAKE_MS - 1)
    await p.take('{"event":"wake"}')
    expect(did).toEqual(["relay", "power"])
    did.length = 0
    at(UPDATES_AFTER_WAKE_MS)
    await p.take('{"event":"wake"}')
    expect(did).toEqual(["relay", "power", "updates"])
  })

  it("reads the power at once when it changes, and does nothing for a line it does not know", async () => {
    const { p, did } = make()
    expect(await p.take('{"event":"power"}')).toBe("power")
    expect(await p.take('{"event":"approve","id":"x"}')).toBeUndefined()
    expect(did).toEqual(["power"])
  })
})
