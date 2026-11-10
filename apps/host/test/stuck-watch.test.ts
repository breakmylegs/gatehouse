// Backlog O16: possibly stuck is worked out on the Host, once a turn, and never while the session waits for you.
import { describe, expect, it } from "vitest"
import { STUCK_MS, StuckWatch } from "../src/stuck-watch.js"

describe("possibly stuck", () => {
  it("is said once a turn after two minutes with nothing from Claude, and not while it waits for you", () => {
    let now = 0
    let waiting = false
    let told = 0
    const w = new StuckWatch({ onStuck: () => told++, waiting: () => waiting, now: () => now })
    w.look()
    expect(told).toBe(0) // not watching before a turn begins
    w.start()
    now += STUCK_MS - 1
    w.look()
    expect(told).toBe(0)
    now += 2
    w.look()
    w.look()
    expect(told).toBe(1)
    // Claude says something: the clock starts again, and it may be said again later.
    w.seen()
    now += STUCK_MS + 1
    w.look()
    expect(told).toBe(2)
    // Waiting for you is not stuck, and that time does not count.
    w.seen()
    waiting = true
    now += STUCK_MS * 3
    w.look()
    expect(told).toBe(2)
    waiting = false
    now += STUCK_MS - 1
    w.look()
    expect(told).toBe(2)
    // The turn ended: nothing more.
    w.stop()
    now += STUCK_MS * 2
    w.look()
    expect(told).toBe(2)
  })
})
