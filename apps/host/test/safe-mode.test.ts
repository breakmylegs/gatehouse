// E-096: after three crash restarts in ten minutes the next start is in safe mode, which brings back no session and
// starts no plugins, routines, warm chat, MCP servers or push channels; entering and leaving are both audited, and a
// clean stop or an old crash is not counted.
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest"
import { CRASH_WINDOW_MS, SafeMode, safeModePlan } from "../src/safe-mode.js"
import { buildStack, type Stack } from "./stack.js"

let dir: string
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "gh-safe-"))
})
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }))

function host(clock: { t: number }) {
  const audited: Array<{ event: string; input: Record<string, unknown> }> = []
  const safe = new SafeMode(dir, { audit: async (event, input) => void audited.push({ event, input }), now: () => clock.t })
  return { safe, audited }
}

describe("a session started in safe mode", () => {
  let s: Stack
  beforeAll(async () => {
    s = await buildStack({ hardTimeoutMs: 1500, phoneExpiryMs: 800 })
  }, 60_000)
  afterAll(() => s.stop())

  it("has every installed plugin off, and no warm chat is started", async () => {
    s.deps.pluginsOff = () => ["mods@market", "helper@market"]
    s.deps.safeMode = () => true
    await s.manager.start({ cwd: s.repo })
    const options = s.sdk.queries.at(-1)!.options as { settings?: { enabledPlugins?: Record<string, boolean> } }
    expect(options.settings?.enabledPlugins).toEqual({ "mods@market": false, "helper@market": false })
    const before = s.sdk.queries.length
    s.manager.warmChat()
    expect(s.sdk.queries.length).toBe(before)
  }, 60_000)
})

describe("safe mode (E-096)", () => {
  it("is where the next start goes after three crash restarts in ten minutes, and it is audited", async () => {
    const clock = { t: 1_000_000 }
    const { safe, audited } = host(clock)
    // Four starts that each crashed (never stopped cleanly), a minute apart: the fourth sees three crashes before it.
    for (let i = 0; i < 3; i++) {
      expect((await safe.noteStart()).on).toBe(false)
      clock.t += 60_000
    }
    expect(await safe.noteStart()).toMatchObject({ on: true, reason: "crash-restarts" })
    expect(audited.filter((a) => a.event === "safe_mode_entered")).toEqual([{ event: "safe_mode_entered", input: { reason: "crash-restarts", crashes: 3 } }])
    // E-099: each start after one that never stopped cleanly is recorded for the health score.
    expect(audited.filter((a) => a.event === "host_crash_restart")).toHaveLength(3)
    // It stays on through later starts until you leave it, which is audited too.
    clock.t += 60_000
    expect((await safe.noteStart()).on).toBe(true)
    expect(await safe.leave()).toEqual({ on: false })
    expect(audited.at(-1)).toEqual({ event: "safe_mode_left", input: { reason: "crash-restarts" } })
    // Leaving starts the count afresh.
    expect((await safe.noteStart()).on).toBe(false)
  })

  it("does not count starts that stopped cleanly, or crashes older than ten minutes", async () => {
    const clock = { t: 5_000_000 }
    const { safe } = host(clock)
    for (let i = 0; i < 5; i++) {
      await safe.noteStart()
      safe.noteCleanStop()
      clock.t += 30_000
    }
    expect((await safe.noteStart()).on).toBe(false)
    // Two old crashes and one recent one: not three in ten minutes.
    const old = host({ t: 9_000_000 })
    await old.safe.noteStart()
    await old.safe.noteStart()
    const later = host({ t: 9_000_000 + CRASH_WINDOW_MS + 1 })
    await later.safe.noteStart()
    expect((await later.safe.noteStart()).on).toBe(false)
  })

  it("can be entered on purpose (Doctor, the start flag, a failed canary), once, and brings back nothing", async () => {
    const { safe, audited } = host({ t: 1 })
    await safe.enter("doctor")
    await safe.enter("canary")
    expect(safe.state()).toMatchObject({ on: true, reason: "doctor" })
    expect(audited.map((a) => a.event)).toEqual(["safe_mode_entered"])
    expect(safeModePlan(true)).toEqual({ restoreSessions: false, routines: false, autostartMcp: false, pushChannels: false, warmChat: false, plugins: false })
    expect(Object.values(safeModePlan(false)).every(Boolean)).toBe(true)
  })
})
