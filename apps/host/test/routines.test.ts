// B34: routines start as normal sessions on their days and times, once a day at most, through every check.
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { afterAll, describe, expect, it, vi } from "vitest"
import {
  checkRoutine,
  isDue,
  RoutineScheduler,
  RoutineStore,
  type Routine,
} from "../src/routines.js"

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "gh-routines-"))
afterAll(() => fs.rmSync(dir, { recursive: true, force: true }))
// Wednesday 4 November 2026, local time.
const at = (h: number, m: number, day = 4) => new Date(2026, 10, day, h, m)
const morning: Routine = {
  id: "r1",
  name: "Triage",
  folder: "C:/dev/shop",
  prompt: "Look at the new issues and sort them.",
  time: "07:30",
  days: ["mon", "tue", "wed", "thu", "fri"],
  enabled: true,
}

describe("a routine", () => {
  it("is due on its days, from its time and for an hour after, once a day", () => {
    expect(isDue(morning, at(7, 29))).toBe(false)
    expect(isDue(morning, at(7, 30))).toBe(true)
    expect(isDue(morning, at(8, 15))).toBe(true)
    expect(isDue(morning, at(8, 31))).toBe(false)
    expect(isDue(morning, at(7, 30, 7))).toBe(false) // Saturday
    expect(isDue({ ...morning, lastRun: "2026-11-04" }, at(7, 45))).toBe(false)
    expect(isDue({ ...morning, enabled: false }, at(7, 45))).toBe(false)
  })

  it("is refused without a full folder, a prompt, a time or a day", () => {
    expect(() => checkRoutine({ ...morning, folder: "shop" })).toThrow(/full folder path/)
    expect(() => checkRoutine({ ...morning, prompt: " " })).toThrow(/prompt/)
    expect(() => checkRoutine({ ...morning, time: "7:30" })).toThrow(/time/)
    expect(() => checkRoutine({ ...morning, days: [] })).toThrow(/day/)
  })

  it("starts once at its time, is not tried again that day if the start fails, and is kept on disk", async () => {
    const file = path.join(dir, "routines.json")
    fs.writeFileSync(file, JSON.stringify({ version: 1, routines: [], newer: { kept: true } }))
    const store = new RoutineStore(file)
    const saved = await store.put(morning)
    let now = at(7, 31)
    const start = vi.fn(async () => {
      throw new Error("the kill switch is engaged")
    })
    const s = new RoutineScheduler({ store, start, log: () => undefined, now: () => now })
    await s.check()
    await s.check()
    expect(start).toHaveBeenCalledTimes(1)
    expect(start).toHaveBeenCalledWith(
      expect.objectContaining({ id: saved.id, prompt: morning.prompt }),
    )
    // The next working day it runs again.
    now = at(7, 35, 5)
    await s.check()
    expect(start).toHaveBeenCalledTimes(2)
    const onDisk = JSON.parse(fs.readFileSync(file, "utf8")) as Record<string, unknown>
    expect(onDisk.newer).toEqual({ kept: true })
    expect(new RoutineStore(file).list()[0]).toMatchObject({
      name: "Triage",
      lastRun: "2026-11-05",
    })
    expect(await store.remove(saved.id)).toBe(true)
    expect(store.list()).toEqual([])
  })
})
