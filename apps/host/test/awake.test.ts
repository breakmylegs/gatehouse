// Keep the computer awake while a session works (owner, 4 Nov).
import fs from "node:fs"
import path from "node:path"
import { describe, expect, it } from "vitest"
import { AwakeWatch } from "../src/awake.js"

it("prints the line the window app reads, so the two cannot drift apart", () => {
  const cs = fs.readFileSync(
    path.resolve(import.meta.dirname, "../../../packaging/Common.cs"),
    "utf8",
  )
  const verbatim = /AwakeLine = new Regex\(@"((?:[^"]|"")*)"\)/.exec(cs)?.[1]
  expect(verbatim).toBeTruthy()
  const re = new RegExp(verbatim!.replace(/""/g, '"'))
  const on = re.exec(JSON.stringify({ event: "awake", on: true }))
  const off = re.exec(JSON.stringify({ event: "awake", on: false }))
  expect(on?.[1]).toBe("true")
  expect(off?.[1]).toBe("false")
  expect(re.test(JSON.stringify({ event: "attention" }))).toBe(false)
})

describe("keeping the computer awake", () => {
  it("asks while any session works or waits on you, and lets go when none does", () => {
    const told: boolean[] = []
    const w = new AwakeWatch(
      () => true,
      (on) => told.push(on),
    )
    w.note({ id: "a", state: "running" })
    w.note({ id: "b", state: "waiting" })
    w.note({ id: "a", state: "idle" })
    expect(w.on).toBe(true)
    w.note({ id: "b", state: "ended" })
    expect(told).toEqual([true, false])
  })

  it("never asks while the setting is off, and lets go as soon as it is turned off", () => {
    let enabled = false
    const told: boolean[] = []
    const w = new AwakeWatch(
      () => enabled,
      (on) => told.push(on),
    )
    w.note({ id: "a", state: "running" })
    expect(told).toEqual([])
    enabled = true
    w.check()
    expect(told).toEqual([true])
    enabled = false
    w.check()
    expect(told).toEqual([true, false])
  })
})
